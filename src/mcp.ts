import { createServer, type Server as HttpServer } from 'node:http';
import { McpServer, createMcpHandler, fromJsonSchema, validateHostHeader, type JsonSchemaValidator, type JsonSchemaType, type jsonSchemaValidator } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { hostHeaderValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { newValidator } from './config.js';
import { Runtime } from './runtime.js';

const schemaValidators = new WeakMap<object, ReturnType<ReturnType<typeof newValidator>['compile']>>();
const validator: jsonSchemaValidator = {
  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
    let validate = schemaValidators.get(schema);
    if (!validate) { validate = newValidator().compile(schema); schemaValidators.set(schema, validate); }
    const check = validate;
    return (input: unknown) => check(input)
      ? { valid: true, data: input as T, errorMessage: undefined }
      : { valid: false, data: undefined, errorMessage: 'The data does not match the declared JSON Schema.' };
  },
};

export function createMcpServer(runtime: Runtime, requestSignal?: AbortSignal): McpServer {
  const config = runtime.loaded.config.server;
  const server = new McpServer({ name: config.name, version: config.version });
  for (const { config: tool } of [...runtime.tools.values()].sort((a, b) => a.config.name.localeCompare(b.config.name))) {
    server.registerTool(tool.name, {
      title: tool.title, description: tool.description, annotations: tool.annotations,
      inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema, validator),
      outputSchema: fromJsonSchema<Record<string, unknown>>(tool.outputSchema, validator),
    }, (input, ctx) => runtime.call(tool.name, input, requestSignal ? AbortSignal.any([requestSignal, ctx.mcpReq.signal]) : ctx.mcpReq.signal));
  }
  return server;
}

export function startStdio(runtime: Runtime): StdioServerHandle {
  return serveStdio(() => createMcpServer(runtime), { onerror: () => process.stderr.write('MCP stdio transport error.\n') });
}

export interface HttpHandle { server: HttpServer; url: string; close(): Promise<void> }

export function createHttpHandler(runtime: Runtime): ReturnType<typeof createMcpHandler> {
  const config = runtime.loaded.config.server.http;
  const handler = createMcpHandler(ctx => createMcpServer(runtime, ctx.requestInfo?.signal), {
    responseMode: 'json', maxRequestBodySize: config.maxRequestBytes,
    onerror: () => process.stderr.write('MCP HTTP transport error.\n'),
  });
  return {
    close: () => handler.close(), notify: handler.notify, bus: handler.bus,
    async fetch(request, options) {
      const url = new URL(request.url);
      const host = request.headers.get('host');
      if (!validateHostHeader(url.host, config.allowedHosts).ok ||
          (host !== null && !validateHostHeader(host, config.allowedHosts).ok)) {
        return new Response(null, { status: 403 });
      }
      const origin = request.headers.get('origin');
      if (origin !== null && !config.allowedOrigins.includes(origin)) return new Response(null, { status: 403 });
      if (url.pathname !== '/mcp') return new Response(null, { status: 404 });
      // These guards run before MCP parsing in both Node and fetch-based integrations.
      // CORS is deliberately not enabled; a trusted proxy can provide browser access.
      return handler.fetch(request, options);
    },
  };
}

export async function startHttp(runtime: Runtime): Promise<HttpHandle> {
  const config = runtime.loaded.config.server.http;
  const handler = createHttpHandler(runtime);
  const handle = toNodeHandler(handler, { maxRequestBodySize: config.maxRequestBytes });
  const validateHost = hostHeaderValidation(config.allowedHosts);
  const server = createServer((req, res) => {
    // Preserve validation of the original Host header before the Node adapter builds a URL.
    if (!validateHost(req, res)) return;
    void handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => { server.removeListener('error', reject); resolve(); });
  }).catch(async error => { await handler.close(); throw error; });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Invalid listen address');
  return {
    server, url: `http://${address.family === 'IPv6' ? `[${address.address}]` : address.address}:${address.port}/mcp`,
    async close() {
      const closing = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await runtime.close(); await handler.close(); server.closeAllConnections(); await closing;
    },
  };
}
