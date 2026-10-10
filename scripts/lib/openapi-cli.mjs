import { readFile, writeFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseDocument, stringify } from 'yaml';
import { convertOpenApi } from './openapi-converter.mjs';

const help = `Generate a Sidecar integration from a local Swagger/OpenAPI JSON or YAML file.

  node scripts/openapi-to-config.mjs --input api.yaml --output tools.json

Options:
  --input <file>           Required local specification; no network requests.
  --output <file>          JSON/YAML output; stdout as JSON when omitted.
  --base-url <url>         Override API servers (required for relative URLs).
  --name <name>           Generated MCP server name.
  --prefix <prefix>       Prefix generated tool names.
  --env-prefix <prefix>   Credential variable prefix (default: OPENAPI).
  --methods GET,HEAD      Include only these HTTP methods (default: all).
  --tags pets,users       Include operations matching any listed tag.
  --skip-unsupported      Explicitly omit unsupported operations and report them.
  --force                 Replace an existing output file.
  --help                  Show this help.

Supports Swagger 2.0 and OpenAPI 3.0.x/3.1.x/3.2.x, using local references only.
Run npm run build first. Credentials are emitted as environment references.
Warnings and required variable names go to stderr, never into JSON stdout.
`;

export async function main(family) {
  const { values } = parseArgs({ options: {
    input: { type: 'string' }, output: { type: 'string' }, 'base-url': { type: 'string' },
    name: { type: 'string' }, prefix: { type: 'string' }, 'env-prefix': { type: 'string' },
    methods: { type: 'string' }, tags: { type: 'string' }, 'skip-unsupported': { type: 'boolean' },
    force: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { process.stdout.write(help); return; }
  if (!values.input) throw new Error('--input is required. Use --help for options.');
  const source = resolve(values.input);
  const sourceText = await readFile(source, 'utf8');
  if (Buffer.byteLength(sourceText) > 16 * 1024 * 1024) throw new Error('The specification exceeds 16 MiB.');
  const extension = extname(source).toLowerCase();
  let document;
  if (extension === '.json') document = JSON.parse(sourceText);
  else if (['.yaml', '.yml'].includes(extension)) {
    const yaml = parseDocument(sourceText, { uniqueKeys: true });
    if (yaml.errors.length) throw new Error('Invalid YAML or duplicate keys.');
    document = yaml.toJS({ maxAliasCount: 0 });
  } else throw new Error('--input must be a .json, .yaml, or .yml file.');
  const csv = value => value === undefined ? undefined : value.split(',').map(item => item.trim()).filter(Boolean);
  if (values.methods !== undefined && !csv(values.methods).length) throw new Error('--methods cannot be empty.');
  if (values.tags !== undefined && !csv(values.tags).length) throw new Error('--tags cannot be empty.');
  let validate;
  try { validate = (await import('../../dist/config.js')).prepareConfig; }
  catch { throw new Error('Build the project first: npm run build.'); }
  const result = await convertOpenApi(document, {
    family, baseUrl: values['base-url'], name: values.name, prefix: values.prefix,
    envPrefix: values['env-prefix'], methods: csv(values.methods), tags: csv(values.tags), skipUnsupported: values['skip-unsupported'],
  });
  const destination = values.output ? resolve(values.output) : undefined;
  if (destination) {
    if (!['.json', '.yaml', '.yml'].includes(extname(destination).toLowerCase())) throw new Error('--output must be a .json, .yaml, or .yml file.');
    const sourceStat = await stat(source);
    const destinationStat = await stat(destination).catch(() => undefined);
    if ((destinationStat && sourceStat.dev === destinationStat.dev && sourceStat.ino === destinationStat.ino) || source === destination || await realpath(source) === await realpath(destination).catch(() => undefined)) throw new Error('The output must not overwrite the input specification.');
    const schemaPath = relative(dirname(destination), fileURLToPath(new URL('../../schema/config.schema.json', import.meta.url))).split('\\').join('/');
    result.config = { $schema: schemaPath, ...result.config };
  }
  const environment = Object.create(null);
  for (const match of JSON.stringify(result.config.auth).matchAll(/\$\{env\.([A-Za-z_][A-Za-z0-9_]*)\}/g)) environment[match[1]] = 'replace-me';
  // Structural and semantic validation only: never contact a service to validate credentials.
  await validate(result.config, destination ? dirname(destination) : process.cwd(), environment);
  const serialized = destination && ['.yaml', '.yml'].includes(extname(destination).toLowerCase())
    ? stringify(result.config, { aliasDuplicateObjects: false }) : `${JSON.stringify(result.config, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > 4 * 1024 * 1024) throw new Error('The generated configuration exceeds 4 MiB; narrow --tags or --methods.');
  for (const warning of result.warnings) process.stderr.write(`Warning: ${warning}\n`);
  for (const skipped of result.skipped) process.stderr.write(`Skipped: ${skipped}\n`);
  if (destination) await writeFile(destination, serialized, { flag: values.force ? 'w' : 'wx' });
  else process.stdout.write(serialized);
  process.stderr.write(`Generated ${result.config.tools.length} tools; skipped ${result.skipped.length} operations.\n`);
  if (Object.keys(environment).length) process.stderr.write(`Required environment variables: ${Object.keys(environment).sort().join(', ')}\n`);
}

export function run(family) {
  main(family).catch(error => {
    // Specifications may contain private defaults; do not print JSON/YAML parser excerpts.
    const message = error instanceof SyntaxError ? 'Invalid JSON specification.' : error.code === 'EEXIST'
      ? 'Output already exists. Use another path or --force to replace it.'
      : error.code === 'ENOENT' ? 'Input file or output directory does not exist.' : error.message;
    process.stderr.write(`OpenAPI generation failed: ${message}\n`); process.exitCode = 1;
  });
}
