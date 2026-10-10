import { createServer, type Server as HttpServer } from 'node:http';
import { McpServer, createMcpHandler, fromJsonSchema, validateHostHeader, type JsonSchemaValidator, type JsonSchemaType, type jsonSchemaValidator } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { hostHeaderValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { newValidator } from './config.js';
import { Runtime, type ToolCatalog } from './runtime.js';
import { Application } from './composition.js';
import type { ServerConfig } from './config-schema.js';

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

export function createMcpServer(runtime: ToolCatalog, requestSignal?: AbortSignal): McpServer {
  const config = runtime.identity;
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

export function startStdio(runtime: Runtime | Application): StdioServerHandle {
  const catalog = runtime instanceof Application ? runtime.stdioCatalog() : runtime;
  return serveStdio(() => createMcpServer(catalog), { onerror: () => process.stderr.write('MCP stdio transport error.\n') });
}

export interface HttpHandle { server: HttpServer; url: string; urls: string[]; close(): Promise<void> }
type McpHandler = ReturnType<typeof createMcpHandler>;
type HttpHandler = Pick<McpHandler, 'fetch' | 'close'>;

function guardRequest(request: Request, config: ServerConfig['http']): Response | undefined {
  const url = new URL(request.url);
  const host = request.headers.get('host');
  if (!validateHostHeader(url.host, config.allowedHosts).ok ||
      (host !== null && !validateHostHeader(host, config.allowedHosts).ok)) return new Response(null, { status: 403 });
  const origin = request.headers.get('origin');
  if (origin !== null && !config.allowedOrigins.includes(origin)) return new Response(null, { status: 403 });
  return undefined;
}

function endpointHandler(catalog: ToolCatalog, config: ServerConfig['http']): McpHandler {
  return createMcpHandler(ctx => createMcpServer(catalog, ctx.requestInfo?.signal), {
    responseMode: 'json', maxRequestBodySize: config.maxRequestBytes,
    onerror: () => process.stderr.write('MCP HTTP transport error.\n'),
  });
}

// Preserve the single-runtime API for embedded integrations.
export function createHttpHandler(runtime: Runtime): McpHandler {
  const config = runtime.loaded.config.server.http;
  const handler = endpointHandler(runtime, config);
  return {
    close: () => handler.close(), notify: handler.notify, bus: handler.bus,
    async fetch(request, options) {
      const denied = guardRequest(request, config);
      if (denied) return denied;
      if (new URL(request.url).pathname !== '/mcp') return new Response(null, { status: 404 });
      return handler.fetch(request, options);
    },
  };
}

export function createApplicationHttpHandler(application: Application): HttpHandler {
  const config = application.server.http;
  const handlers = new Map([...application.endpoints].map(([path, catalog]) => [path, endpointHandler(catalog, config)]));
  let closing: Promise<void> | undefined;
  return {
    close: () => closing ??= (async () => { await Promise.all([...handlers.values()].map(handler => handler.close())); })(),
    async fetch(request, options) {
      // Validate before routing and MCP parsing, including unknown endpoints.
      const denied = guardRequest(request, config);
      if (denied) return denied;
      const handler = handlers.get(new URL(request.url).pathname);
      if (!handler) return new Response(null, { status: 404 });
      return handler.fetch(request, options);
    },
  };
}

export async function startHttp(runtime: Runtime | Application): Promise<HttpHandle> {
  const config = runtime instanceof Application ? runtime.server.http : runtime.loaded.config.server.http;
  const handler = runtime instanceof Application ? createApplicationHttpHandler(runtime) : createHttpHandler(runtime);
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
  }).catch(async error => { await runtime.close(); await handler.close(); throw error; });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Invalid listen address');
  const base = `http://${address.family === 'IPv6' ? `[${address.address}]` : address.address}:${address.port}`;
  const paths = runtime instanceof Application ? [...runtime.endpoints.keys()] : ['/mcp'];
  const urls = paths.map(path => `${base}${path}`);
  let closing: Promise<void> | undefined;
  return {
    server, url: urls[0]!, urls,
    close() {
      return closing ??= (async () => {
        const stopped = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        try { await runtime.close(); await handler.close(); }
        finally { server.closeAllConnections(); await stopped; }
      })();
    },
  };
}
