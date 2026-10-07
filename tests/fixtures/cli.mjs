import { spawn } from 'node:child_process';
const [mode, ...args] = process.argv.slice(2);
if (mode === 'echo') {
  let stdin = '';
  for await (const chunk of process.stdin) stdin += chunk;
  process.stderr.write('private-diagnostic');
  process.stdout.write(JSON.stringify({ args, stdin, token: process.env.TEST_TOKEN, inherited: process.env.SHOULD_NOT_INHERIT, cwd: process.cwd() }));
} else if (mode === 'text') process.stdout.write(args[0] ?? '');
else if (mode === 'exit') { process.stderr.write('private-secret'); process.exit(Number(args[0])); }
else if (mode === 'large') process.stdout.write('x'.repeat(20000));
else if (mode === 'stderr-large') process.stderr.write('x'.repeat(20000));
else if (mode === 'hang') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
else if (mode === 'tree') {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
  process.stdout.write(String(child.pid));
  setInterval(() => {}, 1000);
}
