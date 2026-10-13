import { cp, mkdir, readFile, readdir, rm, writeFile, access } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const docs = resolve(root, 'docs');
const output = resolve(docs, 'html');
const { pages: pairs, markdownOnly: hiddenPairs = [] } = JSON.parse(await readFile(resolve(docs, 'site/pages.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const slash = value => value.split(sep).join('/');
const relativeUrl = (from, to) => slash(relative(dirname(from), to));
const plain = html => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const slug = text => text.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
const pages = new Map();
for (const pair of pairs) {
  for (const [index, name] of pair.entries()) {
    const source = resolve(docs, name);
    if (!source.startsWith(docs + sep) || !name.endsWith('.md')) throw new Error(`Invalid page: ${name}`);
    if (pages.has(source)) throw new Error(`Duplicate page: ${name}`);
    // Placeholders keep release-specific values in sync with package.json.
    const content = (await readFile(source, 'utf8')).replaceAll('{{version}}', manifest.version);
    const unknown = content.match(/\{\{\s*[\w.-]+\s*\}\}/);
    if (unknown) throw new Error(`Unknown placeholder in ${name}: ${unknown[0]}`);
    const title = content.match(/^# (.+)$/m)?.[1];
    if (!title) throw new Error(`Missing page title: ${name}`);
    const language = index === 0 ? 'es' : 'en';
    const filename = name.split('/').at(-1).replace(/^README\.md$/, 'index.md').replace(/\.md$/, '.html');
    pages.set(source, { source, name, content, title, language, destination: resolve(output, language, filename), translation: resolve(docs, pair[1 - index]) });
  }
}
// Guides kept only as Markdown: excluded from the site, linked as repository files.
const markdownOnly = new Set();
for (const pair of hiddenPairs) {
  if (pair.length !== 2) throw new Error(`Invalid markdownOnly entry: ${JSON.stringify(pair)}`);
  for (const name of pair) {
    const source = resolve(docs, name);
    if (!source.startsWith(docs + sep) || !name.endsWith('.md')) throw new Error(`Invalid markdownOnly page: ${name}`);
    if (pages.has(source) || markdownOnly.has(source)) throw new Error(`Duplicate page: ${name}`);
    await readFile(source, 'utf8');
    markdownOnly.add(source);
  }
}
// Fail if a new guide has not been added to the bilingual navigation or explicitly excluded.
for (const directory of [docs, resolve(docs, 'en')]) {
  for (const name of await readdir(directory)) {
    const source = resolve(directory, name);
    if (name.endsWith('.md') && !pages.has(source) && !markdownOnly.has(source)) throw new Error(`Add ${relative(docs, source)} to docs/site/pages.json.`);
  }
}
const repository = process.env.DOCS_REPOSITORY_URL || (process.env.GITHUB_REPOSITORY ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}` : '');
if (repository && !/^https:\/\/[^\s?#]+$/.test(repository)) throw new Error('DOCS_REPOSITORY_URL must be an HTTPS repository URL.');
const ref = process.env.DOCS_SOURCE_REF || process.env.GITHUB_SHA || 'main';
const exists = async path => access(path).then(() => true, () => false);
const linkedResources = new Map();
// Preload existence checks; only Markdown and explicitly referenced public files are read.
for (const page of pages.values()) {
  const lexer = new Marked();
  await Promise.all(lexer.walkTokens(lexer.lexer(page.content), async token => {
    if (token.type !== 'link' || /^[a-z][\w+.-]*:|^#|^\/\//i.test(token.href)) return;
    const target = resolve(dirname(page.source), decodeURIComponent(token.href.split(/[?#]/)[0]));
    linkedResources.set(target, await exists(target));
  }));
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(docs, 'site/assets'), resolve(output, 'assets'), { recursive: true });
const generated = new Map();
for (const page of pages.values()) {
  const en = page.language === 'en';
  const label = en ? 'Documentation' : 'Documentación';
  const headings = [];
  const usedIds = new Map();
  const parser = new Marked({ gfm: true, breaks: false });
  const hrefFor = href => {
    if (/^(https?:|mailto:)/i.test(href)) return href;
    if (/^[a-z][\w+.-]*:|^\/\//i.test(href)) throw new Error(`Unsupported URL in ${page.name}: ${href}`);
    if (href.startsWith('#')) return href;
    const [path, suffix = ''] = href.split(/(?=[?#])/s, 2);
    const target = resolve(dirname(page.source), decodeURIComponent(path));
    if (pages.has(target)) return relativeUrl(page.destination, pages.get(target).destination) + suffix;
    if (target.startsWith(docs + sep) && target.endsWith('.md') && !markdownOnly.has(target)) throw new Error(`Unregistered guide in ${page.name}: ${href}`);
    if (!target.startsWith(root + sep)) throw new Error(`Link escapes repository in ${page.name}: ${href}`);
    // A local integration may be documented but absent from the public checkout.
    // Preserve its label without publishing a dead download link.
    if (!linkedResources.get(target)) return null;
    if (repository) return `${repository.replace(/\/$/, '')}/blob/${encodeURIComponent(ref)}/${slash(relative(root, target)).split('/').map(encodeURIComponent).join('/')}${suffix}`;
    return relativeUrl(page.destination, target) + suffix;
  };
  parser.use({ renderer: {
    html({ text }) { return escape(text); },
    heading({ tokens, depth }) {
      const html = this.parser.parseInline(tokens);
      const text = plain(html);
      const base = slug(text);
      const count = usedIds.get(base) || 0;
      usedIds.set(base, count + 1);
      const id = count ? `${base}-${count}` : base;
      headings.push({ depth, text, id });
      return `<h${depth} id="${escape(id)}">${html}${depth > 1 ? `<a class="heading-link" href="#${escape(id)}" aria-label="${en ? 'Link to' : 'Enlace a'} ${escape(text)}">#</a>` : ''}</h${depth}>\n`;
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const url = hrefFor(href);
      return url ? `<a href="${escape(url)}"${title ? ` title="${escape(title)}"` : ''}>${text}</a>` : `<span title="${en ? 'Available in the local checkout when configured' : 'Disponible en el checkout local si está configurado'}">${text}</span>`;
    },
    code({ text, lang }) {
      const language = (lang || 'text').split(/\s/)[0];
      return `<div class="code-block${language === 'mermaid' ? ' diagram-source' : ''}"><span class="code-label">${escape(language)}</span><pre><code class="language-${escape(language)}">${escape(text)}</code></pre></div>\n`;
    },
  } });
  const body = parser.parse(page.content).replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  const nav = [...pages.values()].filter(item => item.language === page.language).map(item => `<a href="${relativeUrl(page.destination, item.destination)}"${page === item ? ' aria-current="page"' : ''}>${escape(item.name.endsWith('README.md') ? (en ? 'Overview' : 'Introducción') : item.title)}</a>`).join('\n');
  const toc = headings.filter(item => item.depth === 2 || item.depth === 3).map(item => `<a class="depth-${item.depth}" href="#${escape(item.id)}">${escape(item.text)}</a>`).join('\n');
  const home = relativeUrl(page.destination, resolve(output, page.language, 'index.html'));
  const translation = relativeUrl(page.destination, pages.get(page.translation).destination);
  const sourceLink = repository ? `${repository.replace(/\/$/, '')}/blob/${encodeURIComponent(ref)}/docs/${page.name}` : relativeUrl(page.destination, page.source);
  const html = `<!doctype html>
<html lang="${page.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(page.title)} · Underqubit Sidecar MCP</title><meta name="description" content="${escape(`${page.title}. ${en ? 'Guides and reference for Underqubit Sidecar MCP.' : 'Guías y referencia de Underqubit Sidecar MCP.'}`)}">
<link rel="stylesheet" href="../assets/site.css"><link rel="alternate" hreflang="${en ? 'es' : 'en'}" href="${translation}"><script src="../assets/site.js" defer></script></head>
<body><a class="skip" href="#main">${en ? 'Skip to content' : 'Ir al contenido'}</a>
<header class="topbar"><div class="topbar-inner"><a class="brand" href="${home}" aria-label="Underqubit Sidecar MCP"><img src="../assets/underqubit-logo.png" alt="Underqubit" width="600" height="116"><span class="product">SIDECAR MCP</span></a><nav class="languages" aria-label="${en ? 'Language' : 'Idioma'}"><a href="${en ? translation : relativeUrl(page.destination, page.destination)}" lang="es" hreflang="es"${en ? '' : ' aria-current="true"'}>ES</a><a href="${en ? relativeUrl(page.destination, page.destination) : translation}" lang="en" hreflang="en"${en ? ' aria-current="true"' : ''}>EN</a></nav></div></header>
<div class="layout"><aside class="sidebar"><span class="nav-label">${label}</span><nav aria-label="${label}">${nav}</nav><small>v${escape(manifest.version)} · Node.js 24+<br>Apache License 2.0</small></aside>
<main id="main"><details class="mobile-nav"><summary>${en ? 'Browse guides' : 'Explorar guías'}</summary><nav aria-label="${label}">${nav}</nav></details><div class="eyebrow">Underqubit / ${label}</div><article>${body}</article><footer class="page-footer"><span>Underqubit · Sidecar MCP</span><a href="${escape(sourceLink)}">${en ? 'Markdown source' : 'Fuente Markdown'}</a></footer></main>
<aside class="toc" aria-label="${en ? 'On this page' : 'En esta página'}"><span class="nav-label">${en ? 'On this page' : 'En esta página'}</span>${toc}</aside></div></body></html>\n`;
  await mkdir(dirname(page.destination), { recursive: true });
  await writeFile(page.destination, html);
  generated.set(page.destination, html);
}
const landing = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Underqubit Sidecar MCP · Documentation</title><link rel="stylesheet" href="assets/site.css"></head><body><main class="landing"><div class="brand"><img src="assets/underqubit-logo.png" alt="Underqubit" width="600" height="116"></div><h1>Sidecar MCP</h1><p>Documentación / Documentation</p><p>REST APIs &amp; CLI → MCP tools</p><nav class="landing-links" aria-label="Idioma / Language"><a href="es/index.html" lang="es">Español →</a><a href="en/index.html" lang="en">English →</a></nav></main></body></html>\n`;
await writeFile(resolve(output, 'index.html'), landing);
generated.set(resolve(output, 'index.html'), landing);
await writeFile(resolve(output, '.nojekyll'), '');
// Validate the actual generated links, including cross-page fragments.
let links = 0;
for (const [file, html] of generated) {
  for (const [, encoded] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const href = encoded.replace(/&amp;/g, '&');
    if (/^[a-z][\w+.-]*:/i.test(href)) continue;
    const [path, hash] = href.split('#');
    const target = path ? resolve(dirname(file), decodeURIComponent(path)) : file;
    if (!await exists(target)) throw new Error(`Broken link in ${relative(output, file)}: ${href}`);
    if (hash && generated.has(target) && !generated.get(target).includes(`id="${escape(decodeURIComponent(hash))}"`)) throw new Error(`Missing anchor in ${relative(output, file)}: ${href}`);
    links++;
  }
}
console.log(`Built ${generated.size} HTML pages in docs/html; verified ${links} local links and assets.`);
