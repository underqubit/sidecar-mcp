import { parentPort, workerData } from 'node:worker_threads';
import jsonata from 'jsonata';
import type { ResponseConfig } from './config-schema.js';
import type { RawResponse } from './executors.js';

interface Work { config: ResponseConfig; raw?: RawResponse; validateOnly?: boolean; maxOutputBytes: number }
const work = workerData as Work;
let stage = 'config';
try {
  const parser = work.config.parser;
  const regex = parser.type === 'regex' ? new RegExp(parser.pattern, parser.flags + (parser.mode === 'all' ? 'g' : '')) : undefined;
  if (parser.type === 'regex' && !/\(\?<[^=!][^>]*>/.test(parser.pattern)) throw new Error('named groups required');
  const expression = work.config.transform ? jsonata(work.config.transform) : undefined;
  if (work.validateOnly) parentPort!.postMessage({ ok: true });
  else {
    stage = 'parse';
    const raw = work.raw!;
    let data: unknown;
    if (parser.type === 'json') data = JSON.parse(raw.text);
    else if (parser.type === 'text') data = raw.text;
    else if (parser.mode === 'all') data = [...raw.text.matchAll(regex!)].map(match => ({ ...match.groups }));
    else {
      const match = regex!.exec(raw.text);
      if (!match) throw new Error('no match');
      data = { ...match.groups };
    }
    stage = 'transform';
    const result: unknown = expression ? await expression.evaluate({ data, metadata: raw.metadata }) : data;
    const serialized = JSON.stringify(result);
    if (serialized === undefined) throw new Error('empty');
    if (Buffer.byteLength(serialized) > work.maxOutputBytes) parentPort!.postMessage({ ok: false, stage: 'output', message: 'The transformed output exceeds the byte limit.' });
    else parentPort!.postMessage({ ok: true, result: JSON.parse(serialized) as unknown });
  }
} catch {
  parentPort!.postMessage({ ok: false, stage, message: stage === 'config' ? 'Invalid regex parser or JSONata expression.' : stage === 'parse' ? 'Could not parse the output or find a regex match.' : 'The JSONata transformation failed or did not produce a JSON value.' });
}
