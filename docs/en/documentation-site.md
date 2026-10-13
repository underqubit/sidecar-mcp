# HTML documentation site

[Español](../sitio-documentacion.md) · [Back to index](README.md)

The HTML documentation is generated from Markdown in `docs/` and `docs/en/`. Both languages include sidebar navigation, a section index, permanent links, and a language switch that opens the translation of the same guide. The layout adapts to mobile screens and supports printing.

## Build and open the site

From a complete checkout with Node.js 24 or later:

```sh
npm ci
npm run docs:build
```

Open `docs/html/index.html` in a browser and choose Español or English. You can also serve `docs/html` with any static web server. Guide links are relative, so they work on both a custom domain and a GitHub Pages project prefix.

The generator removes and rebuilds only `docs/html`. Generated HTML is included in the repository for direct browsing; do not edit it manually. After editing Markdown, regenerate it before committing. GitHub Actions always rebuilds from source before publishing.

Building HTML does not require compiling the MCP server. The additional `npm run docs:check-schema` verification does compile the project to test documented schemas against the actual validator. The workflow runs this check before generating and deploying. The `marked` development dependency converts Markdown, tables, and code blocks into HTML. Literal HTML tags are escaped. The build validates local links, images, and anchors; invalid destinations cause it to fail.

## Edit content and navigation

1. Edit the Spanish guide and its counterpart in `docs/en/`.
2. For a new guide, register both paths under `pages` in `docs/site/pages.json`. Their order defines the navigation. Every guide in both directories must be registered under `pages` or `markdownOnly`.

Guides under `markdownOnly` stay Markdown only: they produce no HTML and do not appear in the navigation, and links from other guides point to their Markdown source, like links to examples or code. This guide and [npm publishing](npm-publishing.md) are on that list.
3. Run `npm run docs:build` and review both languages, including a narrow viewport.

To mention the package version in guides published as HTML, write `{{version}}`: the generator replaces it with the `package.json` version and fails on any other `{{...}}` placeholder. On GitHub and in the npm package, the Markdown shows the placeholder unreplaced, and `markdownOnly` guides are not processed, so they use the literal version.

Page titles and section indexes come from Markdown headings. Guide links become `.html` links while preserving fragments. Code blocks include a copy button when the browser provides clipboard access.

Source and example links point to the checkout in local builds. In GitHub Actions, the build automatically uses the current repository and commit. To generate a site outside Actions with links to a public repository:

```sh
DOCS_REPOSITORY_URL=https://github.com/OWNER/REPOSITORY \
DOCS_SOURCE_REF=main npm run docs:build
```

Repository files are not copied into the site. References to files absent from the checkout, such as an untracked local integration, retain their label without a download link.

## Visual identity

The styles adapt the `underqubit-proposals` skill from `underqubit-skills`: navy `#0B243F`, green `#4DBE94`, Lato headings, and navy table headers. The logo was extracted from its `assets/portada.pdf`; Lato Regular and Bold were copied from the skill, with their SIL OFL license. Asset origins are recorded in `docs/site/assets/PROVENANCE.txt`.

Assets live in `docs/site/assets/` and are copied to `docs/html/assets/`. Building does not require the skill to be installed. Fonts, logo, and styles are served locally, without Google Fonts.

Mermaid diagrams use the pinned `11.12.1` renderer from jsDelivr and require a connection. If the renderer cannot load, the original diagram source remains visible. The rest of the site works offline; clipboard functionality depends on browser capabilities and permissions.

## Deploy with GitHub Pages

In the GitHub repository, configure **Settings → Pages → Build and deployment → Source → GitHub Actions** once. This setting requires administrative access. No personal token is needed: the workflow uses `GITHUB_TOKEN` and the `github-pages` environment.

The `.github/workflows/docs.yml` workflow:

- Builds and validates pull requests changing `docs/**`, the generator, schema verifier, `src/config.ts`, `src/config-schema.ts`, dependencies, or the workflow itself, without deploying.
- Publishes to GitHub Pages when those changes reach `main`.
- Supports manual runs through **Actions → Documentation → Run workflow** from `main`.
- Uploads only `docs/html`, with Pages write permissions restricted to the deployment job.
- Exposes the final URL in the run's `github-pages` environment.

Server CI continues in `.github/workflows/ci.yml`. Documentation deployment depends on its own build and validation, independently of the server test suite. Any protection rules on the `github-pages` environment still apply. The workflow is ready in the repository; publication happens after the changes reach GitHub and Pages is enabled.

If `Configure Pages` fails, check the setting above and Pages availability for the repository. For build errors, the log identifies the guide or link to fix. If the primary branch changes, update the branch filter and `refs/heads/main` conditions in the workflow.

Reference: [custom GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
