import { z } from 'zod';

const nonempty = z.string().min(1);
const dictionary = z.record(z.string(), z.json());
const stringMap = z.record(z.string(), z.string());
const secret = z.string().regex(/^\$\{env\.[A-Za-z_][A-Za-z0-9_]*\}$/, 'Use an ${env.VARIABLE} reference.');
const objectSchema = z.looseObject({ type: z.literal('object') });
const timeoutMs = z.number().int().positive().max(2_147_483_647);
const maxOutputBytes = z.number().int().positive().max(64 * 1024 * 1024);

export const authSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('none') }),
  z.strictObject({ type: z.literal('apiKey'), in: z.enum(['header', 'query']), name: nonempty, value: secret }),
  z.strictObject({ type: z.literal('bearer'), token: secret }),
  z.strictObject({ type: z.literal('basic'), username: secret, password: secret }),
  z.strictObject({
    type: z.literal('oauth2'), tokenUrl: nonempty, clientId: secret, clientSecret: secret,
    scopes: z.array(nonempty).default([]), tokenAuthMethod: z.enum(['basic', 'body']).default('basic'),
    timeoutMs: timeoutMs.default(10000),
  }),
]);

export const executionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('http'), baseUrl: nonempty, path: z.string().default(''),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).default('GET'),
    pathParams: dictionary.default({}), query: dictionary.default({}), headers: stringMap.default({}),
    body: z.json().optional(), bodyEncoding: z.enum(['json', 'form', 'text']).default('json'),
    auth: nonempty.optional(), successStatuses: z.array(z.number().int().min(100).max(599)).min(1).optional(),
    timeoutMs: timeoutMs.optional(), maxOutputBytes: maxOutputBytes.optional(),
  }),
  z.strictObject({
    type: z.literal('cli'), command: nonempty, args: z.array(z.string()).default([]),
    cwd: nonempty.optional(), env: stringMap.default({}), stdin: z.json().optional(),
    successExitCodes: z.array(z.number().int().min(0).max(255)).min(1).default([0]),
    timeoutMs: timeoutMs.optional(), maxOutputBytes: maxOutputBytes.optional(),
  }),
]);

export const responseSchema = z.strictObject({
  parser: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('json') }),
    z.strictObject({ type: z.literal('text') }),
    z.strictObject({
      type: z.literal('regex'), pattern: nonempty, flags: z.string().regex(/^[imsu]*$/).default(''),
      mode: z.enum(['first', 'all']).default('first'),
    }),
  ]).default({ type: 'json' }),
  transform: nonempty.optional(), workerTimeoutMs: timeoutMs.default(1000),
});

export const serverSchema = z.strictObject({
  name: nonempty.default('underqubit-sidecar-mcp'), version: nonempty.default('0.1.0'),
  transport: z.enum(['stdio', 'http']).default('stdio'),
  timeoutMs: timeoutMs.default(30000), maxOutputBytes: maxOutputBytes.default(1048576),
  http: z.strictObject({
    host: nonempty.default('127.0.0.1'), port: z.number().int().min(0).max(65535).default(3000),
    allowedHosts: z.array(nonempty).default(['127.0.0.1', 'localhost', '[::1]']),
    allowedOrigins: z.array(z.url()).default([]), maxRequestBytes: maxOutputBytes.default(1048576),
  }).default({ host: '127.0.0.1', port: 3000, allowedHosts: ['127.0.0.1', 'localhost', '[::1]'], allowedOrigins: [], maxRequestBytes: 1048576 }),
}).default({ name: 'underqubit-sidecar-mcp', version: '0.1.0', transport: 'stdio', timeoutMs: 30000, maxOutputBytes: 1048576, http: { host: '127.0.0.1', port: 3000, allowedHosts: ['127.0.0.1', 'localhost', '[::1]'], allowedOrigins: [], maxRequestBytes: 1048576 } });

export const configSchema = z.strictObject({
  $schema: z.string().optional(),
  version: z.literal(1),
  server: serverSchema,
  auth: z.record(z.string(), authSchema).default({}),
  tools: z.array(z.strictObject({
    name: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/), title: nonempty.optional(), description: nonempty,
    inputSchema: objectSchema, outputSchema: objectSchema,
    annotations: z.strictObject({
      readOnlyHint: z.boolean().optional(), destructiveHint: z.boolean().optional(),
      idempotentHint: z.boolean().optional(), openWorldHint: z.boolean().optional(),
    }).optional(),
    execution: executionSchema, response: responseSchema.default({ parser: { type: 'json' }, workerTimeoutMs: 1000 }),
  })).min(1),
});

export type Config = z.infer<typeof configSchema>;
export type ToolConfig = Config['tools'][number];
export type ExecutionConfig = ToolConfig['execution'];
export type AuthConfig = z.infer<typeof authSchema>;
export type ResponseConfig = z.infer<typeof responseSchema>;

// Composition owns the listener; execution defaults remain local to each integration.
export const compositionSchema = z.strictObject({
  $schema: z.string().optional(),
  version: z.literal(1),
  kind: z.literal('composition'),
  server: serverSchema.removeDefault().omit({ timeoutMs: true, maxOutputBytes: true }).prefault({}),
  mode: z.enum(['unified', 'separate', 'both']),
  groups: z.array(z.strictObject({
    id: z.string().regex(/^[a-z0-9_-]+$/).max(126),
    config: nonempty,
  })).min(1),
});

export const configurationFileSchema = z.union([configSchema, compositionSchema]);
export type CompositionConfig = z.infer<typeof compositionSchema>;
export type ServerConfig = CompositionConfig['server'];
