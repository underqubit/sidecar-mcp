import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { loadConfig } from '../dist/config.js';
import { createMcpServer } from '../dist/mcp.js';
import { Runtime } from '../dist/runtime.js';

it('verifies the ten evaluation answers from real configured MCP tool calls', async () => {
  const runtime = new Runtime(await loadConfig('tests/fixtures/evaluation.yaml'), () => {});
  const server = createMcpServer(runtime);
  const client = new Client({ name: 'evaluation', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const list = await client.callTool({ name: 'ops_list_projects', arguments: {} });
    expect(list.isError).toBeUndefined();
    const { projects } = list.structuredContent as { projects: { id: string; name: string; owner: string }[] };
    const records = await Promise.all(projects.map(async project => {
      const result = await client.callTool({ name: 'ops_project_stats', arguments: { id: project.id } });
      expect(result.isError).toBeUndefined();
      return { ...project, ...result.structuredContent as { requests: number; errors: number; latencyMs: number } };
    }));
    const ana = records.filter(p => p.owner === 'Ana');
    const total = (rows: typeof records, key: 'requests' | 'errors' | 'latencyMs'): number => rows.reduce((n, p) => n + p[key], 0);
    const byOwner = Object.fromEntries([...new Set(records.map(p => p.owner))].map(owner => [owner, total(records.filter(p => p.owner === owner), 'requests')]));
    const actual = [
      total(ana, 'requests'), total(records, 'errors'),
      [...records].sort((a, b) => b.errors / b.requests - a.errors / a.requests)[0]!.name,
      [...records].sort((a, b) => a.latencyMs - b.latencyMs)[0]!.name,
      Object.entries(byOwner).sort((a, b) => b[1] - a[1])[0]![0],
      total(records, 'requests') - total(records, 'errors'), total(ana, 'requests') - total(ana, 'errors'),
      (100 * total(records, 'errors') / total(records, 'requests')).toFixed(2),
      total(records.filter(p => p.latencyMs < 100), 'requests'), total(ana, 'latencyMs') / ana.length,
    ].map(String);
    const xml = await readFile('evaluations/questions.xml', 'utf8');
    const expected = [...xml.matchAll(/<answer>(.*?)<\/answer>/g)].map(match => match[1]);
    expect(expected).toHaveLength(10); expect(actual).toEqual(expected);
  } finally { await runtime.close(); await client.close(); await server.close(); }
});
