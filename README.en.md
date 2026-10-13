# Underqubit Sidecar MCP

[Español](README.md) · [English documentation](docs/en/README.md)

An MCP server built with Node.js 24 and TypeScript that turns existing REST APIs and CLIs into tools declared in YAML or JSON. Adding a tool requires no programming or recompilation: edit the configuration and restart the process.

Supports stdio and Streamable HTTP, service authentication, input/output JSON Schema, and response transformation with JSONata.

Complete documentation is available in [docs/en/README.md](docs/en/README.md): usage guides, configuration reference, authentication, responses, architecture, development, and operations.

For AI agents, the usage skill is available in [skills/underqubit-sidecar-mcp/SKILL.md](skills/underqubit-sidecar-mcp/SKILL.md).

Load multiple integration files in one process with [tool groups](docs/en/tool-groups.md): a unified catalog, separate HTTP servers, or both.

Generate integration files from Swagger 2.0 or OpenAPI 3.x with the [OpenAPI import scripts](docs/en/openapi-import.md).

## Quick start

```sh
npm ci
npm run build
node dist/cli.js validate --config examples/cli.yaml
node dist/cli.js serve --config examples/cli.yaml
```

The last command starts MCP over stdio: it waits for messages from an MCP client, not commands typed into the terminal. The example exposes `local_node_version` and `local_echo` without secrets or external services.

To test tools through a web interface, follow the [MCP Inspector guide](docs/en/quick-start.md#test-with-mcp-inspector), covering local examples and REST APIs using `.env`.

Configuration for an MCP client with stdio support (replace the paths):

```json
{
  "mcpServers": {
    "underqubit": {
      "command": "node",
      "args": [
        "/path/to/underqubit-sidecar-mcp/dist/cli.js",
        "serve", "--config", "/path/to/underqubit-sidecar-mcp/examples/cli.yaml"
      ]
    }
  }
}
```

For HTTP:

```sh
node dist/cli.js serve --config examples/cli.yaml --transport http
```

Default endpoint: `http://127.0.0.1:3000/mcp`. The HTTP transport is stateless and uses one MCP instance per request; the execution core and OAuth cache are shared. The SDK supports modern clients and clients using the MCP 2025 handshake.

## Configuration

The complete editor definition is in [schema/config.schema.json](schema/config.schema.json). YAML can include:

```yaml
# yaml-language-server: $schema=../schema/config.schema.json
version: 1
server:
  name: underqubit-sidecar-mcp
  version: 0.1.0
  transport: stdio
  timeoutMs: 30000
  maxOutputBytes: 1048576
  http:
    host: 127.0.0.1
    port: 3000
    allowedHosts: [127.0.0.1, localhost, '[::1]']
    allowedOrigins: []
    maxRequestBytes: 1048576
auth: {}
tools: [] # Replace with at least one tool.
```

`version: 1` identifies the configuration format. Unknown keys, duplicate names, invalid JSON Schemas, missing profiles, invalid expressions, and missing or empty environment variables are rejected. YAML does not allow aliases or duplicate keys. The maximum file size is 4 MiB.

`validate` performs the same checks as startup, including regex/JSONata compilation and variable presence. It does not run CLIs, call APIs, or obtain tokens. It does not check connectivity or whether an executable exists. There is no automatic reload.

### Tool contract

| Field | Description |
| --- | --- |
| `name` | Unique, 1–128 characters: ASCII letters, numbers, `_`, `-`, `.`. |
| `description` | Operation description visible to the model. Required. |
| `title` | Optional title for MCP clients. |
| `inputSchema` / `outputSchema` | JSON Schema 2020-12 with root `type: object`. Both required. |
| `annotations` | `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`; optional and informational. |
| `execution` | HTTP or CLI configuration. |
| `response` | Parser and optional transformation. Defaults to the JSON parser. |

Zod validates configuration; AJV validates each tool's input and output. JSON Schemas support `$defs` and internal `#...` references, but not remote references or asynchronous validators. Validation does not convert types, add defaults, or remove properties. Declare `additionalProperties: false` to reject extra fields.

### Templates

- `${input.field}` reads a tool argument; paths such as `${input.user.id}` and `${input.items.0}` are allowed.
- `${env.VARIABLE}` reads an environment variable referenced in configuration. It is captured at startup and not exposed to the model.
- A reference occupying the entire value preserves its type, including objects, lists, booleans, and numbers.
- Inside text (`user-${input.id}`), only strings, numbers, and booleans are allowed. Object keys are not interpolated.
- Missing references fail explicitly. There are no JavaScript expressions, recursive evaluation of received text, or shell substitutions.

Execution parameters and credentials support templates. Descriptions, JSON Schemas, regex, and JSONata expressions are not interpolated. The executable, directory, and HTTP origin do not accept input arguments.

## REST APIs with Axios

Complete example: [examples/http.yaml](examples/http.yaml).

```yaml
execution:
  type: http
  baseUrl: '${env.API_BASE_URL}'
  method: POST
  path: /users/{id}
  pathParams: { id: '${input.id}' }
  query: { active: true, tag: [a, b] }
  headers: { Accept: application/json }
  body: { name: '${input.name}', enabled: '${input.enabled}' }
  bodyEncoding: json
  auth: service
  timeoutMs: 10000
  maxOutputBytes: 1048576
```

- Methods: GET (default), POST, PUT, PATCH, DELETE, HEAD, and OPTIONS.
- `baseUrl` requires HTTP/HTTPS without credentials, query, or a fragment. A path starting with `/` begins at the root; a relative path is appended to the path in `baseUrl`.
- `{id}` is resolved from `pathParams` and encoded as a URL segment. The origin cannot change. Query parameters and forms accept scalars or lists of scalars; lists repeat the key, and `null` omits the parameter.
- `bodyEncoding`: `json`, `form` (URL-encoded), or `text`. The corresponding Content-Type is set. Multipart and binary files are not supported.
- `successStatuses` can replace the default 200–299 range, for example `[200, 201]`.
- No retries, redirects, or implicit outgoing proxy from the environment. TLS verification uses Node/Axios defaults.
- The byte limit also limits the outgoing body. The overall deadline includes obtaining credentials, execution, and response processing.

## Local CLIs

Complete examples: [examples/cli.yaml](examples/cli.yaml) and [examples/cli.json](examples/cli.json).

```yaml
execution:
  type: cli
  command: existing-cli
  args: [show, '${input.id}', --format, json]
  cwd: .
  env:
    SERVICE_TOKEN: '${env.SERVICE_TOKEN}'
  stdin:
    options: '${input.options}'
  successExitCodes: [0]
```

Execution uses `spawn` with `shell: false`. Each `args` element is a literal argument: spaces, quotes, and metacharacters do not create additional commands. Shell pipelines are not supported. The executable must be native or invoked through its interpreter, for example `node` followed by a script path.

`cwd` and executable paths containing separators are resolved relative to the configuration file. An executable name without separators is looked up in PATH. The CLI interprets paths in `args` using its `cwd`.

Only `PATH`, `SystemRoot`, `WINDIR`, `TMPDIR`, `TEMP`, `TMP`, and `LANG` are inherited; declare the rest in `env`. To use CLI credentials stored in the user's home directory, explicitly declare `HOME: '${env.HOME}'`. `stdin` is sent literally if it is a string or serialized as JSON otherwise, then closed.

Stdout feeds the parser. Stderr is drained and counts toward the combined byte limit but is neither returned nor logged: errors contain the exit code. Cancellation terminates the process and, on POSIX, its process group; after 250 ms it escalates from SIGTERM to SIGKILL. On Windows, the direct process is terminated; terminating independent descendants is not guaranteed.

## Authentication

Profiles are declared under `auth`, and each HTTP execution selects one by name. Omitting `auth` adds no credentials. The profile overrides a configured header or query parameter with the same name.

| Type | Fields |
| --- | --- |
| `none` | No additional fields. |
| `apiKey` | `in: header\|query`, `name`, `value: '${env.API_KEY}'`. |
| `bearer` | `token: '${env.API_TOKEN}'`. |
| `basic` | `username: '${env.API_USERNAME}'`, `password: '${env.API_PASSWORD}'`. |
| `oauth2` | `tokenUrl`, `clientId`, `clientSecret`, `scopes`, `tokenAuthMethod: basic\|body`, `timeoutMs`. |

Profile secrets require environment references, not literals. [examples/auth.yaml](examples/auth.yaml) shows every variant. CLIs receive credentials through `env` or `stdin`, using the authentication already supported by each program.

OAuth2 uses `grant_type=client_credentials`. It shares concurrent token requests, keeps an in-memory cache, and renews before `expires_in`. Without a valid expiry, the token is not cached. Only Bearer tokens are supported; the endpoint timeout defaults to 10 seconds. Tokens are not persisted, and per-user login is not implemented.

Node can load `.env` explicitly:

```sh
node --env-file=.env dist/cli.js validate --config examples/http.yaml
node --env-file=.env dist/cli.js serve --config examples/http.yaml
```

Use [.env.example](.env.example) as a reference. All referenced variables are checked, even in profiles not yet used by any tool.

## Parsing and transformation

```yaml
response:
  parser: { type: json }
  transform: '{"users": [data.items.{"id": $string(id), "name": name}]}'
  workerTimeoutMs: 1000
```

| Parser | Result before transformation |
| --- | --- |
| `json` | Parsed JSON; the default, including for HTTP. |
| `text` | Complete string. Example transformation: `{"text": $trim(data)}`. |
| `regex` | Named groups from the first match (`mode: first`) or a list of groups (`mode: all`). |

Regex uses `pattern`, optional `flags` (`i`, `m`, `s`, `u`), and `mode`. It requires named groups, for example `(?<name>\w+)=(?<count>\d+)`. In `first` mode, finding no match is an error; in `all`, it returns an empty list. Captured groups are strings: explicitly convert numbers with `$number(...)`.

JSONata receives `{data, metadata}`. For HTTP, metadata contains `status` and the `content-type`/`retry-after` headers; for CLI, `exitCode`. It does not receive arguments, credentials, environment variables, cookies, or stderr. Without `transform`, parsed data is validated directly.

MCP input and output have object roots. Wrap lists in `{"items": data}` or text in `{"text": data}` when needed. A missing JSONata result, parsing error, or `outputSchema` mismatch returns a tool error; data is not silently converted or truncated.

Regex and JSONata run in terminable workers with an empty environment, a default one-second budget, and a 64 MiB heap limit. No filesystem or network access functions are registered. The worker budget includes startup and serialization.

## Operations

Flow: **validate input → resolve parameters/credentials → execute → parse → transform → validate output → return MCP response**.

Successful responses include `structuredContent` and a text block containing the same JSON. Tool failures use `isError: true` and a stage (`input`, `parameters`, `auth`, `execution`, `parse`, `transform`, `output`). The SDK handles protocol errors.

JSON logs go to stderr: tool, duration, outcome, and error stage. Bodies, arguments, and credentials are not logged. Stdout is reserved for MCP in stdio mode. SIGINT, SIGTERM, and stdin closure cancel active work and release resources.

Configuration and CLIs are managed by a trusted operator. The server executes operations authorized by that configuration with the process user's permissions; it is not a sandbox for arbitrary programs.

HTTP listens on loopback by default. For external access, configure binding, `allowedHosts`, and a proxy that applies TLS/authentication and restricts direct backend access. The server implements neither incoming authentication nor its own user accounts. `allowedHosts` compares hostnames without ports; `allowedOrigins` compares full origins. Requests without Origin are valid; a present but empty or `null` Origin is rejected. The same checks apply to the fetch handler and Node server. CORS is not enabled automatically.

## Development and tests

```sh
npm run check          # build, typecheck, and the suite without TCP ports
npm run test:network   # integration with real HTTP servers on localhost
npm run schema        # regenerate the configuration JSON Schema
```

Tests run against `dist`, including the distributed worker. The default suite uses Axios with HTTP interceptors, a real MCP client over stdio, and Streamable HTTP through in-memory fetch. Separate TCP tests verify sockets, Host/Origin, and request limits and require permission to open ports. They do not call external services or require real credentials.

Modules in `src` separate configuration, templates, authentication, adapters, response processing, runtime, and transport. For configuration changes, update Zod and regenerate `schema/config.schema.json`.

[evaluations/questions.xml](evaluations/questions.xml) contains ten read-only questions about a fixed operations dataset. To evaluate an agent's tool use, connect it with `--config tests/fixtures/evaluation.yaml`. The suite verifies expected answers through real MCP calls; it does not run an external model evaluation or incur API costs.

Outside this version's scope: hot reload, OpenAPI import, per-user OAuth, multi-execution pipelines, CSV/XML, multipart, and binary files.

References: [MCP SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/), [JSON Schema](https://json-schema.org/draft/2020-12), [JSONata](https://docs.jsonata.org/overview), [Axios](https://axios-http.com/docs/req_config).

## npm distribution

The package is configured for public npm distribution. Once version `0.1.0` is published:

```sh
npx -y underqubit-sidecar-mcp@0.1.0 serve --config /absolute/path/config.yaml
```

See [npm publishing](docs/en/npm-publishing.md) for production installation, package verification, and release steps. Publication is a separate action.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

The [HTML documentation](docs/html/index.html) is available in Spanish and English. To rebuild it and configure GitHub Pages, see [HTML documentation site](docs/en/documentation-site.md).
