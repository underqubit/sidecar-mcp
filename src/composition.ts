import { dirname, resolve } from 'node:path';
import { compositionSchema, type CompositionConfig, type ServerConfig, type ToolConfig } from './config-schema.js';
import { prepareConfig, readConfigFile, type LoadedConfig } from './config.js';
import { SidecarError, safeError } from './errors.js';
import { Runtime, stderrLogger, type Logger, type ToolCatalog } from './runtime.js';
import type { Environment } from './templates.js';

export type LoadedDeployment =
  | { kind: 'single'; loaded: LoadedConfig }
  | { kind: 'composition'; config: CompositionConfig; groups: { id: string; loaded: LoadedConfig }[] };

function isComposition(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && 'kind' in raw && raw.kind === 'composition';
}

/** Validate the entire deployment before creating runtimes or opening a listener. */
export async function loadDeployment(file: string, env: Environment = process.env): Promise<LoadedDeployment> {
  const raw = await readConfigFile(file);
  const directory = dirname(resolve(file));
  if (!isComposition(raw)) return { kind: 'single', loaded: await prepareConfig(raw, directory, env) };
  const parsed = compositionSchema.safeParse(raw);
  if (!parsed.success) throw new SidecarError('config', `Invalid composition at: ${parsed.error.issues.map(i => i.path.join('.') || 'root').join(', ')}.`);
  const config = parsed.data;
  const ids = new Set<string>();
  for (const group of config.groups) {
    if (ids.has(group.id)) throw new SidecarError('config', `Duplicate group: ${group.id}.`);
    ids.add(group.id);
  }
  const groups: { id: string; loaded: LoadedConfig }[] = [];
  for (const group of config.groups) {
    try {
      const path = resolve(directory, group.config);
      const child = await readConfigFile(path);
      if (isComposition(child)) throw new SidecarError('config', 'Nested compositions are not supported.');
      const loaded = await prepareConfig(child, dirname(path), env);
      for (const tool of loaded.config.tools) {
        if (`${group.id}.${tool.name}`.length > 128) throw new SidecarError('config', `Prefixed tool name exceeds 128 characters: ${tool.name}.`);
      }
      groups.push({ id: group.id, loaded });
    } catch (error) {
      throw new SidecarError('config', `Group ${group.id}: ${safeError(error, 'config').message}`);
    }
  }
  return { kind: 'composition', config, groups };
}

export function deploymentTransport(loaded: LoadedDeployment, override?: 'stdio' | 'http'): 'stdio' | 'http' {
  const server = loaded.kind === 'single' ? loaded.loaded.config.server : loaded.config.server;
  const transport = override ?? server.transport;
  if (loaded.kind === 'composition' && loaded.config.mode !== 'unified' && transport === 'stdio') {
    throw new SidecarError('config', `Composition mode ${loaded.config.mode} requires HTTP. Use --transport http or mode unified.`);
  }
  return transport;
}

class Catalog implements ToolCatalog {
  readonly tools = new Map<string, { config: ToolConfig }>();
  private readonly routes = new Map<string, { runtime: Runtime; originalName: string }>();

  constructor(readonly identity: ToolCatalog['identity'], groups: { id?: string; runtime: Runtime }[]) {
    for (const { id, runtime } of groups) {
      for (const { config } of runtime.tools.values()) {
        const name = id === undefined ? config.name : `${id}.${config.name}`;
        this.tools.set(name, { config: { ...config, name } });
        this.routes.set(name, { runtime, originalName: config.name });
      }
    }
  }

  call: ToolCatalog['call'] = async (name, input, signal) => {
    const route = this.routes.get(name);
    if (!route) return { resultType: 'complete', isError: true, content: [{ type: 'text', text: '[input] Tool not found.' }] };
    return route.runtime.call(route.originalName, input, signal);
  };
}

/** Owns runtimes once, regardless of how many endpoint views expose them. */
export class Application {
  readonly server: ServerConfig;
  readonly endpoints = new Map<string, ToolCatalog>();
  readonly runtimes: readonly Runtime[];
  private closing?: Promise<void>;

  constructor(loaded: LoadedDeployment, log: Logger = stderrLogger) {
    if (loaded.kind === 'single') {
      const runtime = new Runtime(loaded.loaded, log);
      this.server = loaded.loaded.config.server;
      this.runtimes = [runtime];
      this.endpoints.set('/mcp', runtime);
      return;
    }
    this.server = loaded.config.server;
    const groups = loaded.groups.map(({ id, loaded: child }) => ({
      id, runtime: new Runtime(child, event => log({ ...event, group: id })),
    }));
    this.runtimes = groups.map(group => group.runtime);
    if (loaded.config.mode !== 'separate') this.endpoints.set('/mcp', new Catalog(this.server, groups));
    if (loaded.config.mode !== 'unified') {
      for (const { id, runtime } of groups) {
        this.endpoints.set(`/mcp/${id}`, new Catalog({ name: id, version: runtime.identity.version }, [{ runtime }]));
      }
    }
  }

  stdioCatalog(): ToolCatalog {
    const catalog = this.endpoints.get('/mcp');
    if (!catalog || this.endpoints.size !== 1) throw new SidecarError('config', 'Stdio requires a unified catalog.');
    return catalog;
  }

  close(): Promise<void> {
    return this.closing ??= (async () => { await Promise.all(this.runtimes.map(runtime => runtime.close())); })();
  }
}
