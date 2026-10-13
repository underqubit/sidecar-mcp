# Multiple tool groups in one process

[Español](../grupos-de-tools.md) · [Back to index](README.md)

A composition loads existing integration files and exposes them from one Node.js process. Each group retains its tools, authentication profiles, referenced environment variables, execution limits, and relative paths. There is no need to merge files or rename their tools.

## Choose how to expose them

| `mode` | Transport | HTTP endpoints | Tool names |
| --- | --- | --- | --- |
| `unified` | stdio or HTTP | `/mcp` | `<group>.<original-name>` |
| `separate` | HTTP | `/mcp/<group>` | Original name within each group |
| `both` | HTTP | `/mcp` and `/mcp/<group>` | Prefixes only at `/mcp` |

The unified catalog exposes one MCP connection. Prefixes identify groups, but clients do not necessarily display folders or sections. Separate endpoints are added as distinct client connections, although they share a process and port.

In `both` mode, connecting the full catalog and one of its groups to the same client exposes those operations twice. Choose the connections you need.

## Main configuration

Runnable example from the repository root, without external credentials: [composition.yaml](../../examples/composition.yaml).

```yaml
# yaml-language-server: $schema=../schema/config.schema.json
version: 1
kind: composition
server:
  name: underqubit
  transport: http
  http:
    host: 127.0.0.1
    port: 3000
mode: both
groups:
  - id: local
    config: ./cli.yaml
  - id: echo
    config: ./cli.json
```

`version`, `kind`, `mode`, and a nonempty `groups` array are required. Each group contains only `id` and `config`. IDs must be unique, between 1 and 126 characters, and contain lowercase ASCII letters, digits, `_`, or `-`. Paths are literal: no variable interpolation or globbing.

`server` accepts `name`, `version`, `transport`, and `http`, with the same defaults as an integration: name `underqubit-sidecar-mcp`, version `0.1.0`, transport `stdio`, and HTTP at `127.0.0.1:3000`. A composition does not accept `timeoutMs` or `maxOutputBytes`: these belong to each integration. For `separate` or `both`, select HTTP in the file or pass `--transport http`.

`config` paths resolve relative to the main file. Within each integration, relative `command` and `cwd` paths still resolve against that integration's file. Nested compositions are not supported. Each file has a 4 MiB limit and the existing YAML/JSON restrictions.

The unified server takes its identity from the main file. Each separate endpoint uses its group ID as its MCP name and its integration's `server.version` as its version. The integrations' names, transports, and HTTP options do not start additional listeners.

Unified names always include the prefix: a tool named `jira_get_issue` in group `jira` is exposed as `jira.jira_get_issue`. Existing prefixes are not removed. The final name cannot exceed 128 characters; this check applies in every mode. Tools and authentication profiles may share names across groups, but tool names within an integration must remain unique.

## Run and connect Inspector

```sh
npm run build
node dist/cli.js validate --config examples/composition.yaml
node dist/cli.js serve --config examples/composition.yaml
```

The last command starts one listener and reports these endpoints on stderr:

```text
http://127.0.0.1:3000/mcp
http://127.0.0.1:3000/mcp/local
http://127.0.0.1:3000/mcp/echo
```

In another terminal, start Inspector:

```sh
npx -y @modelcontextprotocol/inspector
```

Open the URL printed by Inspector, select **Streamable HTTP**, and connect to an endpoint. At `/mcp`, call `echo.local_echo` with `{"message":"hello"}`. At `/mcp/echo`, call `local_echo` with the same arguments. Both calls return `{"message":"hello"}`. `/mcp/local` also offers `local_node_version`.

For stdio, use the [unified JSON example](../../examples/composition.json):

```sh
node dist/cli.js validate --config examples/composition.json
npx -y @modelcontextprotocol/inspector node -- \
  dist/cli.js serve --config examples/composition.json --transport stdio
```

Inspector starts the stdio process; do not start it separately. If integrations need `.env`, insert `--env-file=.env` before `dist/cli.js`. For clients launched from another directory, use absolute paths to the executable, CLI, configuration, and `.env`.

`--transport` overrides the main file's transport in both `serve` and `validate`. It does not change `mode`: `both` and `separate` fail with stdio. To migrate an existing integration, reference it from `groups`; running it directly still preserves its original names and `/mcp` endpoint.

## Credentials, operation, and troubleshooting

Each group has its own snapshot of referenced variables and its own authentication manager. In `both` mode, the unified catalog and the group endpoint use the same group runtime and share its OAuth cache. There are no global profiles or per-group environment overrides: reference different variable names in each file when credentials must differ. Node loads `.env`; the project does not load it automatically.

All files are validated before opening the listener. A missing file, missing required variable, or invalid integration aborts the entire startup and identifies the group. `validate` checks the composition and its integrations without calling APIs or executing tools. There is no hot reload: restart after changing configuration or credentials.

Call logs contain `group` and the original tool name. Limits and cancellation apply within each runtime; process shutdown cancels operations in all groups and closes all endpoints.

| Symptom | Check |
| --- | --- |
| `requires HTTP` | Use HTTP transport or change `mode` to `unified`. |
| `Duplicate group` | Assign unique IDs in `groups`. |
| `Group …` at startup | Fix that integration's file or environment variables. |
| HTTP 404 | Check the mode and exact path; there are no per-tool endpoints or trailing-slash redirects. |
| Tool not found | Use the prefix at `/mcp`; use the original name at `/mcp/<group>`. |
| No tool folders appear | Presentation depends on the client; use separate connections to distinguish servers. |

Host, Origin, and request-size checks use the main `server.http` settings for every endpoint. There is no incoming authentication or per-group authorization. Groups share the process and system resources; they are not a security boundary. Before exposing them outside localhost, see [HTTP operations](operations-and-troubleshooting.md).
