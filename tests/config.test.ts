import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { loadConfig, prepareConfig } from '../dist/config.js';
import { render } from '../dist/templates.js';
import { cliTool, httpTool } from './helpers.js';

describe('configuration', () => {
  it('loads equivalent YAML and JSON with defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sidecar-config-'));
    try {
      const config = { version: 1, tools: [cliTool()] };
      await writeFile(join(dir, 'c.json'), JSON.stringify(config));
      await writeFile(join(dir, 'c.yaml'), stringify(config, { aliasDuplicateObjects: false }));
      const json = await loadConfig(join(dir, 'c.json'), {});
      expect((await loadConfig(join(dir, 'c.yaml'), {})).config).toEqual(json.config);
      expect(json.config.server.timeoutMs).toBe(30000);
    } finally { await rm(dir, { recursive: true }); }
  });

  it.each([
    ['duplicate tools', { tools: [cliTool(), cliTool()] }],
    ['unknown config fields', { surprise: true }],
    ['invalid schema', { tools: [cliTool({}, { inputSchema: { type: 'object', properties: { n: { type: 'invalid' } } } })] }],
    ['remote refs', { tools: [cliTool({}, { inputSchema: { type: 'object', $ref: 'https://example.org/schema' } })] }],
    ['async schema', { tools: [cliTool({}, { inputSchema: { type: 'object', $async: true } })] }],
    ['undefined auth', { tools: [httpTool('https://example.org', { auth: 'missing' })] }],
    ['input in command', { tools: [cliTool({ command: '${input.command}' })] }],
    ['input in host', { tools: [httpTool('https://${input.host}')] }],
    ['origin replacement', { tools: [httpTool('https://example.org', { path: '//other.example/path' })] }],
    ['unknown template', { tools: [cliTool({ args: ['${other.value}'] })] }],
    ['unsafe reference', { tools: [cliTool({ args: ['${input.__proto__.value}'] })] }],
    ['missing env', { tools: [cliTool({ env: { TOKEN: '${env.MISSING}' } })] }],
    ['literal auth secret', { auth: { test: { type: 'bearer', token: 'plain-secret' } } }],
    ['bad regex', { tools: [cliTool({}, { response: { parser: { type: 'regex', pattern: '[' } } })] }],
    ['regex without named groups', { tools: [cliTool({}, { response: { parser: { type: 'regex', pattern: '(hello)' } } })] }],
    ['bad JSONata', { tools: [cliTool({}, { response: { transform: '{' } })] }],
  ])('rejects %s at startup', async (_name, extra) => {
    await expect(prepareConfig({ version: 1, tools: [cliTool()], ...extra }, process.cwd(), {})).rejects.toMatchObject({ stage: 'config' });
  });

  it('supports internal refs and checks credentials without network requests', async () => {
    const config = await prepareConfig({ version: 1, tools: [cliTool({}, { inputSchema: {
      type: 'object', properties: { name: { $ref: '#/$defs/name' } }, $defs: { name: { type: 'string' } },
    } })], auth: { oauth: { type: 'oauth2', tokenUrl: 'http://127.0.0.1:1/token', clientId: '${env.ID}', clientSecret: '${env.SECRET}' } } }, '.', { ID: 'id', SECRET: 'secret', UNUSED: 'excluded' });
    expect(config.env).toEqual({ ID: 'id', SECRET: 'secret' });
  });

  it('accepts property names and literal data resembling schema keywords', async () => {
    const inputSchema = {
      type: 'object',
      properties: {
        $ref: { $ref: '#/$defs/$ref' },
        $async: { type: 'boolean' },
        payload: { type: 'object', const: { $ref: 'https://example.org/literal', $async: true } },
      },
      $defs: { $ref: { type: 'string' } },
      default: { $ref: 'literal' },
      examples: [{ $ref: 'https://example.org/example', $async: true }],
    };
    const loaded = await prepareConfig({ version: 1, tools: [cliTool({}, { inputSchema })] }, '.', {});
    expect(loaded.config.tools[0]!.inputSchema).toEqual(inputSchema);
  });

  it.each([
    { properties: { $ref: { $ref: 'https://example.org/schema' } } },
    { $defs: { hidden: { $async: true, type: 'object' } } },
    { allOf: [{ properties: { value: { $ref: 'https://example.org/schema' } } }] },
    { properties: { list: { type: 'array', items: { $ref: 'https://example.org/schema' } } } },
    { dependentSchemas: { field: { $ref: 'https://example.org/schema' } } },
    { additionalProperties: { $dynamicRef: 'https://example.org/schema' } },
  ])('still rejects prohibited references/async schemas within subschemas: %j', async nested => {
    await expect(prepareConfig({ version: 1, tools: [cliTool({}, { inputSchema: { type: 'object', ...nested } })] }, '.', {}))
      .rejects.toMatchObject({ stage: 'config' });
  });

  it('rejects duplicate YAML keys and aliases', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sidecar-yaml-'));
    try {
      for (const text of ['version: 1\nversion: 2', 'version: 1\na: &x [1]\nb: *x']) {
        await writeFile(join(dir, 'c.yaml'), text);
        await expect(loadConfig(join(dir, 'c.yaml'))).rejects.toMatchObject({ stage: 'config' });
      }
    } finally { await rm(dir, { recursive: true }); }
  });
});

describe('templates', () => {
  it('preserves object, boolean and numeric types and interpolates scalars', () => {
    expect(render({ n: '${input.n}', b: '${input.b}', obj: '${input.obj}', text: 'id-${input.n}', a: ['${env.V}'] }, { n: 4, b: false, obj: { a: 1 } }, { V: 'secret' }))
      .toEqual({ n: 4, b: false, obj: { a: 1 }, text: 'id-4', a: ['secret'] });
  });
  it('does not evaluate input contents or accept object interpolation', () => {
    expect(render('${input.s}', { s: '${env.SECRET}' }, { SECRET: 'hidden' })).toBe('${env.SECRET}');
    expect(() => render('x${input.o}', { o: {} }, {})).toThrow();
    expect(() => render('${input.missing}', {}, {})).toThrow();
    expect(() => render('${input.constructor}', {}, {})).toThrow();
  });
});
