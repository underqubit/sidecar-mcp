# Configuration reference

[Back to index](README.md) · [Español](../configuracion.md)

## Format and validation

The server loads a YAML or JSON integration file, or a composition referencing multiple integration files. Each file is limited to 4 MiB. Files are not merged and there is no hot reload. See [Tool groups](tool-groups.md) for the composition format and its three publication modes. YAML rejects duplicate keys and aliases. Configuration blocks are strict: an unknown key is an error, except inside input/output JSON Schema documents.

Zod validates the configuration file and applies its defaults. AJV validates tool schemas and data. These are separate layers: configuration defaults are applied; a `default` inside `inputSchema` does not automatically fill in a missing argument.

For editor assistance, add the following comment to a YAML file located, for example, in `examples/`:

```yaml
# yaml-language-server: $schema=../schema/config.schema.json
```

In JSON, you can declare `"$schema": "../schema/config.schema.json"`. Adjust the path to the file's location. The generated schema helps the editor but does not replace the semantic checks performed by `validate`.

## Integration root

| Field | Type | Required / default |
| --- | --- | --- |
| `version` | Integer literal `1` | Required; configuration format version, not MCP protocol version. |
| `$schema` | String | Optional; editor reference. |
| `server` | Object | Optional; applies the defaults in the next section. |
| `auth` | Map of profiles by name | Optional; `{}`. See [Authentication](authentication.md). |
| `tools` | List of tools | Required; at least one. |

## Server

| Field in `server` | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | Nonempty string | `underqubit-sidecar-mcp` | Identity exposed to the MCP client. |
| `version` | Nonempty string | `0.1.0` | Exposed server version. |
| `transport` | `stdio` or `http` | `stdio` | Can be overridden with `--transport`. |
| `timeoutMs` | Positive integer | `30000` | Execution deadline per tool, unless overridden. |
| `maxOutputBytes` | Positive integer | `1048576` | Byte limit per tool, unless overridden. |
| `http` | Object | Defaults below | Used only when serving over HTTP. |

| Field in `server.http` | Default | Meaning |
| --- | --- | --- |
| `host` | `127.0.0.1` | Listening interface. |
| `port` | `3000` | Integer from 0 to 65535; `0` asks the system for an available port. |
| `allowedHosts` | `[127.0.0.1, localhost, '[::1]']` | Accepted hostnames without ports. These are not patterns or IP ranges. |
| `allowedOrigins` | `[]` | Allowed full origins, matched exactly. Requests without Origin can proceed. |
| `maxRequestBytes` | `1048576` | Maximum incoming MCP HTTP body size. |

A standalone integration uses `/mcp`. Compositions can also publish `/mcp/<group>` depending on their mode. There are no CLI flags to change the host or port; edit the file. `allowedHosts` does not authenticate users. See [HTTP operations](operations-and-troubleshooting.md).

HTTP server **fragment**:

```yaml
server:
  transport: http
  timeoutMs: 30000
  http:
    host: 127.0.0.1
    port: 3000
    allowedHosts: [localhost, 127.0.0.1, mcp.example.com]
    allowedOrigins: [https://console.example.com]
```

## Tool

| Field | Requirement |
| --- | --- |
| `name` | Unique within the server, 1–128 characters, pattern `^[A-Za-z0-9_.-]{1,128}$`. Case-sensitive. |
| `description` | Nonempty string; explain what it does, when to use it, and what it returns. |
| `title` | Optional nonempty string. |
| `inputSchema` | JSON Schema with root `type: object`. Required. |
| `outputSchema` | JSON Schema with root `type: object`. Required. |
| `annotations` | Optional MCP hints object. |
| `execution` | Object with `type: http` or `type: cli`. Required. |
| `response` | Optional object; defaults to a JSON parser and a 1000 ms worker budget. |

`annotations` accepts only `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`, all optional booleans. They are not inferred from the HTTP method or command. They inform the client but do not constrain execution.

Tools are exposed sorted by name. Only the name, description, title, annotations, and schemas form part of the MCP definition; `execution` and authentication profiles are not exposed as arguments.

## Input and output JSON Schema

The server uses draft 2020-12 with AJV in strict mode and formats from `ajv-formats`. Internal references such as `#/$defs/user` and standard combinations supported by that validator are allowed. Remote schemas are not downloaded, and asynchronous `$async` validators are not supported.

Input **fragment**:

```yaml
inputSchema:
  type: object
  properties:
    id:
      type: string
      minLength: 1
      description: User identifier.
    limit:
      type: integer
      minimum: 1
      maximum: 100
  required: [id, limit]
  additionalProperties: false
```

The client must send a number for `limit`: `"10"` is not converted to `10`. Extra properties are not removed. An output array at the root must be wrapped, for example, in `{"items": [...]}`.

For a tool without arguments, use `type: object` and `additionalProperties: false`. The client sends `{}`.

**Fragment** with a local reference:

```yaml
outputSchema:
  type: object
  properties:
    user: { $ref: '#/$defs/user' }
  required: [user]
  additionalProperties: false
  $defs:
    user:
      type: object
      properties: { id: { type: string }, name: { type: string } }
      required: [id, name]
      additionalProperties: false
```

`$defs` belongs to the schema containing the reference; there is no global schema registry across tools. Property names and literal data in `const`, `default`, or `examples` may contain fields called `$ref` or `$async`: these are not interpreted as keywords outside schema positions.

## Templates

| Syntax | Source | Example |
| --- | --- | --- |
| `${input.field}` | Validated call arguments | `${input.user.id}` |
| `${input.list.0}` | Array element | `${input.tags.0}` |
| `${env.VARIABLE}` | Process environment at startup | `${env.API_TOKEN}` |

A reference occupying the entire value preserves its original type. Inside a larger string, strings, booleans, and finite numbers are converted to text. Objects, arrays, and `null` cannot be interpolated into text.

HTTP **fragment**:

```yaml
body:
  enabled: '${input.enabled}'
  metadata: '${input.metadata}'
headers:
  X-Request-Label: 'user-${input.id}'
```

If `enabled` is `false`, the boolean is sent, not the string `"false"`. If `metadata` is an object, it remains an object.

Templates are resolved recursively in object and array values, but not in their keys. Received values are not evaluated again as templates. This syntax has no filters, conditionals, defaults, or JavaScript expressions. No escape is defined for including a literal `${...}` sequence in a configuration template field.

Paths use dots, not JSONPath or brackets. They cannot access inherited properties or the segments `__proto__`, `prototype`, or `constructor`. Use conventional environment variable names such as `SERVICE_TOKEN`.

### Where templates are resolved

| Field | `${input...}` | `${env...}` |
| --- | --- | --- |
| HTTP: values in `pathParams`, `query`, `headers`, `body` | Yes | Yes |
| HTTP: `baseUrl` | No | Yes |
| HTTP: `path` | No; use `{name}` with `pathParams` | No |
| CLI: `args`, values in `env`, `stdin` | Yes | Yes |
| CLI: `command`, `cwd` | No | Yes |
| Auth: secrets and `tokenUrl` | No | Yes |
| Auth: profile name, API key `name`, `scopes`, type/method selectors | No | No; declare literal values |
| `server`, schemas, descriptions, regex, and JSONata | No | No |

Although the loader inspects execution and auth strings for references, only the listed fields are resolved at runtime. Do not use templates in `execution.auth`, header names, or other static selectors.

Referenced variables are checked at startup, even in unused auth profiles. Missing or empty strings cause an error. To rotate them, update the environment and restart. A missing optional argument is not automatically replaced: if referenced during execution, the tool fails with an unavailable reference.

## Precedence and limits

| Parameter | Rule |
| --- | --- |
| Transport | `--transport` → `server.transport` → `stdio`. |
| Tool timeout | `execution.timeoutMs` → `server.timeoutMs` → 30000 ms. |
| Tool limit | `execution.maxOutputBytes` → `server.maxOutputBytes` → 1 MiB. |
| OAuth timeout | `auth.<profile>.timeoutMs` → 10000 ms; also subject to cancellation by its consumers. |
| Worker timeout | `response.workerTimeoutMs` → 1000 ms; the tool deadline can also cancel it. |
| Incoming MCP HTTP request | `server.http.maxRequestBytes` → 1 MiB; independent of the response limit. |

Configurable timeouts are integers from 1 to 2147483647 ms. Configurable byte limits are integers from 1 to 67108864 (64 MiB). `0` cannot disable these limits.

For HTTP, the tool limit applies to the outgoing body, captured response, and final JSON. For CLI, it limits stdin, combined captured stdout and stderr, and final JSON. Exceeding a limit returns an error; a response is never truncated and presented as successful.

The deadline starts after input validation and covers auth, execution, and processing. Cancellation in the main process is cooperative; regex and JSONata have their own terminable worker. This does not isolate all synchronous validation and serialization in a process with a strict deadline.
