# Developer guide

[Back to index](README.md) · [Architecture](architecture.md) · [Español](../desarrollo.md)

## Prepare the environment

```sh
npm ci
npm run check
```

Node.js 24 or later is required. The project uses npm with a lockfile, strict TypeScript, ESM modules, and `NodeNext` resolution. Internal imports written in TypeScript use the `.js` extension, matching the compiled files.

`dist/` is generated; do not edit it directly. The worker is loaded using a URL relative to `response.js`, so a distribution must include `dist/response-worker.js` and its dependencies.

## Structure

```text
src/                    Server and worker code
examples/               Usable configurations and example CLI
schema/                 Generated configuration JSON Schema
scripts/                Schema generator
tests/                  Tests without TCP listeners
tests/network/          Tests with local HTTP sockets
tests/fixtures/         Deterministic CLIs and configurations
evaluations/            Tool-use evaluation questions
docs/                   Spanish user and developer documentation
docs/en/                English user and developer documentation
.github/workflows/      GitHub Actions checks
```

See [Architecture](architecture.md) for the module responsibility map.

## Development commands

| Script | What it runs |
| --- | --- |
| `npm run build` | Compiles `src/` with `tsconfig.build.json` to `dist/`, with declarations and source maps. |
| `npm run typecheck` | Builds and checks types in sources, tests, and Vitest configuration without emitting those tests. |
| `npm start -- serve --config examples/cli.yaml` | Runs the existing build. |
| `npm run dev -- serve --config examples/cli.yaml` | Builds and runs with `--enable-source-maps`. No watch mode. |
| `npm test` | Builds and runs `tests/*.test.ts`. |
| `npm run test:network` | Builds and runs `tests/network/*.test.ts`. |
| `npm run check` | Build, typecheck, and the suite without TCP. |
| `npm run schema` | Builds and regenerates `schema/config.schema.json` from Zod. |

For an MCP stdio client, start `node dist/cli.js` directly. npm scripts are useful in a terminal, but their messages may contaminate stdout when used as a protocol command.

No lint, formatting, or coverage scripts are currently configured. Do not assume they are included in `check`.

## Tests

Tests import `dist/` to verify the same build delivered to users. Build again before running Vitest directly after changes.

```sh
npm run build
node_modules/.bin/vitest run tests/config.test.ts tests/mcp.test.ts
```

| Suite | Main coverage |
| --- | --- |
| [config.test.ts](../../tests/config.test.ts) | YAML/JSON, defaults, references, schemas, variables, invalid regex/JSONata, and templates. |
| [cli.test.ts](../../tests/cli.test.ts) | Literal arguments, stdin, environment, exit codes, limits, cancellation, and processes. |
| [http.test.ts](../../tests/http.test.ts) | Axios with Nock: URLs, query, headers, bodies, errors, and authentication. |
| [response.test.ts](../../tests/response.test.ts) | Parsers, regex groups, JSONata, timeouts, bytes, and worker cancellation. |
| [mcp.test.ts](../../tests/mcp.test.ts) | Real stdio client and in-memory Streamable HTTP, exposed schemas, guards, and request sizes. |
| [evaluation.test.ts](../../tests/evaluation.test.ts) | Answers verified through MCP tools over fixed data. |
| [http.network.test.ts](../../tests/network/http.network.test.ts) | Local API and OAuth endpoint using real sockets. |
| [mcp.network.test.ts](../../tests/network/mcp.network.test.ts) | Real HTTP listener, independent clients, Host/Origin, paths, and limits. |

The suite without TCP still needs permission to run local processes and workers. The network suite needs permission to open loopback ports; `listen EPERM` indicates an environment restriction. Do not treat that failure as a passing test or assume the in-memory suite replaces all socket integration coverage.

None of these suites requires real credentials or calls public APIs. Use fixtures and intercepted/local endpoints for new cases. Tests should verify observable behavior, especially failures and cancellation effects.

## Add a tool without changing code

1. Create or edit a configuration with schemas, `execution`, and `response`.
2. Reuse an auth profile when appropriate.
3. Validate with `node dist/cli.js validate --config <file>`.
4. Test discovery and invocation from an MCP client.
5. Restart to apply changes.

TypeScript development is needed only if the required behavior is missing from the available adapters, parsers, or authentication methods.

## Change the configuration format

1. Modify [config-schema.ts](../../src/config-schema.ts), preserving discriminated unions and inferred types.
2. Add semantic checks in `prepareConfig` where Zod is insufficient: profiles, references, URLs, or template restrictions.
3. Apply the field in the module that consumes it; validating a field does not automatically resolve or execute it.
4. Add acceptance/rejection cases and behavior tests.
5. Run `npm run schema` and update [Configuration](configuration.md), its [Spanish version](../configuracion.md), and affected examples.

The generated JSON Schema describes structure and defaults. Some rules—for example, whether an environment variable exists—are checked only at load time. Do not edit the generated artifact as the primary source.

For an incompatible change, explicitly review the format `version` and migration strategy. Currently only `version: 1` is accepted, and there are no automatic migrations.

## Extend executors, authentication, or responses

| Change | Places to modify | Behavior to preserve |
| --- | --- | --- |
| New executor | `executionSchema` union, types, adapter, and runtime dispatch | Validated input, cancellation, byte limits, `RawResponse`, and safe errors. |
| New auth profile | `authSchema` union, `AuthManager`, and configuration validation | Secrets from the environment, credential-free messages, and cancellation. |
| New parser | Parser union, prevalidation, and response processing | Matching validate/serve semantics, limits, and final validation. |
| Transport change | `mcp.ts`, lifecycle, and client tests | Shared tool registration, HTTP guards, and resource cleanup. |

A new executor must return `{text, metadata}` rather than build MCP responses itself. Keep common output validation, logging, and error conversion in the runtime.

The direct and worker response paths must remain consistent. If a parser can block on adversarial input, consider the same terminable isolation used for regex/JSONata. A worker's `resourceLimits` do not turn the entire process into a sandbox.

## Errors and logging

Use `SidecarError(stage, message)` for expected failures with client-safe messages. Do not copy Axios `error.message`, authentication bodies, or CLI stderr without reviewing their contents. `safeError` replaces unknown errors with a generic message. Keep source comments, diagnostics, and example tool descriptions in English.

The logger receives a `LogEvent` and writes one JSON line to stderr by default. A logger can be injected into the `Runtime` constructor, as the tests do. Do not add `console.log` to paths executed during MCP stdio.

Validation rejected by the SDK before reaching the runtime may not produce a tool `LogEvent`. CLI/SDK diagnostics do not necessarily use the runtime's JSON format either.

## Tool-use evaluations

[questions.xml](../../evaluations/questions.xml) contains ten independent questions about a fixed operations dataset. The [evaluation.yaml](../../tests/fixtures/evaluation.yaml) configuration exposes one tool to list projects and another to retrieve each project's metrics.

```sh
node dist/cli.js serve --config tests/fixtures/evaluation.yaml
```

The automated test verifies expected answers using MCP calls and calculations over their results. It does not measure a model's ability to choose tools. To evaluate an agent, connect it to that configuration and compare its answers with the XML using your evaluation environment. The repository contains no external model runner and requires no provider keys for its tests.

## CI and change verification

[ci.yml](../../.github/workflows/ci.yml) configures GitHub Actions on Ubuntu and Node 24 to run:

1. Reproducible installation with `npm ci`.
2. `npm run check`.
3. `npm run test:network`.
4. Schema regeneration and a Git diff check.

The workflow runs once the repository is on GitHub and Actions is enabled; the file's existence does not mean a remote run has already passed.

Before delivering a change, run affected suites, check the generated schema if Zod changed, and update the corresponding guides in both languages. For documentation-only changes, validating links and examples is usually more useful than repeating the entire functional suite.

## Distribution

The manifest declares an `underqubit-sidecar-mcp` binary pointing to `dist/cli.js`, but the package has `private: true`; npm publishing is not configured. Documented usage is from a compiled checkout.

For a service installation, build with development dependencies and retain Node, production dependencies, `dist/`, configuration, and referenced executables/scripts at runtime. Copying `dist/cli.js` alone is insufficient.
