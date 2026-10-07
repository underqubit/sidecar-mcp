import { afterEach, describe, expect, it } from 'vitest';
import { runtime, cliTool, fixture } from './helpers.js';
import type { Runtime } from '../dist/runtime.js';

const active: Runtime[] = [];
afterEach(async () => { await Promise.all(active.splice(0).map(r => r.close())); });
async function make(...args: Parameters<typeof runtime>): Promise<Runtime> { const r = await runtime(...args); active.push(r); return r; }

describe('CLI execution', () => {
  it('passes literal arguments, typed stdin and explicit env, excludes stderr and unrelated env', async () => {
    process.env.SHOULD_NOT_INHERIT = 'private';
    const r = await make(cliTool({ args: [fixture, 'echo', '${input.message}', 'a b'], stdin: { count: '${input.count}' }, env: { TEST_TOKEN: '${env.TOKEN}' } }), {}, { TOKEN: 'credential' });
    const result = await r.call('test_tool', { message: '$(touch /tmp/SHOULD_NOT_EXIST); | & "', count: 4 });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ args: ['$(touch /tmp/SHOULD_NOT_EXIST); | & "', 'a b'], stdin: '{"count":4}', token: 'credential' });
    expect(result.structuredContent).not.toHaveProperty('inherited');
    expect(JSON.stringify(result)).not.toContain('private-diagnostic');
    delete process.env.SHOULD_NOT_INHERIT;
  });
  it('validates input before execution and output after parsing', async () => {
    const r = await make(cliTool({}, { inputSchema: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] }, outputSchema: { type: 'object', properties: { missing: { type: 'string' } }, required: ['missing'] } }));
    expect(JSON.stringify(await r.call('test_tool', { n: '1' }))).toContain('[input]');
    expect(JSON.stringify(await r.call('test_tool', { n: 1 }))).toContain('[output]');
  });
  it.each(['large', 'stderr-large'])('limits %s bytes without truncating success', async mode => {
    const r = await make(cliTool({ args: [fixture, mode], maxOutputBytes: 128 }));
    expect(await r.call('test_tool', {})).toMatchObject({ isError: true });
  });
  it('reports nonzero exit codes without stderr secrets', async () => {
    const r = await make(cliTool({ args: [fixture, 'exit', '7'] }));
    const result = await r.call('test_tool', {});
    expect(JSON.stringify(result)).toContain('code 7');
    expect(JSON.stringify(result)).not.toContain('private-secret');
  });
  it('accepts configured exit codes and text wrapping', async () => {
    const r = await make(cliTool({ args: [fixture, 'exit', '3'], successExitCodes: [3] }, { response: { parser: { type: 'text' }, transform: '{"text": data, "code": metadata.exitCode}' } }));
    expect((await r.call('test_tool', {})).structuredContent).toEqual({ text: '', code: 3 });
  });
  it('times out processes ignoring SIGTERM and descendants', async () => {
    for (const mode of ['hang', 'tree']) {
      const r = await make(cliTool({ args: [fixture, mode], timeoutMs: 100 }));
      const start = Date.now();
      expect(await r.call('test_tool', {})).toMatchObject({ isError: true });
      expect(Date.now() - start).toBeLessThan(2000);
    }
  });
  it('cancels active executions and shuts down cleanly', async () => {
    const r = await make(cliTool({ args: [fixture, 'hang'] }));
    const abort = new AbortController();
    const call = r.call('test_tool', {}, abort.signal); abort.abort();
    expect(await call).toMatchObject({ isError: true });
    const next = r.call('test_tool', {}); await r.close();
    expect(await next).toMatchObject({ isError: true });
    expect(await r.call('test_tool', {})).toMatchObject({ isError: true });
  });
  it('handles missing binaries, missing parameters and malformed JSON', async () => {
    for (const tool of [cliTool({ command: '/no/such/executable' }), cliTool({ args: ['${input.missing}'] }), cliTool({ args: [fixture, 'text', 'invalid'] })]) {
      expect(await (await make(tool)).call('test_tool', {})).toMatchObject({ isError: true });
    }
  });
});
