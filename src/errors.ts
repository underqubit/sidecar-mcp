export type Stage = 'config' | 'input' | 'parameters' | 'auth' | 'execution' | 'parse' | 'transform' | 'output';

/** Only deliberate, credential-free messages may cross the MCP boundary. */
export class SidecarError extends Error {
  constructor(public readonly stage: Stage, message: string) {
    super(message);
    this.name = 'SidecarError';
  }
}

export function safeError(error: unknown, fallback: Stage): SidecarError {
  return error instanceof SidecarError ? error : new SidecarError(fallback, 'La operación falló. Revise la configuración y el servicio.');
}

export function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new SidecarError('execution', 'Operación cancelada o tiempo máximo excedido.');
}
