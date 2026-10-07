import { SidecarError } from './errors.js';

export type Environment = Readonly<Record<string, string | undefined>>;
const reference = /\$\{(input|env)\.([A-Za-z0-9_.-]+)\}/g;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

export function references(value: string): { source: string; path: string }[] {
  const matches = [...value.matchAll(reference)].map(m => ({ source: m[1]!, path: m[2]! }));
  if (value.replace(reference, '').includes('${')) {
    throw new SidecarError('config', 'Invalid template; use ${input.field} or ${env.VARIABLE}.');
  }
  for (const ref of matches) {
    if (ref.path.split('.').some(part => forbidden.has(part))) {
      throw new SidecarError('config', 'The template contains a disallowed property.');
    }
  }
  return matches;
}

export function walkStrings(value: unknown, visit: (value: string) => void): void {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) value.forEach(v => walkStrings(v, visit));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => walkStrings(v, visit));
}

function lookup(source: string, path: string, input: unknown, env: Environment): unknown {
  let value: unknown = source === 'env' ? env : input;
  for (const key of path.split('.')) {
    if (forbidden.has(key) || !value || typeof value !== 'object' || !Object.hasOwn(value, key)) {
      throw new SidecarError('parameters', `Reference unavailable: ${source}.${path}.`);
    }
    value = (value as Record<string, unknown>)[key];
  }
  if (value === undefined) throw new SidecarError('parameters', `Reference unavailable: ${source}.${path}.`);
  return value;
}

export function scalar(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return String(value);
  throw new SidecarError('parameters', 'Expected a scalar value (string, number, or boolean).');
}

export function render(value: unknown, input: unknown, env: Environment): unknown {
  if (typeof value === 'string') {
    references(value);
    const exact = /^\$\{(input|env)\.([A-Za-z0-9_.-]+)\}$/.exec(value);
    if (exact) return lookup(exact[1]!, exact[2]!, input, env);
    return value.replace(reference, (_match, source: string, path: string) => scalar(lookup(source, path, input, env)));
  }
  if (Array.isArray(value)) return value.map(v => render(v, input, env));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, render(v, input, env)]));
  }
  return value;
}

export function renderString(value: string, input: unknown, env: Environment): string {
  return scalar(render(value, input, env));
}
