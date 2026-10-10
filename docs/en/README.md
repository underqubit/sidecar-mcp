# Underqubit Sidecar MCP documentation

[Español](../README.md)

Underqubit Sidecar MCP exposes MCP tools from a YAML or JSON file. Each tool validates its arguments, performs an HTTP request or runs a local CLI, structures the response, and checks it against the output schema.

The configuration file defines the integration: adding a tool does not require changing TypeScript. Changes take effect when the server restarts.

## Guides

| Document | What it covers |
| --- | --- |
| [Quick start](quick-start.md) | Installation, first run, client connections, and available commands. |
| [Configuration](configuration.md) | Common fields, JSON Schema, variables, templates, defaults, and limits. |
| [HTTP tools](tools-http.md) | Mapping arguments to a REST API using Axios. |
| [CLI tools](tools-cli.md) | Executables, arguments, stdin, environment, paths, and exit codes. |
| [Authentication](authentication.md) | API keys, Bearer, Basic, OAuth2, and CLI credentials. |
| [Responses](responses.md) | JSON/text/regex parsers, JSONata transformations, and MCP responses. |
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

This documentation describes configuration format `version: 1` and the implementation in this repository. It does not assume the package is published on npm: commands use the local build in `dist/`.

Run all commands from the project root unless stated otherwise. Blocks labeled **fragment** belong inside a complete configuration; they are not standalone executable files. URLs using `example.com` and `example.org` represent services you must replace.

The source of truth for fields is [src/config-schema.ts](../../src/config-schema.ts). Rules that require additional logic—references, URLs, environment variables, and parser compilation—are in [src/config.ts](../../src/config.ts).
