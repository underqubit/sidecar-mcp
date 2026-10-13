# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the TypeScript MCP server: configuration and schemas, authentication, templates, HTTP/CLI executors, response processing, composition, and transports. `dist/` is generated JavaScript, including the response worker. Keep protocol handling separate from integration execution.

`tests/` holds Vitest suites and `fixtures/`; `tests/network/` covers real HTTP sockets. `examples/` contains integrations and OpenAPI samples. `scripts/` handles imports, packaging, schema generation, and documentation. Spanish guides live in `docs/`, English counterparts in `docs/en/`; website assets and navigation live in `docs/site/`. `skills/` contains agent usage instructions.

## Build, Test, and Development Commands

Use Node.js 24 or later and install with `npm ci`.

- `npm run build`: compile sources into `dist/`.
- `npm run dev -- serve --config examples/cli.yaml`: build and run locally with source maps; no watch mode.
- `npm run check`: build, typecheck, and run the default tests.
- `npm run test:network`: run socket integration tests; requires loopback port access.
- `npm run schema`: regenerate `schema/config.schema.json` after configuration changes.
- `npm run check:package`: verify the actual tarball and production installation.
- `npm run docs:check-schema`: verify documented schemas and validator coverage.
- `npm run docs:build`: generate HTML and check documentation links.

For MCP stdio clients, invoke `node dist/cli.js` directly; npm output can interfere with the protocol.

## Coding Style & Naming Conventions

Use English for code, comments, and errors. Follow existing two-space indentation, single quotes, and semicolons. TypeScript uses strict checking and NodeNext ESM; local imports use `.js` extensions. Use camelCase for functions/variables, PascalCase for types/classes, and descriptive lowercase filenames such as `response-worker.ts`. No formatter or linter is configured.

## Testing Guidelines

Name suites `*.test.ts`. Tests import `dist/`, so rebuild before running Vitest directly. Use Nock, fixtures, and local processes instead of live services or credentials. Cover observable behavior, failures, and cancellation where relevant. No coverage threshold is configured. Report environment restrictions such as `listen EPERM`; do not count blocked tests as passing.

## Commit & Pull Request Guidelines

History commonly uses `feat:` and `docs:` prefixes with descriptive subjects; follow that pattern. Keep commits focused. PRs should explain the problem, resulting behavior, validation performed, and limitations. Link relevant issues and include screenshots for documentation layout changes. Update both documentation languages and regenerate affected artifacts.

## Security & Configuration

Keep secrets in environment variables referenced as `${env.NAME}`. Never commit `.env`, tokens, or credential-bearing examples. Preserve strict configuration validation and keep diagnostics off protocol stdout.
