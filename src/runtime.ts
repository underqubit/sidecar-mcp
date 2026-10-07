import type { ValidateFunction } from 'ajv';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { AuthManager } from './auth.js';
import { newValidator, type LoadedConfig } from './config.js';
import type { ToolConfig } from './config-schema.js';
import { SidecarError, checkAbort, safeError } from './errors.js';
import { executeCli, executeHttp } from './executors.js';
import { processResponse } from './response.js';

interface CompiledTool { config: ToolConfig; input: ValidateFunction; output: ValidateFunction }
export interface LogEvent { tool: string; durationMs: number; ok: boolean; stage?: string }
export type Logger = (event: LogEvent) => void;
export const stderrLogger: Logger = event => { process.stderr.write(`${JSON.stringify(event)}\n`); };

export class Runtime {
  readonly tools = new Map<string, CompiledTool>();
  private readonly auth: AuthManager;
  private readonly shutdown = new AbortController();
  private readonly active = new Set<Promise<CallToolResult>>();

  constructor(readonly loaded: LoadedConfig, private readonly log: Logger = stderrLogger) {
    this.auth = new AuthManager(loaded.config.auth, loaded.env);
    for (const config of loaded.config.tools) this.tools.set(config.name, {
      config, input: newValidator().compile(config.inputSchema), output: newValidator().compile(config.outputSchema),
    });
  }

  async call(name: string, input: unknown, callerSignal?: AbortSignal): Promise<CallToolResult> {
    const task = this.run(name, input, callerSignal);
    this.active.add(task);
    try { return await task; } finally { this.active.delete(task); }
  }

  async close(): Promise<void> {
    this.shutdown.abort(); this.auth.close();
    await Promise.allSettled(this.active);
  }

  private async run(name: string, input: unknown, callerSignal?: AbortSignal): Promise<CallToolResult> {
    const start = performance.now();
    let stage: 'input' | 'parameters' | 'execution' | 'output' = 'input';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let logEvent: LogEvent = { tool: name, durationMs: 0, ok: false };
    try {
      const tool = this.tools.get(name);
      if (!tool) throw new SidecarError('input', 'Tool inexistente.');
      if (!tool.input(input)) throw new SidecarError('input', 'La entrada no cumple inputSchema.');
      const timeoutMs = tool.config.execution.timeoutMs ?? this.loaded.config.server.timeoutMs;
      const maxOutputBytes = tool.config.execution.maxOutputBytes ?? this.loaded.config.server.maxOutputBytes;
      const deadline = new AbortController();
      timer = setTimeout(() => deadline.abort(), timeoutMs);
      const signal = AbortSignal.any([deadline.signal, this.shutdown.signal, ...(callerSignal ? [callerSignal] : [])]);
      const ctx = { input, env: this.loaded.env, signal, maxOutputBytes, timeoutMs };
      checkAbort(signal); stage = 'execution';
      const execution = tool.config.execution;
      const raw = execution.type === 'http' ? await executeHttp(execution, ctx, this.auth) : await executeCli(execution, ctx);
      const output = await processResponse(tool.config.response, raw, maxOutputBytes, signal);
      checkAbort(signal); stage = 'output';
      if (!tool.output(output)) throw new SidecarError('output', 'El resultado no cumple outputSchema. Revise el parser o la transformación.');
      const text = JSON.stringify(output);
      if (Buffer.byteLength(text) > maxOutputBytes) throw new SidecarError('output', 'El resultado supera el límite de bytes.');
      logEvent.ok = true;
      return { resultType: 'complete', content: [{ type: 'text', text }], structuredContent: output as Record<string, unknown> };
    } catch (error) {
      const safe = safeError(error, stage); logEvent.stage = safe.stage;
      return { resultType: 'complete', isError: true, content: [{ type: 'text', text: `[${safe.stage}] ${safe.message}` }] };
    } finally {
      if (timer) clearTimeout(timer);
      logEvent.durationMs = Math.round(performance.now() - start);
      try { this.log(logEvent); } catch { /* Logging must not change tool outcomes. */ }
    }
  }
}
