import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { startHttp } from '../../dist/mcp.js';
import { loadConfig } from '../../dist/config.js';
import { Runtime } from '../../dist/runtime.js';
import { cliTool, runtime } from '../helpers.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

describe('MCP transports', () => {
  it('discovers and calls configured tools through a real stdio child process', async () => {
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.js'), 'serve', '--config', resolve('examples/cli.json')], stderr: 'pipe' });
    cleanup.push(() => client.close());
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map(tool => tool.name)).toEqual(['local_echo']);
    expect(listed.tools[0]!.inputSchema).toMatchObject({ type: 'object', required: ['message'] });
    expect(listed.tools[0]!.outputSchema).toMatchObject({ type: 'object' });
    const result = await client.callTool({ name: 'local_echo', arguments: { message: 'MCP works' } });
    expect(result.structuredContent).toEqual({ message: 'MCP works' });
    expect(result.content).toEqual([{ type: 'text', text: '{"message":"MCP works"}' }]);
    expect(await client.callTool({ name: 'local_echo', arguments: { message: 2 } })).toMatchObject({ isError: true });
  });

  it('discovers and calls tools over Streamable HTTP for independent clients', async () => {
    const loaded = await loadConfig(resolve('examples/cli.json'));
    loaded.config.server.http.port = 0;
    const r = new Runtime(loaded, () => {});
    const http = await startHttp(r); cleanup.push(() => http.close());
    const clients = [new Client({ name: 'a', version: '1.0.0' }), new Client({ name: 'b', version: '1.0.0' })];
    for (const client of clients) { cleanup.push(() => client.close()); await client.connect(new StreamableHTTPClientTransport(new URL(http.url))); }
    expect((await clients[0]!.listTools()).tools[0]!.name).toBe('local_echo');
    const results = await Promise.all(clients.map((client, i) => client.callTool({ name: 'local_echo', arguments: { message: `client-${i}` } })));
    expect(results.map(result => result.structuredContent)).toEqual([{ message: 'client-0' }, { message: 'client-1' }]);
    expect((await fetch(http.url, { method: 'POST', headers: { Origin: 'https://untrusted.example' }, body: '{}' })).status).toBe(403);
    expect((await fetch(http.url, { method: 'POST', headers: { Host: 'untrusted.example' }, body: '{}' })).status).toBe(403);
    expect((await fetch(http.url.replace('/mcp', '/missing'))).status).toBe(404);
  });

  it('bounds incoming HTTP request bodies', async () => {
    const r = await runtime(cliTool(), { server: { http: { port: 0, maxRequestBytes: 100 } } });
    const http = await startHttp(r); cleanup.push(() => http.close());
    const response = await fetch(http.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ long: 'x'.repeat(200) }) });
    expect(response.status).toBe(413);
  });
});
