import { describe, expect, it } from 'vitest';
import { responseSchema } from '../dist/config-schema.js';
import { processResponse, validateResponse } from '../dist/response.js';

async function parse(config: unknown, text: string, limit = 100000): Promise<unknown> {
  return processResponse(responseSchema.parse(config), { text, metadata: { status: 200 } }, limit, new AbortController().signal);
}
describe('response pipeline', () => {
  it('parses JSON and transforms arrays with response metadata', async () => {
    expect(await parse({ transform: '{"names": [data.items.name], "status": metadata.status}' }, '{"items":[{"name":"A"},{"name":"B"}]}')).toEqual({ names: ['A', 'B'], status: 200 });
  });
  it('wraps text and captures named groups in first/all modes', async () => {
    expect(await parse({ parser: { type: 'text' }, transform: '{"text": $trim(data)}' }, ' hello\n')).toEqual({ text: 'hello' });
    expect(await parse({ parser: { type: 'regex', pattern: '(?<name>\\w+)=(?<value>\\d+)' } }, 'cpu=2 mem=4')).toEqual({ name: 'cpu', value: '2' });
    expect(await parse({ parser: { type: 'regex', pattern: '(?<name>\\w+)=(?<value>\\d+)', mode: 'all' }, transform: '{"items": data}' }, 'cpu=2 mem=4')).toEqual({ items: [{ name: 'cpu', value: '2' }, { name: 'mem', value: '4' }] });
  });
  it('handles no match, missing transform result and malformed JSON', async () => {
    await expect(parse({ parser: { type: 'regex', pattern: '(?<n>\\d+)' } }, 'abc')).rejects.toMatchObject({ stage: 'parse' });
    expect(await parse({ parser: { type: 'regex', pattern: '(?<n>\\d+)', mode: 'all' } }, 'abc')).toEqual([]);
    await expect(parse({ transform: 'data.missing' }, '{}')).rejects.toMatchObject({ stage: 'transform' });
    await expect(parse({}, 'not-json')).rejects.toMatchObject({ stage: 'parse' });
  });
  it('terminates pathological regex and JSONata without blocking the main event loop', async () => {
    await expect(parse({ parser: { type: 'regex', pattern: '^(?<n>a+)+$' }, workerTimeoutMs: 100 }, 'a'.repeat(40) + '!')).rejects.toThrow('time limit');
    await expect(parse({ transform: '($f := function(){ $f() }; $f())', workerTimeoutMs: 100 }, '{}')).rejects.toMatchObject({ stage: 'transform' });
    expect(await parse({}, '{"ok":true}')).toEqual({ ok: true });
  });
  it('limits transformed output and cancels workers', async () => {
    await expect(parse({ parser: { type: 'text' }, transform: '{"s": data & data}' }, 'x'.repeat(100), 150)).rejects.toMatchObject({ stage: 'output' });
    const c = new AbortController();
    const task = processResponse(responseSchema.parse({ parser: { type: 'regex', pattern: '^(?<n>a+)+$' } }), { text: 'a'.repeat(40) + '!', metadata: {} }, 10000, c.signal);
    c.abort(); await expect(task).rejects.toMatchObject({ stage: 'execution' });
  });
  it('validates expressions without executing them', async () => {
    await expect(validateResponse(responseSchema.parse({ transform: '$error("never execute")' }))).resolves.toBeUndefined();
  });
});
