import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { httpTool, runtime } from './helpers.js';
import type { Runtime } from '../dist/runtime.js';

const base = 'http://api.test';
const active: Runtime[] = [];
beforeEach(() => { nock.disableNetConnect(); });
afterEach(async () => {
  await Promise.all(active.splice(0).map(r => r.close()));
  nock.abortPendingRequests(); nock.cleanAll(); nock.enableNetConnect();
});
async function make(...args: Parameters<typeof runtime>): Promise<Runtime> { const r = await runtime(...args); active.push(r); return r; }

describe('HTTP through Axios with intercepted requests', () => {
  it('serializes path, repeated query params, headers and typed JSON bodies', async () => {
    const request = nock(base).post('/users/a%2Fb%3Fx%23%20y', { active: false, count: 3, nested: { x: [1, 2] } })
      .query({ q: '2', tag: ['a b', 'c'] }).matchHeader('X-Custom', 'id-2').reply(200, { ok: true });
    const r = await make(httpTool(base, { method: 'POST', path: '/users/{id}', pathParams: { id: '${input.id}' }, query: { q: '${input.q}', tag: ['a b', 'c'] }, headers: { 'X-Custom': 'id-${input.q}' }, body: { active: '${input.active}', count: '${input.count}', nested: '${input.nested}' } }));
    expect((await r.call('test_tool', { id: 'a/b?x# y', q: 2, active: false, count: 3, nested: { x: [1, 2] } })).structuredContent).toEqual({ ok: true });
    expect(request.isDone()).toBe(true);
  });

  it.each(['form', 'text'])('sends %s payloads', async encoding => {
    const request = nock(base).post('/', encoding === 'form' ? 'a=x+y&n=4' : 'hello')
      .matchHeader('Content-Type', encoding === 'form' ? 'application/x-www-form-urlencoded' : 'text/plain; charset=utf-8').reply(200, {});
    const r = await make(httpTool(base, { method: 'POST', bodyEncoding: encoding, body: encoding === 'form' ? { a: 'x y', n: 4 } : 'hello' }));
    expect((await r.call('test_tool', {})).isError).toBeUndefined();
    expect(request.isDone()).toBe(true);
  });

  it('does not retry or follow redirects; errors omit response bodies', async () => {
    const request = nock(base).get('/').once().reply(302, 'hidden-secret', { Location: 'http://other.test/' });
    const r = await make(httpTool(base));
    const result = await r.call('test_tool', {});
    expect(JSON.stringify(result)).toContain('HTTP 302');
    expect(JSON.stringify(result)).not.toContain('hidden-secret');
    expect(request.isDone()).toBe(true);
  });

  it('honors success status overrides and exposes only selected response metadata', async () => {
    nock(base).get('/').reply(409, { conflict: true }, { 'Set-Cookie': 'secret=hidden', 'Content-Type': 'application/json' });
    const r = await make(httpTool(base, { successStatuses: [409] }, { response: { transform: '{"body": data, "meta": metadata}' } }));
    const result = await r.call('test_tool', {});
    expect(result.structuredContent).toMatchObject({ body: { conflict: true }, meta: { status: 409 } });
    expect(JSON.stringify(result)).not.toContain('hidden');
  });

  it('enforces timeouts and response size limits', async () => {
    nock(base).get('/slow').delay(300).reply(200, {});
    nock(base).get('/large').reply(200, 'x'.repeat(2048));
    for (const execution of [{ path: '/slow', timeoutMs: 30 }, { path: '/large', maxOutputBytes: 100 }]) {
      expect(await (await make(httpTool(base, execution))).call('test_tool', {})).toMatchObject({ isError: true });
    }
  });

  it('handles network failures and explicit cancellation', async () => {
    nock(base).get('/failed').replyWithError('private connection details');
    const r = await make(httpTool(base, { path: '/failed' }));
    const result = await r.call('test_tool', {});
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private connection details');
    const controller = new AbortController();
    nock(base).get('/slow').delay(300).reply(200, {});
    const slow = await make(httpTool(base, { path: '/slow' }));
    const pending = slow.call('test_tool', {}, controller.signal); controller.abort();
    expect(await pending).toMatchObject({ isError: true });
  });
});

describe('authentication over intercepted HTTP', () => {
  it.each([
    ['none', { type: 'none' }, {}, {}],
    ['bearer', { type: 'bearer', token: '${env.TOKEN}' }, { authorization: 'Bearer secret' }, {}],
    ['basic', { type: 'basic', username: '${env.USER}', password: '${env.TOKEN}' }, { authorization: `Basic ${Buffer.from('user:secret').toString('base64')}` }, {}],
    ['header', { type: 'apiKey', in: 'header', name: 'X-API-Key', value: '${env.TOKEN}' }, { 'x-api-key': 'secret' }, {}],
    ['query', { type: 'apiKey', in: 'query', name: 'key', value: '${env.TOKEN}' }, {}, { key: 'secret' }],
  ])('injects %s credentials', async (_name, auth, headers, query) => {
    const request = nock(base, { reqheaders: headers }).get('/').query(query).reply(200, {});
    const r = await make(httpTool(base, { auth: 'service' }), { auth: { service: auth } }, { TOKEN: 'secret', USER: 'user' });
    expect((await r.call('test_tool', {})).isError).toBeUndefined();
    expect(request.isDone()).toBe(true);
  });

  it.each(['basic', 'body'])('shares and refreshes OAuth2 client credentials (%s)', async method => {
    const body = method === 'basic'
      ? 'grant_type=client_credentials&scope=read+write'
      : 'grant_type=client_credentials&scope=read+write&client_id=client&client_secret=s+ecret';
    const tokens = nock(base).post('/token', body).times(2).delay(20).reply(200, { access_token: 'token', token_type: 'Bearer', expires_in: 0.2 });
    if (method === 'basic') tokens.matchHeader('Authorization', `Basic ${Buffer.from('client:s+ecret').toString('base64')}`);
    const calls = nock(base, { reqheaders: { authorization: 'Bearer token' } }).get('/').times(6).reply(200, {});
    const r = await make(httpTool(base, { auth: 'service' }), { auth: { service: { type: 'oauth2', tokenUrl: `${base}/token`, clientId: '${env.ID}', clientSecret: '${env.SECRET}', scopes: ['read', 'write'], tokenAuthMethod: method } } }, { ID: 'client', SECRET: 's ecret' });
    const first = await Promise.all(Array.from({ length: 5 }, () => r.call('test_tool', {})));
    expect(first.every(result => !result.isError)).toBe(true);
    expect(tokens.isDone()).toBe(false);
    await delay(210);
    expect((await r.call('test_tool', {})).isError).toBeUndefined();
    expect(tokens.isDone()).toBe(true); expect(calls.isDone()).toBe(true);
  });

  it('hides errors from OAuth endpoints', async () => {
    nock(base).post('/token').reply(401, 'secret-value');
    const r = await make(httpTool(base, { auth: 'oauth' }), { auth: { oauth: { type: 'oauth2', tokenUrl: `${base}/token`, clientId: '${env.ID}', clientSecret: '${env.SECRET}' } } }, { ID: 'client', SECRET: 'secret-value' });
    const result = await r.call('test_tool', {});
    expect(JSON.stringify(result)).toContain('[auth]'); expect(JSON.stringify(result)).not.toContain('secret-value');
  });

  it('isolates cancellation between concurrent token waiters', async () => {
    const token = nock(base).post('/token').once().delay(40).reply(200, { access_token: 'token', token_type: 'Bearer', expires_in: 60 });
    nock(base).get('/').once().reply(200, {});
    const r = await make(httpTool(base, { auth: 'oauth' }), { auth: { oauth: { type: 'oauth2', tokenUrl: `${base}/token`, clientId: '${env.ID}', clientSecret: '${env.SECRET}' } } }, { ID: 'client', SECRET: 'secret-value' });
    const c = new AbortController();
    const first = r.call('test_tool', {}, c.signal); const second = r.call('test_tool', {}); c.abort();
    expect(await first).toMatchObject({ isError: true }); expect((await second).isError).toBeUndefined();
    expect(token.isDone()).toBe(true);
  });
});
