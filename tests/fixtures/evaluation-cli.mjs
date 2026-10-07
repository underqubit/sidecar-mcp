// Deterministic, read-only stand-in for an existing operations CLI.
const projects = [
  { id: 'atlas', name: 'Atlas', owner: 'Ana', requests: 1000, errors: 10, latency: 80 },
  { id: 'boreal', name: 'Boreal', owner: 'Bruno', requests: 2000, errors: 50, latency: 120 },
  { id: 'coral', name: 'Coral', owner: 'Ana', requests: 500, errors: 5, latency: 60 },
];
const [command, id] = process.argv.slice(2);
if (command === 'list') process.stdout.write(JSON.stringify(projects.map(({ id, name, owner }) => ({ id, name, owner }))));
else if (command === 'stats') {
  const project = projects.find(p => p.id === id);
  if (!project) process.exit(2);
  process.stdout.write(`requests=${project.requests} errors=${project.errors} latency_ms=${project.latency}\n`);
} else process.exit(2);
