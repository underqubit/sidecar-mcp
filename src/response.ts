import { Worker } from 'node:worker_threads';
import type { ResponseConfig } from './config-schema.js';
import type { RawResponse } from './executors.js';
import { SidecarError, checkAbort, type Stage } from './errors.js';

interface WorkerReply { ok: boolean; stage?: Stage; message?: string; result?: unknown }

async function work(config: ResponseConfig, raw: RawResponse | undefined, maxOutputBytes: number, signal: AbortSignal, validateOnly: boolean): Promise<unknown> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./response-worker.js', import.meta.url), {
      workerData: { config, raw, validateOnly, maxOutputBytes }, env: {},
      resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 },
    });
    let settled = false;
    const finish = (error?: Error, value?: unknown): void => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      void worker.terminate().then(() => error ? reject(error) : resolve(value));
    };
    const abort = (): void => finish(new SidecarError('execution', 'Procesamiento de respuesta cancelado.'));
    const timer = setTimeout(() => finish(new SidecarError(validateOnly ? 'config' : 'transform', 'Parser/transformación excedió el tiempo máximo.')), config.workerTimeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    worker.on('message', (message: WorkerReply) => message.ok ? finish(undefined, message.result) : finish(new SidecarError(message.stage!, message.message!)));
    worker.on('error', () => finish(new SidecarError(validateOnly ? 'config' : 'transform', 'El worker de respuesta falló o excedió sus recursos.')));
    worker.on('exit', code => { if (!settled) finish(new SidecarError(validateOnly ? 'config' : 'transform', `Worker finalizado sin respuesta (código ${code}).`)); });
    if (signal.aborted) abort();
  });
}

export async function validateResponse(config: ResponseConfig): Promise<void> {
  if (config.parser.type === 'regex' || config.transform) await work(config, undefined, 1048576, new AbortController().signal, true);
}

export async function processResponse(config: ResponseConfig, raw: RawResponse, maxOutputBytes: number, signal: AbortSignal): Promise<unknown> {
  if (config.parser.type !== 'regex' && !config.transform) {
    checkAbort(signal);
    if (Buffer.byteLength(raw.text) > maxOutputBytes) throw new SidecarError('output', 'La salida supera el límite de bytes.');
    if (config.parser.type === 'text') return raw.text;
    try { return JSON.parse(raw.text) as unknown; }
    catch { throw new SidecarError('parse', 'La salida no es JSON válido.'); }
  }
  return work(config, raw, maxOutputBytes, signal, false);
}
