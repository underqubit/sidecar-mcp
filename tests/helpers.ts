import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { prepareConfig } from '../dist/config.js';
import { Runtime } from '../dist/runtime.js';

export const object = { type: 'object' };
export const fixture = resolve('tests/fixtures/cli.mjs');
export function cliTool(execution: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'test_tool', description: 'Test tool', inputSchema: object, outputSchema: object,
    execution: { type: 'cli', command: process.execPath, args: [fixture, 'echo'], ...execution }, ...extra };
}
export function httpTool(baseUrl: string, execution: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'test_tool', description: 'Test HTTP tool', inputSchema: object, outputSchema: object,
    execution: { type: 'http', baseUrl, ...execution }, ...extra };
}
export async function runtime(tool: Record<string, unknown>, extra: Record<string, unknown> = {}, env: Record<string, string> = {}): Promise<Runtime> {
  return new Runtime(await prepareConfig({ version: 1, tools: [tool], ...extra }, process.cwd(), env), () => {});
}
export async function httpFixture(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void | Promise<void>): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    try { await handler(req, res, body); }
    catch { res.writeHead(500).end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  return { url: `http://127.0.0.1:${address.port}`, async close() {
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections(); await closed;
  } };
}
