import { createHash } from 'node:crypto';
import { validateHeaderName } from 'node:http';
import { SchemaBuilder, resolveObject } from './openapi-schema.mjs';

const supportedMethods = new Set(['get', 'head', 'post', 'put', 'patch', 'delete', 'options']);
const operationMethods = new Set([...supportedMethods, 'trace', 'query']);
const scalarTypes = new Set(['string', 'integer', 'number', 'boolean']);
const own = (object, key) => Object.hasOwn(object, key);
const inputRef = name => `\${input.${name}}`;
const envRef = name => `\${env.${name}}`;
const objectRoot = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const identifier = text => String(text).replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'operation';
const digest = text => createHash('sha256').update(text).digest('hex').slice(0, 10);

function absoluteUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('An absolute API URL is required; pass --base-url for relative or missing servers.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || value.includes('${')) throw new Error('API URLs must use HTTP(S) without credentials, query, fragments, or templates.');
  return url.href.replace(/\/$/, '');
}

function baseUrl(document, pathItem, operation, v2, options, warn) {
  if (options.baseUrl) return absoluteUrl(options.baseUrl);
  if (v2) {
    if (!document.host) throw new Error('Swagger host is missing; pass --base-url.');
    const schemes = operation.schemes ?? document.schemes ?? ['https'];
    if (schemes.length > 1) warn('Using the first Swagger scheme; --base-url overrides it.');
    if (!operation.schemes && !document.schemes) warn('Swagger schemes is missing; using HTTPS.');
    return absoluteUrl(`${schemes[0]}://${document.host}${document.basePath ?? ''}`);
  }
  const servers = operation.servers ?? pathItem.servers ?? document.servers ?? [];
  if (!servers.length) throw new Error('No absolute server URL is available; pass --base-url.');
  if (servers.length > 1) warn('Using the first server at the most specific level; --base-url overrides it.');
  const server = servers[0];
  const url = server.url.replace(/\{([^}]+)\}/g, (_match, key) => {
    const variable = server.variables?.[key];
    if (!variable || typeof variable.default !== 'string') throw new Error(`Server variable ${key} has no string default.`);
    if (variable.enum && !variable.enum.includes(variable.default)) throw new Error(`Server variable ${key} has an invalid default.`);
    return variable.default;
  });
  if (url.includes('{') || url.includes('}')) throw new Error('Unresolved server variables.');
  return absoluteUrl(url);
}

function selectContent(content, supported, warn, label) {
  const keys = Object.keys(content ?? {});
  const selected = supported.find(type => keys.includes(type));
  if (!selected) throw new Error(`${label} has no supported media type (${keys.join(', ') || 'none'}).`);
  if (keys.length > 1) warn(`${label}: using ${selected}; other media types are not generated.`);
  return [selected, content[selected]];
}

function parameterSchema(parameter, v2) {
  if (!v2) {
    if (parameter.content) throw new Error('Parameter content serialization requires manual mapping.');
    return parameter.schema ?? {};
  }
  if (parameter.in === 'body') return parameter.schema ?? {};
  return Object.fromEntries(Object.entries(parameter).filter(([key]) => !['name', 'in', 'required', 'collectionFormat', 'allowEmptyValue'].includes(key)));
}

function parameterKind(document, raw, modern) {
  const schema = resolveObject(document, raw, modern);
  if (!scalarTypes.has(schema.type) && schema.type !== 'array') throw new Error('Only scalar parameters and repeated scalar query/form arrays are supported.');
  if (schema.nullable || schema['x-nullable'] || Array.isArray(schema.type)) throw new Error('Nullable non-body parameters require manual mapping (null is reserved for omission).');
  if (schema.type === 'array') {
    const items = resolveObject(document, schema.items, modern);
    if (!scalarTypes.has(items.type) || items.nullable || items['x-nullable']) throw new Error('Parameter arrays must contain non-null scalars.');
  }
  return schema.type;
}

function checkSerialization(parameter, kind, v2) {
  const location = parameter.in;
  if (!['path', 'query', 'header', 'formData'].includes(location)) throw new Error(`Parameter location ${location} is not supported.`);
  if (parameter.allowReserved === true) throw new Error('allowReserved=true is not supported.');
  if (v2) {
    if (kind === 'array' && (!['query', 'formData'].includes(location) || parameter.collectionFormat !== 'multi')) throw new Error('Swagger arrays require collectionFormat=multi in query/formData; CSV/SSV/TSV/pipes need manual mapping.');
  } else {
    const style = parameter.style ?? (['query', 'formData'].includes(location) ? 'form' : 'simple');
    if (style !== (['query', 'formData'].includes(location) ? 'form' : 'simple')) throw new Error(`Parameter style ${style} is not supported.`);
    if (kind === 'array' && (!['query', 'formData'].includes(location) || parameter.explode === false)) throw new Error('Arrays require form style with explode=true in query/form fields.');
  }
}

function responseMapping(document, operation, v2, method, builder, warn) {
  const responses = operation.responses ?? {};
  const statuses = Object.keys(responses).filter(status => /^2\d\d$/.test(status)).sort();
  if (!statuses.length) throw new Error('At least one explicit 2xx response is required (default/2XX alone is ambiguous).');
  const status = statuses[0];
  if (statuses.length > 1) warn(`Only HTTP ${status} is generated; other documented successful statuses require review.`);
  const response = resolveObject(document, responses[status], !v2);
  if (method === 'head' || ['204', '205'].includes(status) || (v2 ? !response.schema : !response.content || !Object.keys(response.content).length)) {
    return { status: Number(status), schema: { type: 'null' }, response: { parser: { type: 'text' }, transform: '{"data": null}' } };
  }
  let media, schema;
  if (v2) {
    const produces = operation.produces ?? document.produces ?? ['application/json'];
    [media] = selectContent(Object.fromEntries(produces.map(type => [type, {}])), ['application/json', 'text/plain'], warn, 'Response');
    schema = response.schema;
  } else {
    const selected = selectContent(response.content, ['application/json', ...Object.keys(response.content).filter(type => /^application\/[^;]+\+json$/.test(type)), 'text/plain'], warn, 'Response');
    media = selected[0]; schema = selected[1].schema ?? {};
    if (selected[1].itemSchema) throw new Error('Streaming response itemSchema requires manual mapping.');
  }
  if (media === 'text/plain' && typeof schema !== 'boolean') {
    const resolved = resolveObject(document, schema ?? {}, builder.modern);
    if (resolved.type && resolved.type !== 'string') throw new Error('Text responses require a string-compatible schema.');
  }
  return { status: Number(status), schema: builder.convert(schema),
    accept: media, response: { parser: { type: media === 'text/plain' ? 'text' : 'json' }, transform: '{"data": data}' } };
}

function authentication(document, operation, v2, warn, options) {
  const requirements = operation.security ?? document.security ?? [];
  if (!Array.isArray(requirements)) throw new Error('security must be an array.');
  if (!requirements.length) return undefined;
  // Never silently turn a secured operation into an anonymous one.
  const requirement = requirements[0];
  if (requirements.length > 1) warn('Using the first security alternative only.');
  const entries = Object.entries(requirement);
  if (!entries.length) { warn('The first security alternative allows anonymous access.'); return undefined; }
  if (entries.length !== 1) throw new Error('Combined security schemes (AND) are not supported by one authentication profile.');
  const [name, scopes] = entries[0];
  const definitions = v2 ? document.securityDefinitions : document.components?.securitySchemes;
  const scheme = resolveObject(document, definitions?.[name], !v2);
  const prefix = `${options.envPrefix ?? 'OPENAPI'}_${identifier(name).toUpperCase()}_${digest(name).slice(0, 6).toUpperCase()}`;
  const profile = `auth_${identifier(name)}_${digest(JSON.stringify([name, scopes]))}`;
  let config;
  if (scheme.type === 'apiKey' && ['header', 'query'].includes(scheme.in)) {
    if (!scheme.name) throw new Error('API key scheme has no name.');
    if (scheme.in === 'header') validateHeaderName(scheme.name);
    config = { type: 'apiKey', in: scheme.in, name: scheme.name, value: envRef(`${prefix}_API_KEY`) };
  } else if (scheme.type === 'basic' || (scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'basic')) {
    config = { type: 'basic', username: envRef(`${prefix}_USERNAME`), password: envRef(`${prefix}_PASSWORD`) };
  } else if (scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'bearer') {
    config = { type: 'bearer', token: envRef(`${prefix}_TOKEN`) };
  } else if (scheme.type === 'oauth2') {
    const flow = v2 ? (scheme.flow === 'application' ? scheme : undefined) : scheme.flows?.clientCredentials;
    if (!flow) throw new Error('Only OAuth2 client_credentials is supported; interactive flows require manual mapping.');
    if (!Array.isArray(scopes) || scopes.some(scope => !own(flow.scopes ?? {}, scope))) throw new Error('OAuth scopes are missing or undeclared.');
    const tokenUrl = absoluteUrl(flow.tokenUrl);
    warn('OAuth2 uses client_secret_basic; review tokenAuthMethod for your provider.');
    config = { type: 'oauth2', tokenUrl, clientId: envRef(`${prefix}_CLIENT_ID`), clientSecret: envRef(`${prefix}_CLIENT_SECRET`), scopes, tokenAuthMethod: 'basic' };
  } else throw new Error(`Security scheme ${scheme.type} is not supported.`);
  return { profile, config };
}

function convertOperation(document, path, pathItem, method, operation, context) {
  const { v2, modern, warn, options } = context;
  if (!supportedMethods.has(method)) throw new Error(`HTTP method ${method.toUpperCase()} is not supported by the runtime.`);
  if (operation.callbacks && Object.keys(operation.callbacks).length) warn('Callbacks are not generated.');
  if (!path.startsWith('/') || path.startsWith('//') || /[?#$\\]/.test(path)) throw new Error('Paths must start with one slash and contain no query, fragment, or template expression.');
  const input = new SchemaBuilder(document, { modern, direction: 'input', warn });
  const output = new SchemaBuilder(document, { modern, direction: 'output', warn });
  const properties = Object.create(null);
  const execution = { type: 'http', baseUrl: baseUrl(document, pathItem, operation, v2, options, warn), path: `./${path.slice(1)}`, method: method.toUpperCase(), pathParams: Object.create(null), query: Object.create(null), headers: Object.create(null) };
  const names = new Set();
  const addInput = (suggested, raw, description, optionalOmission = false) => {
    let name = identifier(suggested); let n = 2;
    while (names.has(name) || ['constructor', 'prototype', '__proto__'].includes(name)) name = `${identifier(suggested)}_${n++}`;
    names.add(name);
    let schema = input.convert(raw);
    if (optionalOmission) schema = { anyOf: [schema, { type: 'null' }] };
    if (description || optionalOmission) schema = { ...((typeof schema === 'boolean') ? { allOf: [schema] } : schema), description: [description, optionalOmission ? 'Pass null to omit this optional parameter. The key itself is required.' : ''].filter(Boolean).join(' ') };
    properties[name] = schema;
    return inputRef(name);
  };
  const merged = new Map();
  for (const parameter of [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]) {
    const resolved = resolveObject(document, parameter, modern);
    if (typeof resolved.name !== 'string' || !resolved.name) throw new Error('Parameter name is required.');
    merged.set(`${resolved.in}:${resolved.in === 'header' ? resolved.name.toLowerCase() : resolved.name}`, resolved);
  }
  let bodyParameter;
  const formFields = [];
  const pathNames = new Map();
  for (const parameter of merged.values()) {
    if (v2 && parameter.in === 'body') {
      if (bodyParameter) throw new Error('Only one body parameter is supported.');
      bodyParameter = parameter; continue;
    }
    if (v2 && parameter.in === 'formData') { formFields.push(parameter); continue; }
    if (!v2 && parameter.in === 'header' && ['accept', 'content-type', 'authorization'].includes(parameter.name.toLowerCase())) {
      warn(`Ignoring OpenAPI reserved header parameter ${parameter.name}; use content/security definitions.`); continue;
    }
    const raw = parameterSchema(parameter, v2);
    const kind = parameterKind(document, raw, modern);
    checkSerialization(parameter, kind, v2);
    if (parameter.in === 'path' && !parameter.required) throw new Error('Path parameters must be required.');
    if (parameter.in === 'header') {
      validateHeaderName(parameter.name);
      if (v2 && ['accept', 'content-type'].includes(parameter.name.toLowerCase())) throw new Error('Use produces/consumes instead of Swagger Accept/Content-Type parameters.');
    }
    if (!parameter.required && parameter.in === 'header') warn(`Optional header ${parameter.name} becomes required because the runtime cannot omit header templates.`);
    const reference = addInput(`${parameter.in}_${parameter.name}`, raw, parameter.description, parameter.in === 'query' && !parameter.required);
    if (parameter.in === 'path') {
      const alias = `p${pathNames.size}`; pathNames.set(parameter.name, alias); execution.pathParams[alias] = reference;
    } else if (parameter.in === 'query') execution.query[parameter.name] = reference;
    else execution.headers[parameter.name] = reference;
  }
  const usedPaths = new Set();
  execution.path = execution.path.replace(/\{([^{}]+)\}/g, (_match, name) => {
    if (!pathNames.has(name)) throw new Error(`Path placeholder ${name} has no parameter.`);
    usedPaths.add(name); return `{${pathNames.get(name)}}`;
  });
  if (usedPaths.size !== pathNames.size) throw new Error('A path parameter is absent from the URL template.');
  if (path.split('/').some(segment => { try { return ['.', '..'].includes(decodeURIComponent(segment)); } catch { return true; } })) throw new Error('Dot segments and malformed escaping are not supported in paths.');

  const addForm = fields => {
    execution.bodyEncoding = 'form'; execution.body = Object.create(null);
    for (const field of fields) {
      const raw = parameterSchema(field, v2);
      if (resolveObject(document, raw, modern).readOnly) continue;
      checkSerialization(field, parameterKind(document, raw, modern), v2);
      execution.body[field.name] = addInput(`form_${field.name}`, raw, field.description, !field.required);
    }
  };
  if (v2 && formFields.length) {
    if (bodyParameter) throw new Error('Body and formData cannot be combined.');
    const consumes = operation.consumes ?? document.consumes ?? [];
    selectContent(Object.fromEntries(consumes.map(type => [type, {}])), ['application/x-www-form-urlencoded'], warn, 'Request');
    addForm(formFields);
  } else if (bodyParameter || (!v2 && operation.requestBody)) {
    const request = bodyParameter ?? resolveObject(document, operation.requestBody, modern);
    if (!request.required) warn('Optional request body becomes required because the runtime cannot omit its template.');
    let media, raw, encoding;
    if (v2) {
      [media] = selectContent(Object.fromEntries((operation.consumes ?? document.consumes ?? ['application/json']).map(type => [type, {}])), ['application/json', 'text/plain'], warn, 'Request');
      raw = request.schema ?? {};
    } else {
      const selected = selectContent(request.content, ['application/json', 'application/x-www-form-urlencoded', 'text/plain'], warn, 'Request');
      media = selected[0]; raw = selected[1].schema ?? {}; encoding = selected[1].encoding;
      if (selected[1].itemSchema) throw new Error('Streaming request itemSchema is not supported.');
    }
    if (media === 'application/x-www-form-urlencoded') {
      const schema = resolveObject(document, raw, modern);
      if (schema.type !== 'object' || schema.allOf || schema.anyOf || schema.oneOf || !schema.properties || schema.additionalProperties !== false || Object.keys(schema).some(key => !['type', 'properties', 'required', 'additionalProperties', 'description', 'title'].includes(key))) throw new Error('URL-encoded bodies require a simple object with fixed properties and additionalProperties=false.');
      if (encoding && Object.values(encoding).some(value => Object.keys(value).some(key => !['style', 'explode', 'allowReserved'].includes(key)))) throw new Error('Form encoding headers/contentType require manual mapping.');
      addForm(Object.entries(schema.properties).map(([name, child]) => ({ name, in: 'formData', schema: child, required: schema.required?.includes(name) ?? false, ...encoding?.[name] })));
    } else {
      if (media === 'text/plain' && resolveObject(document, raw, modern).type !== 'string') throw new Error('Text request bodies require a string schema.');
      execution.bodyEncoding = media === 'text/plain' ? 'text' : 'json';
      execution.body = addInput('body', raw, request.description);
    }
  }
  const auth = authentication(document, operation, v2, warn, options);
  if (auth) {
    const name = auth.config.type === 'apiKey' ? auth.config.name : 'Authorization';
    const location = auth.config.type === 'apiKey' && auth.config.in === 'query' ? execution.query : execution.headers;
    if (Object.keys(location).some(key => location === execution.headers ? key.toLowerCase() === name.toLowerCase() : key === name)) throw new Error('Authentication collides with an explicitly declared parameter.');
    execution.auth = auth.profile;
  }
  const result = responseMapping(document, operation, v2, method, output, warn);
  execution.successStatuses = [result.status];
  if (result.accept) execution.headers.Accept = result.accept;
  if (auth?.config.type === 'apiKey' && auth.config.in === 'header' && ['accept', 'content-type'].includes(auth.config.name.toLowerCase())) throw new Error('API key headers must not override the generated media type headers.');
  const sourceName = operation.operationId || `${method}_${path}`;
  let name = `${options.prefix ? `${identifier(options.prefix)}_` : ''}${identifier(sourceName)}`;
  if (name.length > 128) name = `${name.slice(0, 117)}_${digest(name)}`;
  const tool = { name, description: operation.description || operation.summary || `${method.toUpperCase()} ${path}`,
    inputSchema: input.finish(objectRoot(properties)), outputSchema: output.finish(objectRoot({ data: result.schema })),
    annotations: { readOnlyHint: ['get', 'head', 'options'].includes(method), destructiveHint: !['get', 'head', 'options'].includes(method), idempotentHint: ['get', 'head', 'options', 'put', 'delete'].includes(method), openWorldHint: true },
    execution, response: result.response };
  return { tool, auth };
}

export async function convertOpenApi(document, options = {}) {
  if (!document || typeof document !== 'object') throw new Error('Expected an OpenAPI document.');
  const v2 = document.swagger === '2.0';
  if (!v2 && !/^3\.[012]\.\d+$/.test(document.openapi ?? '')) throw new Error('Supported versions: Swagger 2.0 and OpenAPI 3.0.x, 3.1.x, 3.2.x.');
  if (options.family && (options.family === '2') !== v2) throw new Error(`This entry point requires OpenAPI ${options.family}.x.`);
  if (options.envPrefix && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.envPrefix)) throw new Error('--env-prefix must be an environment variable identifier.');
  const modern = !v2 && !document.openapi.startsWith('3.0.');
  if (!document.paths || typeof document.paths !== 'object') throw new Error('The document must declare paths.');
  if (document.jsonSchemaDialect && !['https://spec.openapis.org/oas/3.1/dialect/base', 'https://spec.openapis.org/oas/3.2/dialect/base', 'https://json-schema.org/draft/2020-12/schema'].includes(document.jsonSchemaDialect)) throw new Error('Custom JSON Schema dialects require manual conversion.');
  const warnings = []; const skipped = []; const auth = Object.create(null); const tools = []; const names = new Set();
  if (document.webhooks) warnings.push('Webhooks are not generated; only paths operations become tools.');
  const methods = options.methods?.map(method => method.toLowerCase());
  if (methods?.some(method => !operationMethods.has(method))) throw new Error('--methods contains an unknown HTTP method.');
  // Use the same validators as the runtime, without requiring real credentials or making requests.
  const { newValidator } = await import('../../dist/config.js');
  for (const [path, rawPath] of Object.entries(document.paths)) {
    if (path.startsWith('x-')) continue;
    const pathItem = resolveObject(document, rawPath, modern);
    const operations = Object.entries(pathItem).filter(([method]) => operationMethods.has(method));
    for (const [method, value] of Object.entries(pathItem.additionalOperations ?? {})) operations.push([method.toLowerCase(), value]);
    for (const [method, operation] of operations) {
      if (methods && !methods.includes(method)) continue;
      if (options.tags?.length && !options.tags.some(tag => operation.tags?.includes(tag))) continue;
      const label = `${method.toUpperCase()} ${path}`;
      const localWarnings = [];
      try {
        const converted = convertOperation(document, path, pathItem, method, operation, { v2, modern, options, warn: message => localWarnings.push(`${label}: ${message}`) });
        let name = converted.tool.name;
        if (names.has(name)) {
          name = `${name.slice(0, 117)}_${digest(label)}`;
          if (names.has(name)) throw new Error('Duplicate generated tool name.');
          converted.tool.name = name;
          localWarnings.push(`${label}: tool name collision resolved as ${name}.`);
        }
        try { newValidator().compile(converted.tool.inputSchema); newValidator().compile(converted.tool.outputSchema); }
        catch { throw new Error('Converted schema is not accepted by the runtime; review schema constraints or unsupported combinations.'); }
        names.add(name); tools.push(converted.tool);
        if (converted.auth) auth[converted.auth.profile] = converted.auth.config;
        warnings.push(...localWarnings);
      } catch (error) {
        const message = `${label}: ${error.message}`;
        if (!options.skipUnsupported) throw new Error(`${message} Use --skip-unsupported to explicitly omit unsupported operations.`);
        skipped.push(message);
      }
    }
  }
  if (!tools.length) throw new Error(`No supported operations remain after filtering. ${skipped.join(' ')}`);
  return { config: { version: 1, server: { name: options.name ?? `${identifier(document.info?.title ?? 'openapi').toLowerCase()}-mcp`, transport: 'stdio' }, auth, tools }, warnings: [...new Set(warnings)], skipped };
}
