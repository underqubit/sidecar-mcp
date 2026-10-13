import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const { values } = parseArgs({ options: { offline: { type: 'boolean' } } });
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.env.npm_execpath;
assert(npm, 'Run this check with npm run check:package.');
const runNpm = (args, cwd) => exec(process.execPath, [npm, ...args], { cwd, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
const temporary = await mkdtemp(join(tmpdir(), 'sidecar-package-'));
try {
  const { stdout } = await runNpm(['pack', '--json', '--pack-destination', temporary], root);
  const [pack] = JSON.parse(stdout);
  const files = new Set(pack.files.map(file => file.path));
  for (const file of ['LICENSE', 'README.md', 'README.es.md', 'dist/cli.js', 'dist/response-worker.js', 'schema/config.schema.json', 'examples/cli.yaml', 'examples/composition.json', 'scripts/openapi-to-config.mjs', 'scripts/lib/openapi-schema.mjs']) {
    assert(files.has(file), `Missing package file: ${file}`);
  }
  assert(pack.files.find(file => file.path === 'dist/cli.js').mode & 0o111, 'CLI must be executable.');
  for (const file of files) {
    assert(!/(^|\/)\.env(?:\.|$)|(^|\/)(?:tests|node_modules|\.git|coverage)(?:\/|$)|\.tgz$/.test(file), `Unexpected package file: ${file}`);
  }
  assert(!files.has('examples/jira.json') && !files.has('scripts/diagnose-jira.mjs'), 'Local Jira files must not be packed.');
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.license, 'Apache-2.0'); assert.notEqual(manifest.private, true);
  const tarball = join(temporary, pack.filename);
  const consumer = { name: 'sidecar-package-smoke', version: '1.0.0', private: true, dependencies: { [manifest.name]: `file:${tarball}` } };
  // Pin the consumer to the production versions reviewed in the repository lockfile.
  // This tests the tarball as an installed dependency, without dev dependencies.
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const packages = Object.fromEntries(Object.entries(lock.packages).filter(([path, pkg]) => path && !pkg.dev));
  packages[''] = consumer;
  packages[`node_modules/${manifest.name}`] = {
    version: manifest.version, resolved: `file:${tarball}`, integrity: pack.integrity,
    license: manifest.license, dependencies: manifest.dependencies, bin: manifest.bin, engines: manifest.engines,
  };
  await writeFile(join(temporary, 'package.json'), JSON.stringify(consumer));
  await writeFile(join(temporary, 'package-lock.json'), JSON.stringify({ name: consumer.name, version: consumer.version, lockfileVersion: 3, requires: true, packages }));
  await runNpm(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', ...(values.offline ? ['--offline'] : [])], temporary);
  const installed = join(temporary, 'node_modules', manifest.name);
  const help = await runNpm(['exec', '--offline', '--', manifest.name, '--help'], temporary);
  assert.match(help.stdout, /serve --config/);
  assert(await access(join(temporary, 'node_modules/typescript')).then(() => false, () => true), 'Consumer must not need TypeScript.');
  const cli = join(installed, 'dist/cli.js');
  await exec(process.execPath, [cli, 'validate', '--config', join(installed, 'examples/composition.json')], { cwd: temporary });
  const generated = await exec(process.execPath, [join(installed, 'scripts/openapi-to-config.mjs'), '--input', join(installed, 'examples/openapi/openapi3.yaml'), '--methods', 'GET'], { cwd: temporary });
  assert.equal(JSON.parse(generated.stdout).tools.length, 1);
  const client = new Client({ name: 'package-smoke', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'serve', '--config', join(installed, 'examples/composition.json')], cwd: temporary, stderr: 'pipe' }));
    assert.equal((await client.listTools()).tools.length, 3);
    assert.deepEqual((await client.callTool({ name: 'echo.local_echo', arguments: { message: 'installed package' } })).structuredContent, { message: 'installed package' });
    const version = await client.callTool({ name: 'local.local_node_version', arguments: {} });
    assert(!version.isError, 'The packed response worker must execute successfully.');
    assert.match(version.structuredContent.version, /^\d+\.\d+\.\d+/);
  } finally { await client.close(); }
  process.stdout.write(`Package verified: ${pack.name}@${pack.version}, ${files.size} files, ${pack.size} bytes. Production install, npm exec, MCP tools, worker, and OpenAPI import passed.\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
