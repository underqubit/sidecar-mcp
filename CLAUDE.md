# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Underqubit Sidecar MCP is a Node.js 24+ / TypeScript (strict, NodeNext ESM) MCP server that exposes REST APIs and local CLIs as MCP tools declared in a YAML/JSON file. Adding a tool is a configuration change, not a code change. `AGENTS.md` holds the shared repository guidelines; the essentials are repeated here.

## Commands

```sh
npm ci                     # install (lockfile)
npm run build              # tsc -> dist/ (includes dist/response-worker.js)
npm run check              # build + typecheck (src, tests, vitest configs) + tests/*.test.ts
npm run test:network       # tests/network/*.test.ts; needs loopback port access
npm run schema             # regenerate schema/config.schema.json from Zod (CI fails on drift)
npm run check:package      # pack the real tarball, install it in a temp consumer, smoke-test it
npm run docs:check-schema  # verify JSON Schema guide examples/coverage in both languages
npm run docs:build         # regenerate docs/html and validate links/anchors
node dist/cli.js validate --config examples/cli.yaml
node dist/cli.js serve --config examples/cli.yaml [--transport http]
```

Tests import `../dist/*.js`, not `src/`: always rebuild before running Vitest directly.

```sh
npm run build && node_modules/.bin/vitest run tests/config.test.ts -t "test name"
npm run build && node_modules/.bin/vitest run --config vitest.network.config.ts tests/network/mcp.network.test.ts
```

No linter, formatter, or coverage threshold is configured. For MCP stdio clients run `node dist/cli.js` directly: npm script output would corrupt the protocol on stdout.

## Architecture

Request flow, which spans several modules:

1. **Load** (`cli.ts` -> `composition.ts:loadDeployment` -> `config.ts`). A file is either an integration (`version: 1`, `tools`) or a composition (`kind: composition`, `groups`, `mode: unified|separate|both`) that references integration files. `config-schema.ts` (Zod) is the source of truth for the config format and its defaults. `prepareConfig` then does what Zod cannot: compiles tool JSON Schemas with AJV (draft 2020-12, `strict`, no coercion/defaults/removal), rejects remote `$ref`/`$async`, validates URLs and auth references, snapshots **only referenced** `${env.X}` variables (missing or empty means startup error), resolves CLI `command`/`cwd` relative to the config file, and pre-compiles regex/JSONata in the worker. Startup is all-or-nothing.
2. **Serve** (`composition.ts`, `mcp.ts`). `Application` owns one `Runtime` per group and a map of endpoint paths to `ToolCatalog` views. Views only rename and dispatch: unified names are `<group>.<tool>` on `/mcp`, separate endpoints are `/mcp/<group>`. Both views share the group's runtime and OAuth cache. `mcp.ts` registers tools with the MCP SDK through a `fromJsonSchema` AJV bridge, serves stdio or Streamable HTTP, and guards HTTP twice: the fetch handler checks Host/Origin/path, and the `node:http` listener re-validates the raw Host header and caps the body size.
3. **Call** (`runtime.ts`). Validate input, create a deadline, and combine abort signals (deadline + global shutdown + caller). `templates.ts` resolves `${input.x}`/`${env.X}`; a whole-value reference keeps its type, while interpolation inside a string stringifies scalars only. `executors.ts` runs Axios (no redirects, no env proxy, byte limits) or `spawn` (`shell: false`, minimal inherited env, POSIX process-group kill with SIGKILL escalation). Executors return `RawResponse {text, metadata}` and never build MCP results themselves.
4. **Respond** (`response.ts`, `response-worker.ts`). JSON/text parsers without a transform run inline. Regex or JSONata runs in a terminable `Worker` with `env: {}` and resource limits. The runtime then validates `outputSchema`, checks the final byte size, and returns `structuredContent` plus a JSON text copy.
5. **Errors** (`errors.ts`). Expected failures are `SidecarError(stage, safeMessage)` and become `isError: true` results tagged with the stage (`[input]`, `[auth]`, `[execution]`, `[parse]`, `[transform]`, `[output]`, ...). Unknown errors go through `safeError`, which returns a generic message. Never surface upstream bodies, stderr, or secrets.

`auth.ts` (`AuthManager`) caches OAuth2 client-credentials tokens in memory per profile. Concurrent callers share one pending fetch, which is aborted only when every consumer cancels. Secrets must be full `${env.X}` references.

Invariants to preserve:
- stdout belongs to the MCP protocol in stdio mode; logs (JSON lines) and diagnostics go to stderr.
- Templates resolve only in specific fields (see `docs/configuracion.md`, "Dónde se resuelven").
- The default `server.version` is read from `package.json` (`config-schema.ts:packageVersion`, via `../package.json` relative to `dist/`).
- After changing Zod schemas, run `npm run schema` and update the configuration docs in both languages.

`scripts/openapi*-to-config.mjs` are offline Swagger 2 / OpenAPI 3.x converters that share `scripts/lib/openapi-*.mjs`. They emit a normal integration file and do not change the runtime.

## Documentation system

- Spanish guides are in `docs/*.md` and their English counterparts in `docs/en/*.md`. Every change must update both languages.
- `docs/site/pages.json` lists the guide pairs. `pages` sets the HTML navigation order. `markdownOnly` pairs (npm publishing, documentation site) get no HTML, and links to them point to the Markdown source. `scripts/build-docs.mjs` fails if a `.md` file is registered in neither list.
- `{{version}}` in rendered guides is replaced with the `package.json` version; any other `{{...}}` placeholder fails the build.
- `docs/html/` is generated and committed: never edit it by hand, regenerate it with `npm run docs:build`. Styles and the logo live in `docs/site/assets/`.
- The JSON code blocks in `docs/json-schema.md` and `docs/en/json-schema.md` must stay identical, and their count must match the behavior cases in `scripts/check-json-schema-docs.mjs`.
- Links to repository files resolve to GitHub only when `DOCS_REPOSITORY_URL` or `GITHUB_REPOSITORY` is set (as in Actions); local builds keep filesystem paths.

## Gotchas

- Node 24's `fetch` silently replaces a custom `Host` header. Tests that forge `Host` must use `node:http` (see `statusWithHost` in `tests/network/mcp.network.test.ts`).
- `listen EPERM` in network tests is an environment restriction. Report it; never treat blocked tests as passing.
- Under Yarn Plug'n'Play the response worker cannot resolve `jsonata`, so `validate` fails. The supported setups are npm, pnpm, and Yarn with `nodeLinker: node-modules`.

## Conventions

- Code, comments, error messages, and example tool descriptions are in English. Style is two-space indentation, single quotes, semicolons, and `.js` extensions on local imports.
- Commits follow conventional prefixes (`feat:`, `fix:`, `docs:`, `refactor:`). Do not add "Co-Authored-By" lines.
- Tests use Nock, fixtures, and local processes; never use live services or real credentials.
