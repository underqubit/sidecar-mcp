import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newValidator, prepareConfig } from '../dist/config.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const languages = ['docs/json-schema.md', 'docs/en/json-schema.md'];
const documents = await Promise.all(languages.map(file => readFile(resolve(root, file), 'utf8')));
const extract = text => [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]));
const schemas = extract(documents[0]);
assert.deepEqual(extract(documents[1]), schemas, 'Both languages must contain the same JSON Schema examples.');

// Include both installed validator extensions and the standard dialect's keywords.
// This catches inventory drift when AJV or ajv-formats is upgraded.
const validator = newValidator();
const keywords = new Set(Object.keys(validator.RULES.keywords));
const require = createRequire(import.meta.url);
const metaDirectory = resolve(dirname(require.resolve('ajv/package.json')), 'dist/refs/json-schema-2020-12/meta');
for (const file of await readdir(metaDirectory)) {
  if (!file.endsWith('.json')) continue;
  const meta = JSON.parse(await readFile(resolve(metaDirectory, file), 'utf8'));
  Object.keys(meta.properties || {}).forEach(keyword => keywords.add(keyword));
}
for (const [index, document] of documents.entries()) {
  const tableNames = new Set([...document.matchAll(/^\| ([^|]+)\|/gm)].flatMap(match => [...match[1].matchAll(/`([^`]+)`/g)].map(token => token[1])));
  for (const keyword of keywords) assert(tableNames.has(keyword), `${languages[index]} must explain ${keyword} in a reference table.`);
  for (const format of Object.keys(validator.formats)) assert(tableNames.has(format), `${languages[index]} must explain format ${format}.`);
}

const cases = [
  { name: 'types and null', valid: [{ issueKey: 'CS-303', assignee: null }], invalid: [{ issueKey: null }, { issueKey: 'CS-303', state: 'unknown' }, { issueKey: 'CS-303', verbose: true }] },
  { name: 'nested closure', valid: [{ issue: { key: 'CS-303', summary: 'Example' } }], invalid: [{ issue: { key: 'CS-303', summary: 'Example', extra: 1 } }, { issue: { key: 'CS-303', summary: 'Example' }, extra: 1 }] },
  { name: 'dictionaries', valid: [{ labels: { team: 'support' }, metrics: { metric_count: 3 } }], invalid: [{ labels: { 'bad-name': 'support' } }, { metrics: { metric_count: '3' } }, { metrics: { count: 3 } }] },
  { name: 'composition closure', valid: [{ key: 'CS-303', summary: 'Example' }], invalid: [{ key: 'CS-303' }, { key: 'CS-303', summary: 'Example', extra: true }] },
  { name: 'strings and numbers', valid: [{ limit: 10, score: 0.5, amountCents: 15 }], invalid: [{ limit: '10' }, { limit: 10, score: 1 }, { limit: 10, amountCents: 12 }, { limit: 10, email: 'invalid' }] },
  { name: 'format range', valid: [{ since: '2026-01-01' }, { since: '2026-12-31' }], invalid: [{ since: '2025-12-31' }, { since: '2027-01-01' }, { since: '2026-02-30' }] },
  { name: 'arrays', valid: [{ tags: ['support'], coordinate: [10, 20], states: ['open', 'closed'] }], invalid: [{ tags: ['support', 'support'] }, { coordinate: [10, 20, 30] }, { states: ['closed'] }, { states: ['open', 'open', 'open'] }] },
  { name: 'conditions', valid: [{ mode: 'issue', issueKey: 'CS-303' }, { mode: 'search', jql: 'project = CS' }], invalid: [{ mode: 'issue' }, { mode: 'search' }, { mode: 'issue', issueKey: 'CS-303', jql: 'project = CS' }, { mode: 'other' }] },
  { name: 'unions', valid: [{ identifier: 3, result: { status: 'ok', value: 'done' } }, { identifier: 'CS-303', result: { status: 'error', message: 'Example' } }], invalid: [{ identifier: true, result: { status: 'ok', value: 'done' } }, { identifier: 3, result: { status: 'ok' } }] },
  { name: 'dependencies', valid: [{ cursor: 'next', jql: 'project = CS' }, { credentials: false, account: 'example' }], invalid: [{ cursor: 'next' }, { credentials: false }] },
  { name: 'local references', valid: [{ issue: { key: 'CS-303', summary: 'Example' } }], invalid: [{ issue: { key: 'CS-303' } }] },
  { name: 'dynamic recursion', valid: [{ name: 'root', children: [{ name: 'child' }] }], invalid: [{ name: 'root', children: [{}] }, { name: 'root', extra: true }] },
  { name: 'defaults', valid: [{ limit: 10 }], invalid: [{}] },
];
assert.equal(schemas.length, cases.length, 'Add behavior cases when adding documentation examples.');
const configuration = schema => ({ version: 1, tools: [{ name: 'documentation_example', description: 'Schema documentation verification', inputSchema: schema, outputSchema: schema, execution: { type: 'cli', command: process.execPath } }] });
let checks = 0;
for (const [index, schema] of schemas.entries()) {
  // Compile through the actual configuration loader as well as testing data.
  // No HTTP calls or CLI commands are executed.
  await prepareConfig(configuration(schema), root, {});
  const check = newValidator().compile(schema);
  const example = cases[index];
  for (const [expected, inputs] of [[true, example.valid], [false, example.invalid]]) {
    for (const input of inputs) {
      const original = structuredClone(input);
      assert.equal(check(input), expected, `${example.name}: ${JSON.stringify(check.errors)}`);
      assert.deepEqual(input, original, `${example.name} must not modify data.`);
      checks++;
    }
  }
}

// Verify the compatibility notes rather than assuming the standard's full support.
const unsupported = [
  { $anchor: 'example' }, { $async: true }, { $async: false },
  { properties: { item: { type: ['string', 'number'] } } },
  { discriminator: { propertyName: 'kind' } }, { example: {} },
  { 'x-custom': true }, { id: 'legacy' }, { $recursiveAnchor: true },
  { properties: { list: { type: 'array', additionalItems: false } } },
  { properties: { list: { type: 'array', items: [{ type: 'string' }] } } },
  { properties: { field: { type: 'string', format: 'idn-email' } } },
  { properties: { field: { type: 'number', maximum: { $data: '1/limit' } } } },
  { $ref: 'https://example.com/schema.json' }, { $ref: '#/$defs/missing' },
  { properties: { list: { type: 'array', minContains: 1 } } },
  { properties: { field: { type: 'string' } }, patternProperties: { '^field$': { type: 'string' } } },
];
for (const patch of unsupported) {
  await assert.rejects(() => prepareConfig(configuration({ type: 'object', ...patch }), root, {}), undefined, JSON.stringify(patch));
  checks++;
}
const supported = [
  { properties: { field: { type: 'string', nullable: true } } },
  { definitions: { field: { type: 'string' } }, properties: { field: { $ref: '#/definitions/field' } } },
  { properties: { a: { type: 'string' }, b: { type: 'string' } }, dependencies: { a: ['b'] } },
  { $vocabulary: { 'https://example.com/vocabulary': true } },
  { properties: { secret: { type: 'string', writeOnly: true }, generated: { type: 'string', readOnly: true }, blob: { type: 'string', contentEncoding: 'base64', contentMediaType: 'application/json', contentSchema: { type: 'object' } } } },
];
for (const patch of supported) {
  await prepareConfig(configuration({ type: 'object', ...patch }), root, {});
  checks++;
}
const annotations = newValidator().compile({ type: 'object', ...supported.at(-1) });
const data = { secret: 'visible', generated: 'accepted', blob: 'not base64 or JSON' };
assert(annotations(data));
assert.deepEqual(data, { secret: 'visible', generated: 'accepted', blob: 'not base64 or JSON' });
console.log(`JSON Schema documentation verified: ${schemas.length} examples in both languages, ${checks} behavior/compatibility checks, ${keywords.size} keywords and ${Object.keys(validator.formats).length} formats covered.`);
