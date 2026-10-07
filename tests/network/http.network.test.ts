import { afterEach, describe, expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { runtime, httpTool, httpFixture } from '../helpers.js';
import type { Runtime } from '../../dist/runtime.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function api(...args: Parameters<typeof httpFixture>): Promise<Awaited<ReturnType<typeof httpFixture>>> {
  const server = await httpFixture(...args); cleanup.push(() => server.close()); return server;
}
async function make(...args: Parameters<typeof runtime>): Promise<Runtime> {
  const r = await runtime(...args); cleanup.push(() => r.close()); return r;
}

describe('HTTP adapter', () => {
  it('encodes path params and sends typed JSON, query arrays and headers', async () => {
    const server = await api((req, res, body) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ url: req.url, method: req.method, header: req.headers['x-custom'], body: JSON.parse(body) as unknown })); });
    const r = await make(httpTool(server.url, {
      method: 'POST', path: '/users/{id}', pathParams: { id: '${input.id}' },
      query: { q: '${input.q}', tag: ['a b', 'c'], skip: null }, headers: { 'X-Custom': 'value-${input.q}' },
      body: { enabled: '${input.enabled}', count: '${input.count}', nested: '${input.nested}' },
    }));
    const result = await r.call('test_tool', { id: 'a/b?x# y', q: 2, enabled: false, count: 3, nested: { a: [1, 2] } });
    expect(result.structuredContent).toEqual({ url: '/users/a%2Fb%3Fx%23%20y?q=2&tag=a+b&tag=c', method: 'POST', header: 'value-2', body: { enabled: false, count: 3, nested: { a: [1, 2] } } });
  });
  it.each(['form', 'text'])('supports %s bodies', async encoding => {
    const server = await api((req, res, body) => { res.end(JSON.stringify({ body, type: req.headers['content-type'] })); });
    const r = await make(httpTool(server.url, { method: 'POST', bodyEncoding: encoding, body: encoding === 'form' ? { a: 'x y', n: 4 } : 'hello' }));
    expect((await r.call('test_tool', {})).structuredContent).toMatchObject({ body: encoding === 'form' ? 'a=x+y&n=4' : 'hello' });
  });
  it('uses fixed origins and rejects dot path segments', async () => {
    const server = await api((_req, res) => { res.end('{}'); });
    const r = await make(httpTool(server.url, { path: '/users/{id}', pathParams: { id: '${input.id}' } }));
    expect(await r.call('test_tool', { id: '..' })).toMatchObject({ isError: true });
  });
  it('does not follow redirects or retry failures', async () => {
    let count = 0;
    const server = await api((_req, res) => { count++; res.writeHead(302, { Location: '/other' }); res.end('SECRET BODY'); });
    const r = await make(httpTool(server.url));
    const result = await r.call('test_tool', {});
    expect(JSON.stringify(result)).toContain('HTTP 302');
    expect(JSON.stringify(result)).not.toContain('SECRET BODY');
    expect(count).toBe(1);
  });
  it('handles HTTP errors, configurable success statuses, byte limits and timeouts', async () => {
    const server = await api(async (req, res) => {
      if (req.url === '/large') res.end('x'.repeat(2048));
      else if (req.url === '/slow') { await delay(200); res.end('{}'); }
      else { res.writeHead(409); res.end('{"conflict":true}'); }
    });
    const ok = await make(httpTool(server.url, { successStatuses: [409] }));
    expect((await ok.call('test_tool', {})).structuredContent).toEqual({ conflict: true });
    for (const execution of [{}, { path: '/large', maxOutputBytes: 100 }, { path: '/slow', timeoutMs: 30 }]) {
      expect(await (await make(httpTool(server.url, execution))).call('test_tool', {})).toMatchObject({ isError: true });
    }
  });
  it('cancels in-flight HTTP requests', async () => {
    const server = await api(async (_req, res) => { await delay(200); res.end('{}'); });
    const r = await make(httpTool(server.url));
    const controller = new AbortController();
    const request = r.call('test_tool', {}, controller.signal); controller.abort();
    expect(await request).toMatchObject({ isError: true });
  });
});

describe('authentication', () => {
  it.each([
    ['none', { type: 'none' }, undefined, undefined],
    ['bearer', { type: 'bearer', token: '${env.TOKEN}' }, 'Bearer secret', undefined],
    ['basic', { type: 'basic', username: '${env.USER}', password: '${env.TOKEN}' }, `Basic ${Buffer.from('user:secret').toString('base64')}`, undefined],
    ['header key', { type: 'apiKey', in: 'header', name: 'X-Api-Key', value: '${env.TOKEN}' }, undefined, 'secret'],
    ['query key', { type: 'apiKey', in: 'query', name: 'key', value: '${env.TOKEN}' }, undefined, undefined],
  ])('applies %s', async (name, profile, authorization, key) => {
    let seen: Record<string, unknown> = {};
    const server = await api((req, res) => { seen = { authorization: req.headers.authorization, key: req.headers['x-api-key'], url: req.url }; res.end('{}'); });
    const r = await make(httpTool(server.url, { auth: 'service' }), { auth: { service: profile } }, { USER: 'user', TOKEN: 'secret' });
    expect((await r.call('test_tool', {})).isError).toBeUndefined();
    expect(seen).toMatchObject({ authorization, key, url: name === 'query key' ? '/?key=secret' : '/' });
  });
  it.each(['basic', 'body'])('obtains, shares and refreshes OAuth2 tokens using %s authentication', async method => {
    let grants = 0;
    const tokenRequests: { authorization?: string; body: string }[] = [];
    const authorizations: (string | undefined)[] = [];
    const server = await api(async (req, res, body) => {
      if (req.url === '/token') {
        grants++; tokenRequests.push({ authorization: req.headers.authorization, body });
        await delay(20);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ access_token: `token-${grants}`, token_type: 'Bearer', expires_in: 0.2 }));
      } else { authorizations.push(req.headers.authorization); res.end('{}'); }
    });
    const r = await make(httpTool(server.url, { auth: 'service' }), { auth: { service: {
      type: 'oauth2', tokenUrl: `${server.url}/token`, clientId: '${env.ID}', clientSecret: '${env.SECRET}', scopes: ['read', 'write'], tokenAuthMethod: method,
    } } }, { ID: 'client', SECRET: 's ecret' });
    const results = await Promise.all(Array.from({ length: 5 }, () => r.call('test_tool', {})));
    expect(results.every(result => !result.isError)).toBe(true);
    expect(grants).toBe(1);
    expect(authorizations).toEqual(Array(5).fill('Bearer token-1'));
    expect(tokenRequests[0]!.body).toContain('grant_type=client_credentials');
    expect(tokenRequests[0]!.body).toContain('scope=read+write');
    if (method === 'basic') expect(tokenRequests[0]!.authorization).toBe(`Basic ${Buffer.from('client:s+ecret').toString('base64')}`);
    else expect(tokenRequests[0]!.body).toContain('client_secret=s+ecret');
    await delay(210);
    expect((await r.call('test_tool', {})).isError).toBeUndefined();
    expect(grants).toBe(2);
  });
  it('does not leak OAuth response bodies or secrets on failure', async () => {
    const server = await api((_req, res) => { res.writeHead(401); res.end('top-secret'); });
    const r = await make(httpTool(server.url, { auth: 'oauth' }), { auth: { oauth: { type: 'oauth2', tokenUrl: `${server.url}/token`, clientId: '${env.ID}', clientSecret: '${env.SECRET}' } } }, { ID: 'client', SECRET: 'top-secret' });
    const result = await r.call('test_tool', {});
    expect(JSON.stringify(result)).toContain('[auth]');
    expect(JSON.stringify(result)).not.toContain('top-secret');
  });
  it('one canceled OAuth waiter does not cancel other callers', async () => {
    let grants = 0;
    const server = await api(async (req, res) => {
      if (req.url === '/token') { grants++; await delay(40); res.setHeader('Content-Type', 'application/json'); res.end('{"access_token":"ok","token_type":"Bearer","expires_in":30}'); }
      else res.end('{}');
    });
    const r = await make(httpTool(server.url, { auth: 'oauth' }), { auth: { oauth: { type: 'oauth2', tokenUrl: `${server.url}/token`, clientId: '${env.ID}', clientSecret: '${env.SECRET}' } } }, { ID: 'client', SECRET: 'secret' });
    const abort = new AbortController();
    const first = r.call('test_tool', {}, abort.signal);
    const second = r.call('test_tool', {});
    abort.abort();
    expect(await first).toMatchObject({ isError: true });
    expect((await second).isError).toBeUndefined();
    expect(grants).toBe(1);
  });
});
