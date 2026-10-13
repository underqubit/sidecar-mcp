import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { stringify } from 'yaml';
import nock from 'nock';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Application, loadDeployment, deploymentTransport } from '../dist/composition.js';
import { createApplicationHttpHandler } from '../dist/mcp.js';
import type { LogEvent } from '../dist/runtime.js';
import { cliTool, httpTool, fixture } from './helpers.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  nock.abortPendingRequests(); nock.cleanAll(); nock.enableNetConnect();
});
async function files(children: Record<string, unknown> = { a: { version: 1, tools: [cliTool()] } }, extra: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'sidecar-composition-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  for (const [id, child] of Object.entries(children)) {
    await mkdir(join(directory, id));
    await writeFile(join(directory, id, 'config.json'), JSON.stringify(child));
  }
  const raw = { version: 1, kind: 'composition', mode: 'both', server: { name: 'combined', transport: 'http' },
    groups: Object.keys(children).map(id => ({ id, config: `./${id}/config.json` })), ...extra };
  const path = join(directory, 'composition.json');
  await writeFile(path, JSON.stringify(raw));
  return { path, directory, raw };
}
async function example(mode: 'unified' | 'separate' | 'both') {
  const loaded = await loadDeployment('examples/composition.yaml');
  if (loaded.kind !== 'composition') throw new Error('Expected composition');
  loaded.config.mode = mode;
  const app = new Application(loaded, () => {});
  cleanup.push(() => app.close());
  return app;
}
async function connect(http: ReturnType<typeof createApplicationHttpHandler>, path: string) {
  const client = new Client({ name: 'composition-test', version: '1' });
  cleanup.push(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost${path}`), {
    fetch: (url, init) => http.fetch(new Request(url, init)),
  }));
  return client;
}

describe('composition loading', () => {
  it('loads JSON/YAML equivalently, preserves child paths and resolves against the manifest', async () => {
    const { path, directory, raw } = await files({ a: { version: 1, tools: [cliTool({ command: './program', cwd: './work' })] } });
    await writeFile(join(directory, 'composition.yaml'), stringify(raw));
    const json = await loadDeployment(path, {});
    expect(await loadDeployment(join(directory, 'composition.yaml'), {})).toEqual(json);
    if (json.kind !== 'composition') throw new Error('Expected composition');
    expect(json.groups[0]!.loaded.config.tools[0]!.execution).toMatchObject({ command: join(directory, 'a/program'), cwd: join(directory, 'a/work') });
  });

  it.each([
    ['empty groups', { groups: [] }, 'groups'],
    ['duplicate groups', { groups: [{ id: 'a', config: './a/config.json' }, { id: 'a', config: './a/config.json' }] }, 'Duplicate group'],
    ['invalid ID', { groups: [{ id: 'a.b', config: './a/config.json' }] }, 'groups'],
    ['missing file', { groups: [{ id: 'a', config: './missing.json' }] }, 'Group a'],
    ['missing mode', { mode: undefined }, 'mode'],
    ['unknown root field', { tools: [] }, 'root'],
    ['global execution limit', { server: { timeoutMs: 10 } }, 'server'],
  ])('rejects %s', async (_name, extra, message) => {
    const { path } = await files(undefined, extra);
    await expect(loadDeployment(path, {})).rejects.toThrow(message);
  });

  it('rejects nested compositions, overlong names and missing child credentials with group context', async () => {
    for (const [child, message] of [
      [{ version: 1, kind: 'composition' }, 'Nested compositions'],
      [{ version: 1, tools: [cliTool({}, { name: 'x'.repeat(128) })] }, '128 characters'],
      [{ version: 1, tools: [cliTool({ env: { TOKEN: '${env.MISSING}' } })] }, 'Required environment variable: MISSING'],
    ] as const) {
      const { path } = await files({ a: child });
      await expect(loadDeployment(path, {})).rejects.toThrow(`Group a:`);
      await expect(loadDeployment(path, {})).rejects.toThrow(message);
    }
  });

  it('uses main defaults while preserving child identity version and the 128-character name boundary', async () => {
    const { path } = await files({ a: { version: 1, server: { name: 'ignored-child-name', version: '2.3.4', transport: 'http', http: { port: 4321 } },
      tools: [cliTool({}, { name: 'x'.repeat(126) })] } }, { mode: 'unified', server: undefined });
    const loaded = await loadDeployment(path);
    expect(deploymentTransport(loaded)).toBe('stdio');
    const app = new Application(loaded, () => {}); cleanup.push(() => app.close());
    expect(app.server.http.port).toBe(3000);
    const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string };
    expect(app.stdioCatalog().identity).toMatchObject({ name: 'underqubit-sidecar-mcp', version });
    expect([...app.stdioCatalog().tools.keys()][0]).toHaveLength(128);
    if (loaded.kind !== 'composition') throw new Error('Expected composition');
    loaded.config.mode = 'separate';
    const separate = new Application(loaded, () => {}); cleanup.push(() => separate.close());
    expect(separate.endpoints.get('/mcp/a')!.identity).toEqual({ name: 'a', version: '2.3.4' });
    expect(() => separate.stdioCatalog()).toThrow('unified');
    expect(deploymentTransport(loaded, 'http')).toBe('http');
  });

  it('checks transport overrides for validation and serving', async () => {
    const { path } = await files();
    const loaded = await loadDeployment(path);
    expect(deploymentTransport(loaded)).toBe('http');
    expect(() => deploymentTransport(loaded, 'stdio')).toThrow('requires HTTP');
    const run = promisify(execFile);
    await expect(run(process.execPath, ['dist/cli.js', 'validate', '--config', path, '--transport', 'stdio'])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('requires HTTP') });
    const result = await run(process.execPath, ['dist/cli.js', 'validate', '--config', path]);
    expect(result.stdout).toBe(''); expect(result.stderr).toContain('1 tools');
  });
});

describe('composition catalogs', () => {
  it.each(['unified', 'separate', 'both'] as const)('publishes only the %s endpoints, with correct identities and tool routing', async mode => {
    const app = await example(mode);
    const http = createApplicationHttpHandler(app); cleanup.push(() => http.close());
    const paths = mode === 'unified' ? ['/mcp'] : mode === 'separate' ? ['/mcp/local', '/mcp/echo'] : ['/mcp', '/mcp/local', '/mcp/echo'];
    expect([...app.endpoints.keys()]).toEqual(paths);
    for (const path of paths) {
      const client = await connect(http, path);
      expect(client.getServerVersion()?.name).toBe(path === '/mcp' ? 'underqubit' : path.split('/').at(-1));
      const names = (await client.listTools()).tools.map(tool => tool.name);
      const name = path === '/mcp' ? 'echo.local_echo' : 'local_echo';
      expect(names).toEqual(path === '/mcp' ? ['echo.local_echo', 'local.local_echo', 'local.local_node_version'] : path === '/mcp/local' ? ['local_echo', 'local_node_version'] : ['local_echo']);
      expect((await client.callTool({ name, arguments: { message: path } })).structuredContent).toEqual({ message: path });
      const invalid = path === '/mcp' ? 'local_echo' : 'echo.local_echo';
      await expect(client.callTool({ name: invalid, arguments: {} })).rejects.toThrow();
    }
    for (const path of ['/mcp/missing', ...['/mcp', '/mcp/local'].filter(path => !paths.includes(path))]) {
      expect((await http.fetch(new Request(`http://localhost${path}`))).status).toBe(404);
    }
  });

  it('discovers and calls the unified stdio catalog from a different working directory', async () => {
    const client = new Client({ name: 'stdio-composition', version: '1' }); cleanup.push(() => client.close());
    await client.connect(new StdioClientTransport({ command: process.execPath, cwd: tmpdir(), stderr: 'pipe',
      args: [resolve('dist/cli.js'), 'serve', '--config', resolve('examples/composition.json')] }));
    expect((await client.listTools()).tools).toHaveLength(3);
    expect((await client.callTool({ name: 'local.local_echo', arguments: { message: 'hello' } })).structuredContent).toEqual({ message: 'hello' });
  });

  it('enforces HTTP guards and request limits on every endpoint', async () => {
    const app = await example('both'); app.server.http.maxRequestBytes = 100;
    const http = createApplicationHttpHandler(app); cleanup.push(() => http.close());
    for (const path of app.endpoints.keys()) {
      for (const headers of [{ Host: 'evil.test' }, { Origin: 'https://evil.test' }] as Record<string, string>[]) {
        expect((await http.fetch(new Request(`http://localhost${path}`, { headers }))).status).toBe(403);
      }
      expect((await http.fetch(new Request(`http://localhost${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(200) }) }))).status).toBe(413);
    }
    expect((await http.fetch(new Request('http://evil.test/missing'))).status).toBe(403);
  });

  it('isolates homonymous auth profiles while sharing each group OAuth cache across views', async () => {
    nock.disableNetConnect();
    const base = 'http://groups.test';
    const children = Object.fromEntries(['a', 'b'].map(id => [id, { version: 1,
      auth: { service: { type: 'oauth2', tokenUrl: `${base}/token`, clientId: `\${env.${id}_ID}`, clientSecret: `\${env.${id}_SECRET}` } },
      tools: [httpTool(base, { auth: 'service', path: `/${id}` })],
    }]));
    const { path } = await files(children);
    const events: LogEvent[] = [];
    const app = new Application(await loadDeployment(path, { a_ID: 'a', a_SECRET: 'secret-a', b_ID: 'b', b_SECRET: 'secret-b' }), event => events.push(event)); cleanup.push(() => app.close());
    expect(app.runtimes.map(runtime => runtime.loaded.env)).toEqual([{ a_ID: 'a', a_SECRET: 'secret-a' }, { b_ID: 'b', b_SECRET: 'secret-b' }]);
    const mocks = ['a', 'b'].map(id => {
      const token = nock(base).post('/token').basicAuth({ user: id, pass: `secret-${id}` }).once().reply(200, { access_token: `token-${id}`, token_type: 'Bearer', expires_in: 60 });
      const api = nock(base).get(`/${id}`).matchHeader('Authorization', `Bearer token-${id}`).twice().reply(200, { group: id });
      return { token, api };
    });
    for (const id of ['a', 'b']) {
      expect((await app.endpoints.get('/mcp')!.call(`${id}.test_tool`, {})).structuredContent).toEqual({ group: id });
      expect((await app.endpoints.get(`/mcp/${id}`)!.call('test_tool', {})).structuredContent).toEqual({ group: id });
    }
    expect(mocks.every(({ token, api }) => token.isDone() && api.isDone())).toBe(true);
    expect(events.map(event => event.group)).toEqual(['a', 'a', 'b', 'b']);
    expect(JSON.stringify(events)).not.toContain('secret-');
  });

  it('keeps child limits and cancels active calls across views on an idempotent shutdown', async () => {
    nock.disableNetConnect();
    const base = 'http://limits.test';
    const { path } = await files({
      a: { version: 1, server: { maxOutputBytes: 100 }, tools: [httpTool(base)] },
      b: { version: 1, server: { maxOutputBytes: 2000 }, tools: [httpTool(base)] },
      slow: { version: 1, server: { timeoutMs: 20 }, tools: [httpTool(base, { path: '/slow' })] },
      pending: { version: 1, tools: [cliTool({ args: [fixture, 'hang'] })] },
    });
    const app = new Application(await loadDeployment(path), () => {}); cleanup.push(() => app.close());
    nock(base).get('/').twice().reply(200, { text: 'x'.repeat(300) });
    nock(base).get('/slow').delay(300).reply(200, {});
    const catalog = app.endpoints.get('/mcp')!;
    expect(await catalog.call('a.test_tool', {})).toMatchObject({ isError: true });
    expect((await catalog.call('b.test_tool', {})).isError).toBeUndefined();
    expect(await catalog.call('slow.test_tool', {})).toMatchObject({ isError: true });
    const controller = new AbortController();
    const canceled = catalog.call('pending.test_tool', {}, controller.signal); controller.abort();
    expect(await canceled).toMatchObject({ isError: true });
    const active = [catalog.call('pending.test_tool', {}), app.endpoints.get('/mcp/pending')!.call('test_tool', {})];
    const spies = app.runtimes.map(runtime => vi.spyOn(runtime, 'close'));
    await Promise.all([app.close(), app.close()]);
    expect((await Promise.all(active)).every(result => result.isError)).toBe(true);
    expect(spies.every(spy => spy.mock.calls.length === 1)).toBe(true);
    expect(await catalog.call('b.test_tool', {})).toMatchObject({ isError: true });
  });
});
