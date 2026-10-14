# Underqubit Sidecar MCP documentation

[Español](../README.md)

Underqubit Sidecar MCP exposes MCP tools from a YAML or JSON file. Each tool validates its arguments, performs an HTTP request or runs a local CLI, structures the response, and checks it against the output schema.

The configuration file defines the integration: adding a tool does not require changing TypeScript. Changes take effect when the server restarts.

Sidecar MCP is developed by [Underqubit](https://underqubit.com).

## Installation

The `underqubit-sidecar-mcp` package is published on npm, requires Node.js 24 or later, and installs the `underqubit-sidecar-mcp` command. You can run it without installing it or add it to a project:

| Package manager | Run without installing | Install in a project | Run the installed version |
| --- | --- | --- | --- |
| npm | `npx -y underqubit-sidecar-mcp <command>` | `npm install underqubit-sidecar-mcp` | `npx underqubit-sidecar-mcp <command>` |
| pnpm | `pnpm dlx underqubit-sidecar-mcp <command>` | `pnpm add underqubit-sidecar-mcp` | `pnpm exec underqubit-sidecar-mcp <command>` |
| Yarn | Not supported | `yarn add underqubit-sidecar-mcp` | `yarn underqubit-sidecar-mcp <command>` |

`<command>` is `serve`, `validate`, or `--help`. For example:

```sh
npx -y underqubit-sidecar-mcp validate --config ./config.yaml
```

Yarn 2 or later requires `nodeLinker: node-modules` in `.yarnrc.yml`: with Plug'n'Play, the worker that processes regex and JSONata cannot load its dependencies, and configuration validation fails. For the same reason, `yarn dlx` is not supported. Yarn 1 installs into `node_modules` and needs no changes.

The [Quick start](quick-start.md) explains how to connect an MCP client, pin the version, load environment variables, and use the examples included in the package.

## Guides

| Document | What it covers |
| --- | --- |
| [Quick start](quick-start.md) | Installation, first run, client connections, and available commands. |
| [Configuration](configuration.md) | Common fields, JSON Schema, variables, templates, defaults, and limits. |
| [JSON Schema reference](json-schema.md) | Keywords, extra fields, formats, examples, and actual validator limitations. |
| [Tool groups](tool-groups.md) | Multiple files in one process, unified catalog, separate endpoints, and Inspector. |
| [HTTP tools](tools-http.md) | Mapping arguments to a REST API using Axios. |
| [CLI tools](tools-cli.md) | Executables, arguments, stdin, environment, paths, and exit codes. |
| [Authentication](authentication.md) | API keys, Bearer, Basic, OAuth2, and CLI credentials. |
| [Responses](responses.md) | JSON/text/regex parsers, JSONata transformations, and MCP responses. |
| [Import OpenAPI](openapi-import.md) | Generate integration files from Swagger 2.0 and OpenAPI 3.x. |
| [Architecture](architecture.md) | Modules, data flow, shared state, and cancellation. |
| [Development](development.md) | Development environment, tests, extensions, schema generation, and CI. |
| [Operations and troubleshooting](operations-and-troubleshooting.md) | HTTP deployment, logs, maintenance, errors, and limitations. |

## Where to start

**To use the server:** follow [Quick start](quick-start.md), choose [HTTP](tools-http.md) or [CLI](tools-cli.md), and configure [response processing](responses.md).

**To develop:** read [Architecture](architecture.md) and [Development](development.md). The [configuration reference](configuration.md) describes the contract to preserve when changing the code.

**To deploy or investigate a failure:** see [Operations and troubleshooting](operations-and-troubleshooting.md).

## Repository resources

| Resource | Purpose |
| --- | --- |
| [AI agent skill](../../skills/underqubit-sidecar-mcp/SKILL.md) | English instructions for using, configuring, and troubleshooting server integrations. |
| [YAML CLI example](../../examples/cli.yaml) | Two local tools with no external services or credentials. |
| [JSON CLI example](../../examples/cli.json) | A tool that receives and returns a message. |
| [HTTP example](../../examples/http.yaml) | User lookup with Bearer authentication and response transformation. |
| [Jira Cloud example](../../examples/jira.json) | Four read-only issue tools with authentication and pagination. See [Jira setup](tools-http.md#jira-cloud-example). |
| [Authentication example](../../examples/auth.yaml) | All supported profiles and a tool using OAuth2. |
| [Example variables](../../.env.example) | Variable names used by the HTTP examples. |
| [Configuration JSON Schema](../../schema/config.schema.json) | Editor completion and structural validation. |
| [Evaluations](../../evaluations/questions.xml) | Questions about a fixed dataset for evaluating tool use. |

## Scope of this documentation

This documentation describes configuration format `version: 1` of the package published on npm. The [Quick start](quick-start.md) uses the command installed by the package. The other guides show `node dist/cli.js`, the equivalent form from a source checkout; with the package installed, replace it with `npx underqubit-sidecar-mcp` (or `pnpm exec` / `yarn`, depending on the package manager). Examples those guides place in `examples/` are in `node_modules/underqubit-sidecar-mcp/examples/`, except the Jira example, which is only in the repository.

If a command uses `node --env-file=.env`, keep Node and change the executable path to `node_modules/underqubit-sidecar-mcp/dist/cli.js`; do not pass `--env-file` as a Sidecar option. See [Load environment variables](quick-start.md#load-environment-variables).

When reading Markdown directly, replace version placeholders in double braces with the version from `package.json` before copying a command. The HTML generator performs this substitution automatically.

Run commands with relative paths from the project root unless stated otherwise. Blocks labeled **fragment** belong inside a complete configuration; they are not standalone executable files. URLs using `example.com` and `example.org` represent services you must replace.

The source of truth for fields is [src/config-schema.ts](../../src/config-schema.ts). Rules that require additional logic—references, URLs, environment variables, and parser compilation—are in [src/config.ts](../../src/config.ts).
