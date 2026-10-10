#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { Application, deploymentTransport, loadDeployment } from './composition.js';
import { safeError } from './errors.js';
import { startHttp, startStdio } from './mcp.js';

const help = `underqubit-sidecar-mcp

  serve --config <file.yaml|file.json> [--transport stdio|http]
  validate --config <file.yaml|file.json> [--transport stdio|http]

Accepts an integration or a composition of configuration files.
Composition modes: unified (stdio/HTTP), separate or both (HTTP only).
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
  const loaded = await loadDeployment(values.config);
  const transport = deploymentTransport(loaded, values.transport as 'stdio' | 'http' | undefined);
  const count = loaded.kind === 'single' ? loaded.loaded.config.tools.length : loaded.groups.reduce((total, group) => total + group.loaded.config.tools.length, 0);
  if (command === 'validate') { process.stderr.write(`Valid configuration: ${count} tools.\n`); return; }
  const runtime = new Application(loaded);
  const handle = await (async () => {
    try { return transport === 'http' ? await startHttp(runtime) : startStdio(runtime); }
    catch (error) { await runtime.close(); throw error; }
  })();
  if ('urls' in handle && Array.isArray(handle.urls)) for (const url of handle.urls) process.stderr.write(`MCP listening at ${url}\n`);
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
