import { rm, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// A clean output directory prevents deleted modules from leaking into a release.
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)), '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [fileURLToPath(new URL('./generate-schema.mjs', import.meta.url))], { cwd: root, stdio: 'inherit' });
await chmod(new URL('../dist/cli.js', import.meta.url), 0o755);
