import { writeFile, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { configSchema } from '../dist/config-schema.js';

await mkdir(new URL('../schema/', import.meta.url), { recursive: true });
const schema = z.toJSONSchema(configSchema, { target: 'draft-2020-12', io: 'input' });
schema.title = 'Underqubit Sidecar MCP configuration';
await writeFile(new URL('../schema/config.schema.json', import.meta.url), `${JSON.stringify(schema, null, 2)}\n`);
