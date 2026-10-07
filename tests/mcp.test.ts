import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createHttpHandler } from '../dist/mcp.js';
import { loadConfig } from '../dist/config.js';
import { Runtime } from '../dist/runtime.js';
import { cliTool, runtime } from './helpers.js';

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
    const http = createHttpHandler(r); cleanup.push(async () => { await r.close(); await http.close(); });
    const clients = [new Client({ name: 'a', version: '1.0.0' }), new Client({ name: 'b', version: '1.0.0' })];
    for (const client of clients) { cleanup.push(() => client.close()); await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), { fetch: (url, init) => http.fetch(new Request(url, init)) })); }
    expect((await clients[0]!.listTools()).tools[0]!.name).toBe('local_echo');
    const results = await Promise.all(clients.map((client, i) => client.callTool({ name: 'local_echo', arguments: { message: `client-${i}` } })));
    expect(results.map(result => result.structuredContent)).toEqual([{ message: 'client-0' }, { message: 'client-1' }]);
  });

  it('bounds incoming HTTP request bodies', async () => {
    const r = await runtime(cliTool(), { server: { http: { port: 0, maxRequestBytes: 100 } } });
    const http = createHttpHandler(r); cleanup.push(async () => { await r.close(); await http.close(); });
    const response = await http.fetch(new Request('http://localhost/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ long: 'x'.repeat(200) }) }));
    expect(response.status).toBe(413);
  });

  it.each([
    ['http://untrusted.example/mcp', {}, 403],
    ['http://localhost/mcp', { Host: 'untrusted.example' }, 403],
    ['http://localhost/mcp', { Host: '' }, 403],
    ['http://localhost/mcp', { Origin: 'https://untrusted.example' }, 403],
    ['http://localhost/mcp', { Origin: '' }, 403],
    ['http://localhost/mcp', { Origin: 'null' }, 403],
    ['http://localhost/mcp', { Origin: 'https://console.example:444' }, 403],
    ['http://localhost/other', {}, 404],
  ])('enforces HTTP guards without a TCP socket: %s %j', async (url, headers, status) => {
    const r = await runtime(cliTool(), { server: { http: { allowedOrigins: ['https://console.example'] } } });
    const http = createHttpHandler(r); cleanup.push(async () => { await r.close(); await http.close(); });
    const response = await http.fetch(new Request(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}',
    }));
    expect(response.status).toBe(status);
  });

  it.each([undefined, 'https://console.example'])('accepts configured Host/Origin while preserving size limits (%s)', async origin => {
    const r = await runtime(cliTool(), { server: { http: {
      allowedHosts: ['sidecar.example'], allowedOrigins: ['https://console.example'], maxRequestBytes: 100,
    } } });
    const http = createHttpHandler(r); cleanup.push(async () => { await r.close(); await http.close(); });
    const headers = new Headers({ 'Content-Type': 'application/json', Host: 'sidecar.example:8080' });
    if (origin !== undefined) headers.set('Origin', origin);
    const response = await http.fetch(new Request('http://sidecar.example:8080/mcp?source=test', {
      method: 'POST', headers, body: JSON.stringify({ long: 'x'.repeat(200) }),
    }));
    expect(response.status).toBe(413);
  });
});
