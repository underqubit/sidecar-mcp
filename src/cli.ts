#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { safeError } from './errors.js';
import { Runtime } from './runtime.js';
import { startHttp, startStdio } from './mcp.js';

const help = `underqubit-sidecar-mcp

  serve --config <file.yaml|file.json> [--transport stdio|http]
  validate --config <file.yaml|file.json>

Configuration is loaded at startup. Logs and diagnostics are written to stderr.
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    config: { type: 'string' }, transport: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { process.stdout.write(help); return; }
  const command = positionals[0];
  if (!values.config || positionals.length !== 1 || !['serve', 'validate'].includes(command ?? '')) throw new Error('usage');
  if (values.transport && !['stdio', 'http'].includes(values.transport)) throw new Error('transport');
  const loaded = await loadConfig(values.config);
  if (command === 'validate') { process.stderr.write(`Valid configuration: ${loaded.config.tools.length} tools.\n`); return; }
  const runtime = new Runtime(loaded);
  const transport = values.transport ?? loaded.config.server.transport;
  const handle = transport === 'http' ? await startHttp(runtime) : startStdio(runtime);
  if ('url' in handle) process.stderr.write(`MCP listening at ${handle.url}\n`);
  let closing: Promise<void> | undefined;
  const close = (): void => {
    closing ??= (async () => {
      await runtime.close(); await handle.close();
      process.stdin.pause();
    })().catch(() => { process.exitCode = 1; });
  };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  if (transport === 'stdio') process.stdin.once('end', close);
}

main().catch(error => {
  const safe = safeError(error, 'config');
  process.stderr.write(`[${safe.stage}] ${safe.message}\nUse --help to see available options.\n`);
  process.exitCode = 1;
});
