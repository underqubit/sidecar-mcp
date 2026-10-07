import { spawn } from 'node:child_process';
import axios, { AxiosHeaders } from 'axios';
import type { ExecutionConfig } from './config-schema.js';
import type { AuthManager } from './auth.js';
import { SidecarError, checkAbort } from './errors.js';
import { render, renderString, scalar, type Environment } from './templates.js';

export interface RawResponse { text: string; metadata: Record<string, unknown> }
export interface ExecutionContext {
  input: unknown; env: Environment; signal: AbortSignal; maxOutputBytes: number; timeoutMs: number;
}

export function appendParams(params: URLSearchParams, values: unknown): void {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new SidecarError('parameters', 'Parameters must be an object.');
  for (const [key, value] of Object.entries(values)) {
    if (value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, scalar(item));
  }
}

export async function executeHttp(config: Extract<ExecutionConfig, { type: 'http' }>, ctx: ExecutionContext, auth: AuthManager): Promise<RawResponse> {
  checkAbort(ctx.signal);
  const base = new URL(renderString(config.baseUrl, {}, ctx.env));
  const path = config.path.replace(/\{([A-Za-z0-9_-]+)\}/g, (_match, key: string) => {
    const parameter = scalar(render(config.pathParams[key], ctx.input, ctx.env));
    if (parameter === '.' || parameter === '..') throw new SidecarError('parameters', 'A path parameter cannot be "." or "..".');
    return encodeURIComponent(parameter);
  });
  const url = new URL(path || base.href, base.href.endsWith('/') ? base.href : `${base.href}/`);
  if (url.origin !== base.origin || url.username || url.password || url.hash) throw new SidecarError('parameters', 'The path must preserve the configured HTTP origin and contain no fragments.');
  appendParams(url.searchParams, render(config.query, ctx.input, ctx.env));
  const headers = new AxiosHeaders();
  for (const [key, value] of Object.entries(config.headers)) headers.set(key, renderString(value, ctx.input, ctx.env));
  await auth.apply(config.auth, headers, url.searchParams, ctx.signal);
  let body = render(config.body, ctx.input, ctx.env);
  if (body !== undefined) {
    if (config.bodyEncoding === 'form') {
      const form = new URLSearchParams(); appendParams(form, body); body = form.toString();
      headers.set('Content-Type', 'application/x-www-form-urlencoded');
    } else if (config.bodyEncoding === 'text') {
      body = scalar(body); headers.set('Content-Type', 'text/plain; charset=utf-8');
    } else {
      body = JSON.stringify(body); headers.set('Content-Type', 'application/json');
    }
  }
  try {
    const response = await axios.request<string>({
      method: config.method, url: url.href, headers, data: body, signal: ctx.signal, timeout: ctx.timeoutMs,
      maxRedirects: 0, maxContentLength: ctx.maxOutputBytes, maxBodyLength: ctx.maxOutputBytes,
      responseType: 'text', transformResponse: [data => data], proxy: false,
      validateStatus: status => config.successStatuses ? config.successStatuses.includes(status) : status >= 200 && status < 300,
    });
    return { text: response.data, metadata: { status: response.status, headers: {
      'content-type': response.headers['content-type'], 'retry-after': response.headers['retry-after'],
    } } };
  } catch (error) {
    checkAbort(ctx.signal);
    if (axios.isAxiosError(error) && error.response) throw new SidecarError('execution', `The API returned HTTP ${error.response.status}.`);
    throw new SidecarError('execution', 'HTTP request failed: connection, timeout, or byte limit.');
  }
}

export async function executeCli(config: Extract<ExecutionConfig, { type: 'cli' }>, ctx: ExecutionContext): Promise<RawResponse> {
  checkAbort(ctx.signal);
  const args = config.args.map(arg => renderString(arg, ctx.input, ctx.env));
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP', 'LANG']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(config.env)) env[key] = renderString(value, ctx.input, ctx.env);
  const data = render(config.stdin, ctx.input, ctx.env);
  const stdin = data === undefined ? undefined : typeof data === 'string' ? data : JSON.stringify(data);
  if (stdin !== undefined && Buffer.byteLength(stdin) > ctx.maxOutputBytes) throw new SidecarError('parameters', 'stdin exceeds the byte limit.');
  return new Promise<RawResponse>((resolve, reject) => {
    const child = spawn(config.command, args, { cwd: config.cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    let bytes = 0;
    let failure: SidecarError | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals): void => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* The process may already have exited. */ }
    };
    const stop = (error: SidecarError): void => {
      if (failure) return;
      failure = error; kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 250);
    };
    const aborted = (): void => stop(new SidecarError('execution', 'CLI canceled or time limit exceeded.'));
    ctx.signal.addEventListener('abort', aborted, { once: true });
    if (ctx.signal.aborted) aborted();
    const collect = (chunk: Buffer, keep: boolean): void => {
      bytes += chunk.length;
      if (bytes > ctx.maxOutputBytes) stop(new SidecarError('execution', 'CLI output exceeds the byte limit.'));
      else if (!failure && keep) stdout.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => collect(chunk, true));
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, false));
    child.on('error', () => { failure = new SidecarError('execution', 'Could not start the configured executable.'); });
    child.stdin.on('error', () => { /* EPIPE: exit code and captured output determine the outcome. */ });
    child.on('close', code => {
      ctx.signal.removeEventListener('abort', aborted);
      if (killTimer) { clearTimeout(killTimer); kill('SIGKILL'); }
      if (failure) reject(failure);
      else if (code === null || !config.successExitCodes.includes(code)) reject(new SidecarError('execution', `The CLI exited with code ${code ?? 'signal'}.`));
      else resolve({ text: Buffer.concat(stdout).toString('utf8'), metadata: { exitCode: code } });
    });
    child.stdin.end(stdin);
  });
}
