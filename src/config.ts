import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { createRequire } from 'node:module';
import { configSchema, type Config } from './config-schema.js';
import { SidecarError } from './errors.js';
import { references, renderString, walkStrings, type Environment } from './templates.js';
import { validateResponse } from './response.js';

// AJV's CJS format plugin is callable at runtime; createRequire avoids NodeNext default-import ambiguity.
const addFormats = createRequire(import.meta.url)('ajv-formats') as (ajv: Ajv2020) => void;

export function newValidator(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: true, ownProperties: true, validateFormats: true });
  addFormats(ajv);
  // Metadata supported by MCP, not a validation keyword.
  ajv.addKeyword({ keyword: 'x-mcp-header', schemaType: 'string', valid: true });
  return ajv;
}

const schemaMaps = new Set(['$defs', 'definitions', 'properties', 'patternProperties', 'dependentSchemas', 'dependencies']);
const schemaArrays = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const singleSchemas = new Set([
  'additionalProperties', 'unevaluatedProperties', 'propertyNames', 'items', 'additionalItems',
  'unevaluatedItems', 'contains', 'not', 'if', 'then', 'else',
]);

function validateSchemaRefs(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (key === '$async') throw new SidecarError('config', 'JSON Schemas must be synchronous.');
    if ((key === '$ref' || key === '$dynamicRef') && (typeof nested !== 'string' || !nested.startsWith('#'))) {
      throw new SidecarError('config', 'Only internal JSON Schema references (#...) are allowed.');
    }
    // Only descend into subschemas. Property names, defaults, examples and const/enum
    // values may legitimately contain strings or fields named "$ref" or "$async".
    if (schemaMaps.has(key) && nested && typeof nested === 'object' && !Array.isArray(nested)) {
      Object.values(nested).forEach(validateSchemaRefs);
    } else if (schemaArrays.has(key) && Array.isArray(nested)) {
      nested.forEach(validateSchemaRefs);
    } else if (singleSchemas.has(key)) {
      validateSchemaRefs(nested);
    }
  }
}

export function httpUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new SidecarError('config', 'Invalid HTTP URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new SidecarError('config', 'Use HTTP/HTTPS without embedded credentials or fragments.');
  }
  return url;
}

export interface LoadedConfig { config: Config; directory: string; env: Environment }

export async function prepareConfig(raw: unknown, directory: string, environment: Environment = process.env): Promise<LoadedConfig> {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SidecarError('config', `Invalid configuration at: ${parsed.error.issues.map(i => i.path.join('.') || 'root').join(', ')}.`);
  }
  const config = parsed.data;
  // Snapshot only referenced variables. Runtime workers never receive the process environment.
  const env: Record<string, string> = {};
  const inspect = (value: unknown, allowInput: boolean): void => walkStrings(value, text => {
    for (const ref of references(text)) {
      if (ref.source === 'input' && !allowInput) throw new SidecarError('config', 'This field only accepts fixed values or environment variables.');
      if (ref.source === 'env') {
        const secret = environment[ref.path];
        if (secret === undefined || secret === '') throw new SidecarError('config', `Required environment variable: ${ref.path}.`);
        env[ref.path] = secret;
      }
    }
  });
  inspect(config.auth, false);
  for (const auth of Object.values(config.auth)) {
    if (auth.type === 'oauth2') httpUrl(renderString(auth.tokenUrl, {}, env));
  }
  const names = new Set<string>();
  for (const tool of config.tools) {
    if (names.has(tool.name)) throw new SidecarError('config', `Duplicate tool: ${tool.name}.`);
    names.add(tool.name);
    for (const [kind, schema] of [['inputSchema', tool.inputSchema], ['outputSchema', tool.outputSchema]] as const) {
      validateSchemaRefs(schema);
      try { newValidator().compile(schema); } catch {
        throw new SidecarError('config', `Invalid or unsupported JSON Schema at ${tool.name}.${kind}.`);
      }
    }
    inspect(tool.execution, true);
    const execution = tool.execution;
    if (execution.type === 'http') {
      inspect(execution.baseUrl, false);
      const base = httpUrl(renderString(execution.baseUrl, {}, env));
      if (base.search) throw new SidecarError('config', 'Declare query parameters separately from baseUrl.');
      if (execution.path.includes('${')) throw new SidecarError('config', 'Use {parameter} and pathParams in the HTTP path.');
      const required = [...execution.path.matchAll(/\{([A-Za-z0-9_-]+)\}/g)].map(m => m[1]!);
      if (required.some(key => !Object.hasOwn(execution.pathParams, key))) throw new SidecarError('config', 'A parameter declared in the HTTP path is missing.');
      const route = new URL(execution.path, base);
      if (route.origin !== base.origin || route.username || route.password || route.hash) throw new SidecarError('config', 'The HTTP path must preserve the configured origin.');
      if (execution.auth && !Object.hasOwn(config.auth, execution.auth)) throw new SidecarError('config', `Authentication profile not found for ${tool.name}.`);
    } else {
      inspect(execution.command, false);
      if (execution.cwd) inspect(execution.cwd, false);
      execution.cwd = resolve(directory, execution.cwd ? renderString(execution.cwd, {}, env) : '.');
      execution.command = renderString(execution.command, {}, env);
      if (execution.command.includes('/') || execution.command.includes('\\')) execution.command = resolve(directory, execution.command);
    }
    await validateResponse(tool.response);
  }
  return { config, directory, env };
}

export async function readConfigFile(file: string): Promise<unknown> {
  let raw: unknown;
  try {
    const content = await readFile(file, 'utf8');
    if (Buffer.byteLength(content) > 4 * 1024 * 1024) throw new Error('size');
    if (extname(file).toLowerCase() === '.json') raw = JSON.parse(content);
    else if (['.yaml', '.yml'].includes(extname(file).toLowerCase())) {
      const doc = parseDocument(content, { uniqueKeys: true });
      if (doc.errors.length) throw new Error('yaml');
      raw = doc.toJS({ maxAliasCount: 0 });
    } else throw new Error('extension');
  } catch { throw new SidecarError('config', 'Could not read a valid YAML/JSON file (maximum 4 MiB; YAML aliases are not allowed).'); }
  return raw;
}

export async function loadConfig(file: string, env: Environment = process.env): Promise<LoadedConfig> {
  return prepareConfig(await readConfigFile(file), dirname(resolve(file)), env);
}
