import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import nock from 'nock';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareConfig } from '../dist/config.js';
import { Runtime } from '../dist/runtime.js';

const exec = promisify(execFile);
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  nock.abortPendingRequests(); nock.cleanAll(); nock.enableNetConnect();
});
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'sidecar-openapi-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true })); return dir;
}
const baseSpec = () => ({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, servers: [{ url: 'https://api.test/v1' }], paths: {
  '/items': { get: { operationId: 'list_items', responses: { '200': { description: 'Items', content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } } } } },
} });
async function generate(document: unknown, args: string[] = [], entry = 'openapi-to-config.mjs') {
  const dir = await directory(); const path = join(dir, 'spec.json');
  await writeFile(path, JSON.stringify(document));
  const result = await exec(process.execPath, [`scripts/${entry}`, '--input', path, ...args]);
  return { ...result, config: result.stdout ? JSON.parse(result.stdout) : undefined };
}
async function runtime(config: unknown, env: Record<string, string> = {}) {
  const r = new Runtime(await prepareConfig(config, '.', env), () => {}); cleanup.push(() => r.close()); return r;
}
async function fixture(version: '2' | '3') {
  return parse(await readFile(`examples/openapi/${version === '2' ? 'swagger2' : 'openapi3'}.yaml`, 'utf8'));
}
const objectResponse = { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } };

describe('OpenAPI generators', () => {
  it('generates Swagger 2 tools with auth, path encoding, optional repeated queries, and readOnly projection', async () => {
    const { config } = await generate(await fixture('2'), [], 'openapi2-to-config.mjs');
    const variables = [...JSON.stringify(config.auth).matchAll(/\$\{env\.([^}]+)\}/g)].map(match => match[1]!);
    const r = await runtime(config, Object.fromEntries(variables.map(name => [name, 'secret'])));
    nock.disableNetConnect();
    const get = nock('https://catalog.example.com').get('/api/v2/items/a%2Fb').query({ fields: ['name', 'id'] }).matchHeader('X-API-Key', 'secret').reply(200, { id: 'a/b', name: 'sample' });
    expect((await r.call('get_item', { path_id: 'a/b', query_fields: ['name', 'id'] })).structuredContent).toEqual({ data: { id: 'a/b', name: 'sample' } });
    const omitted = nock('https://catalog.example.com').get('/api/v2/items/1').query({}).reply(200, { id: '1', name: 'one' });
    expect((await r.call('get_item', { path_id: '1', query_fields: null })).isError).toBeUndefined();
    expect(await r.call('get_item', { path_id: '1' })).toMatchObject({ isError: true });
    const post = nock('https://catalog.example.com').post('/api/v2/items', { name: 'new' }).reply(201, { id: '2', name: 'new' });
    expect((await r.call('create_item', { body: { name: 'new' } })).structuredContent).toEqual({ data: { id: '2', name: 'new' } });
    expect(get.isDone() && omitted.isDone() && post.isDone()).toBe(true);
  });

  it.each(['3.0.4', '3.1.2', '3.2.0', '3.2.1'])('supports OpenAPI %s and preserves empty/singleton arrays and no-content responses', async version => {
    const document = await fixture('3'); document.openapi = version;
    const { config } = await generate(document, [], 'openapi3-to-config.mjs');
    const variable = JSON.stringify(config.auth).match(/\$\{env\.([^}]+)\}/)![1]!;
    const r = await runtime(config, { [variable]: 'token' }); nock.disableNetConnect();
    for (const items of [[], [{ id: '1', name: 'one' }], [{ id: '1', name: 'one' }, { id: '2', name: 'two' }]]) {
      nock('https://catalog.example.com').get('/api/v3/items').query({}).matchHeader('Authorization', 'Bearer token').reply(200, items);
      expect((await r.call('list_items', { query_limit: null })).structuredContent).toEqual({ data: items });
    }
    nock('https://catalog.example.com').delete('/api/v3/items/1').reply(204);
    expect((await r.call('delete_item', { path_id: '1' })).structuredContent).toEqual({ data: null });
    expect(config.tools.find((tool: { name: string }) => tool.name === 'delete_item').annotations.destructiveHint).toBe(true);
  });

  it('keeps recursive refs local, converts nullable/exclusive bounds, and excludes writeOnly response fields', async () => {
    const document = await fixture('3'); document.openapi = '3.0.3';
    document.components.schemas.Item.properties.child = { $ref: '#/components/schemas/Item' };
    document.components.schemas.Item.properties.count = { type: 'integer', minimum: 0, exclusiveMinimum: true, nullable: true };
    document.components.schemas.Item.properties.secret = { type: 'string', writeOnly: true };
    document.components.schemas.Item.required.push('secret');
    const { config } = await generate(document);
    const schema = config.tools[0].outputSchema;
    expect(JSON.stringify(schema)).toContain('#/$defs/');
    expect(JSON.stringify(schema)).not.toContain('#/components/');
    const r = await runtime(config, { OPENAPI_BEARERAUTH_C41694_TOKEN: 'token' });
    nock.disableNetConnect(); nock('https://catalog.example.com').get('/api/v3/items').reply(200, [{ id: '1', name: 'one', count: null, child: { id: '2', name: 'two', count: 2 } }]);
    expect((await r.call('list_items', { query_limit: null })).isError).toBeUndefined();
  });

  it('uses operation parameter/server/security overrides and deterministic names', async () => {
    const document = await fixture('3');
    document.security = [{ unsupported: [] }];
    document.paths['/items'].servers = [{ url: 'https://path.test/v2' }];
    document.paths['/items'].parameters = [{ name: 'limit', in: 'query', required: true, schema: { type: 'integer' } }];
    const get = document.paths['/items'].get;
    get.servers = [{ url: 'https://operation.test/v3' }]; get.security = [];
    get.parameters = [{ name: 'limit', in: 'query', schema: { type: 'string' } }];
    const first = await generate(document, ['--methods', 'GET', '--prefix', 'test']);
    expect(first.config.tools).toHaveLength(1);
    expect(first.config.auth).toEqual({});
    expect(first.config.tools[0].execution.baseUrl).toBe('https://operation.test/v3');
    expect(first.config.tools[0].inputSchema.properties.query_limit.anyOf[0].type).toBe('string');
    expect((await generate(document, ['--methods', 'GET', '--prefix', 'test'])).config).toEqual(first.config);
    expect((await generate(document, ['--methods', 'GET', '--base-url', 'http://override.test/base'])).config.tools[0].execution.baseUrl).toBe('http://override.test/base');
  });

  it('handles schema property names resembling keywords and escaped JSON Pointers', async () => {
    const document = await fixture('3');
    document.components.schemas['a/b~c'] = { type: 'object', properties: { $ref: { type: 'string' }, payload: { const: { $ref: 'literal' } } } };
    document.paths['/items'].get.responses['200'].content['application/json'].schema = { $ref: '#/components/schemas/a~1b~0c' };
    const { config } = await generate(document, ['--methods', 'GET']);
    expect(JSON.stringify(config.tools[0].outputSchema)).toContain('literal');
  });

  it('supports URL-encoded forms and required scalar headers', async () => {
    const document = baseSpec();
    const spec = { ...document, paths: { '/submit': { post: { operationId: 'submit', parameters: [{ name: 'X-Count', in: 'header', required: true, schema: { type: 'integer' } }], requestBody: { required: true, content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['name'] } } } }, responses: { '200': objectResponse } } } } };
    const { config } = await generate(spec); const r = await runtime(config); nock.disableNetConnect();
    const request = nock('https://api.test').post('/v1/submit', 'name=hello+world&tags=a&tags=b').matchHeader('X-Count', '3').matchHeader('Content-Type', 'application/x-www-form-urlencoded').reply(200, {});
    expect((await r.call('submit', { header_X_Count: 3, form_name: 'hello world', form_tags: ['a', 'b'] })).structuredContent).toEqual({ data: {} });
    expect(request.isDone()).toBe(true);
  });

  it('maps OAuth client credentials, reports variables, and does not fetch tokens during generation', async () => {
    const document = await fixture('3');
    document.security = [{ oauth: ['read:items'] }];
    document.components.securitySchemes = { oauth: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: 'https://identity.test/token', scopes: { 'read:items': 'Read items' } } } } };
    const { config, stderr } = await generate(document, ['--env-prefix', 'CATALOG']);
    const profile = Object.values(config.auth)[0];
    expect(profile).toMatchObject({ type: 'oauth2', scopes: ['read:items'], tokenAuthMethod: 'basic' });
    expect(JSON.stringify(profile)).toContain('${env.CATALOG_');
    expect(stderr).toContain('Required environment variables: CATALOG_');
  });

  it('filters tags/methods, resolves operationId collisions, and limits name length', async () => {
    const spec = baseSpec();
    const operation = spec.paths['/items'].get;
    const { config } = await generate({ ...spec, paths: {
      '/a': { get: { ...operation, operationId: 'duplicate', tags: ['wanted'] } },
      '/b': { get: { ...operation, operationId: 'duplicate', tags: ['wanted'] } },
      '/c': { get: { ...operation, operationId: 'z'.repeat(200), tags: ['wanted'] } },
      '/d': { get: { ...operation, tags: ['other'] } },
    } }, ['--tags', 'wanted', '--methods', 'GET']);
    const names = config.tools.map((tool: { name: string }) => tool.name);
    expect(names).toHaveLength(3); expect(new Set(names).size).toBe(3);
    expect(names.every((name: string) => name.length <= 128)).toBe(true);
  });

  it.each([
    ['external refs', { responses: { '200': { $ref: 'https://private.test/response.json' } } }, 'local JSON Pointer'],
    ['cookie params', { parameters: [{ name: 'session', in: 'cookie', schema: { type: 'string' } }] }, 'location cookie'],
    ['deepObject', { parameters: [{ name: 'filter', in: 'query', style: 'deepObject', schema: { type: 'object' } }] }, 'Only scalar'],
    ['unexploded arrays', { parameters: [{ name: 'ids', in: 'query', explode: false, schema: { type: 'array', items: { type: 'string' } } }] }, 'explode=true'],
    ['multipart', { requestBody: { content: { 'multipart/form-data': { schema: { type: 'object' } } } } }, 'supported media'],
    ['AND auth', { security: [{ a: [], b: [] }] }, 'Combined security'],
    ['unknown auth', { security: [{ missing: [] }] }, 'OpenAPI object'],
    ['ambiguous success', { responses: { default: objectResponse } }, 'explicit 2xx'],
  ])('rejects %s without writing partial output; skip requires explicit opt-in', async (_name, extra, message) => {
    const spec = baseSpec();
    const document = { ...spec, paths: { ...spec.paths, '/bad': { post: { ...spec.paths['/items'].get, ...extra } } } };
    await expect(generate(document)).rejects.toMatchObject({ code: 1, stdout: '', stderr: expect.stringContaining(message) });
    const { config, stderr } = await generate(document, ['--skip-unsupported']);
    expect(config.tools).toHaveLength(1); expect(stderr).toContain('Skipped: POST /bad');
  });

  it('reports unsupported OAS 3.2 additional methods instead of silently dropping them', async () => {
    const spec = baseSpec();
    const document = { ...spec, openapi: '3.2.0', paths: { '/items': { ...spec.paths['/items'], additionalOperations: { COPY: spec.paths['/items'].get } } } };
    await expect(generate(document)).rejects.toMatchObject({ stderr: expect.stringContaining('COPY is not supported') });
  });

  it('supports text and primitive responses and explicitly limits success statuses', async () => {
    const spec = baseSpec();
    const { config, stderr } = await generate({ ...spec, paths: { '/text': { get: { operationId: 'text', responses: {
      '200': { description: 'Text', content: { 'text/plain': { schema: { type: 'string' } } } }, '204': { description: 'Empty' },
    } } } } });
    expect(stderr).toContain('Only HTTP 200'); expect(config.tools[0].execution.successStatuses).toEqual([200]);
    const r = await runtime(config); nock.disableNetConnect();
    nock('https://api.test').get('/v1/text').reply(200, 'hello');
    expect((await r.call('text', {})).structuredContent).toEqual({ data: 'hello' });
  });

  it('preserves base paths for root operations and colon-containing path segments', async () => {
    const spec = baseSpec(); const operation = spec.paths['/items'].get;
    const { config } = await generate({ ...spec, paths: {
      '/': { get: { ...operation, operationId: 'root' } },
      '/items:search': { get: { ...operation, operationId: 'search' } },
    } });
    const r = await runtime(config); nock.disableNetConnect();
    const root = nock('https://api.test').get('/v1/').reply(200, []);
    const search = nock('https://api.test').get('/v1/items:search').reply(200, ['one']);
    expect((await r.call('root', {})).structuredContent).toEqual({ data: [] });
    expect((await r.call('search', {})).structuredContent).toEqual({ data: ['one'] });
    expect(root.isDone() && search.isDone()).toBe(true);
  });

  it('supports Swagger formData and Basic authentication', async () => {
    const document = await fixture('2');
    document.securityDefinitions = { basic: { type: 'basic' } }; document.security = [{ basic: [] }];
    document.paths = { '/form': { post: { operationId: 'form', consumes: ['application/x-www-form-urlencoded'],
      parameters: [{ name: 'name', in: 'formData', type: 'string', required: true }, { name: 'labels', in: 'formData', type: 'array', items: { type: 'string' }, collectionFormat: 'multi' }],
      responses: { '200': { description: 'OK', schema: { type: 'object' } } },
    } } };
    const { config } = await generate(document);
    const variables = [...JSON.stringify(config.auth).matchAll(/\$\{env\.([^}]+)\}/g)].map(match => match[1]!);
    const r = await runtime(config, Object.fromEntries(variables.map(name => [name, name.endsWith('USERNAME') ? 'user' : 'pass'])));
    nock.disableNetConnect();
    const request = nock('https://catalog.example.com').post('/api/v2/form', 'name=hello').basicAuth({ user: 'user', pass: 'pass' }).reply(200, {});
    expect((await r.call('form', { form_name: 'hello', form_labels: null })).structuredContent).toEqual({ data: {} });
    expect(request.isDone()).toBe(true);
  });

  it('reports optional body/header promotion and unknown formats', async () => {
    const spec = baseSpec();
    const { config, stderr } = await generate({ ...spec, paths: { '/send': { post: {
      parameters: [{ name: 'X-Trace', in: 'header', schema: { type: 'string', format: 'custom-id' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, responses: { '200': objectResponse },
    } } } });
    expect(stderr).toContain('Optional request body becomes required');
    expect(stderr).toContain('Optional header X-Trace becomes required');
    expect(stderr).toContain('Format custom-id is omitted');
    expect(config.tools[0].inputSchema.required).toEqual(['header_X_Trace', 'body']);
  });

  it('rejects incompatible text schemas and schema anchors', async () => {
    const spec = baseSpec();
    for (const schema of [{ type: 'object' }, { $ref: '#anchor' }]) {
      await expect(generate({ ...spec, paths: { '/text': { get: { responses: { '200': { description: 'Text', content: { 'text/plain': { schema } } } } } } } })).rejects.toMatchObject({ code: 1, stdout: '' });
    }
  });

  it('writes JSON/YAML, refuses overwrite and wrong families, and protects the input file', async () => {
    const dir = await directory(); const spec = join(dir, 'api.yaml'); const output = join(dir, 'tools.yaml');
    await writeFile(spec, stringify(baseSpec()));
    const args = ['scripts/openapi-to-config.mjs', '--input', spec, '--output', output];
    await exec(process.execPath, args);
    expect(parse(await readFile(output, 'utf8')).tools).toHaveLength(1);
    await expect(exec(process.execPath, args)).rejects.toMatchObject({ stderr: expect.stringContaining('already exists') });
    await exec(process.execPath, [...args, '--force']);
    await expect(exec(process.execPath, ['scripts/openapi-to-config.mjs', '--input', spec, '--output', spec, '--force'])).rejects.toMatchObject({ stderr: expect.stringContaining('must not overwrite') });
    await expect(generate(baseSpec(), [], 'openapi2-to-config.mjs')).rejects.toMatchObject({ stderr: expect.stringContaining('requires OpenAPI 2') });
    await expect(generate({ ...baseSpec(), openapi: '4.0.0' })).rejects.toMatchObject({ stderr: expect.stringContaining('Supported versions') });
    expect(parse(await readFile(spec, 'utf8')).openapi).toBe('3.1.0');
  });
});
