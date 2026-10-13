# Operations and troubleshooting

[Back to index](README.md) · [Español](../operacion-y-diagnostico.md)

## Choose how to run the server

| Mode | Use | Who manages the process |
| --- | --- | --- |
| Stdio | Local integration with an MCP client | The client usually starts and stops Node. |
| Streamable HTTP | A process shared by network clients or behind a proxy | The operator or service supervisor. |

Each process serves one transport. To serve both simultaneously, start separate processes; each has its own OAuth cache and can run its own CLIs.

Configuration is assumed to be managed by a trusted operator. Commands run with the server user's permissions, and accepted HTTP clients access the same tool catalog. There are no built-in per-tool permissions, user accounts, rate limits, or concurrency quotas.

## Prepare a service deployment

1. Install Node 24 and the required CLIs on the server host.
2. Install dependencies and build with `npm ci` and `npm run build`.
3. Place configuration, scripts, and secrets where the process user can read them.
4. Run `validate` with the same environment the service will use.
5. Start Node using your chosen supervisor and configure restarts/logging there.

Example command, with paths to replace:

```sh
node --env-file=/path/to/sidecar/.env /path/to/sidecar/dist/cli.js serve \
  --config /path/to/sidecar/config.yaml --transport http
```

The supervisor's working directory need not be the project directory when using absolute paths. Relative CLI paths are resolved against the configuration file and its `cwd`, as explained in [CLI tools](tools-cli.md).

The repository does not install a system service or include a preconfigured Docker/Kubernetes deployment. The server does not automatically reload code or configuration.

## HTTP, proxies, and access controls

Defaults: listen on `127.0.0.1:3000`, path `/mcp`, local hosts allowed, and no explicit Origin allowed.

To expose the server behind a proxy:

- Keep loopback binding if the proxy and backend share a host. For another topology, configure the bind address and restrict direct backend access through the network.
- Terminate TLS and authenticate clients at the proxy. The MCP server does not validate incoming tokens.
- Configure `allowedHosts` with the hostnames the backend will actually receive. The request Host is checked; authorization is not inferred from `X-Forwarded-Host`.
- If clients send Origin, declare full values such as `https://console.example.com`. Scheme and port matter. Do not use wildcards.
- Preserve the method, body, and MCP headers. The protocol may use streaming; configure the proxy for the client's transport without assuming every exchange is a simple REST response.
- Set proxy timeouts and body limits consistently with the server's limits.

`allowedHosts` protects host selection and `allowedOrigins` restricts origins when present, but neither authenticates the client. An absent Origin is accepted; an empty, `null`, or unlisted Origin produces 403. The Origins list does not automatically enable CORS or browser preflight responses.

The server has a configurable incoming body limit (`maxRequestBytes`). The Node listener allows 30 seconds for receiving a request and 10 seconds for headers; these listener values are not the tool execution deadline and have no dedicated configuration fields.

There is no implemented `/health` route. To check functional availability, connect an MCP client and list tools; to check an integration, invoke an appropriate read-only tool.

## Changes and shutdown

Changing YAML/JSON, credentials, or schemas requires a restart. Validate first, then restart through the client/supervisor. Changing `outputSchema` can break consumers expecting the previous contract; update the integration name or version according to the needs of the system using it.

SIGINT and SIGTERM cancel active work and release resources. In stdio mode, closing stdin also initiates shutdown. In HTTP mode, shutdown ends calls, the handler, connections, and the listener; it does not drain indefinitely while allowing every job to finish.

On POSIX, shutdown attempts to terminate each canceled CLI's process group, escalating to SIGKILL. Review descendant limitations in [CLI tools](tools-cli.md).

## Logs

The runtime emits JSON lines to stderr, for example:

```json
{"tool":"users_get","durationMs":123,"ok":true}
```

```json
{"tool":"users_get","durationMs":30001,"ok":false,"stage":"execution"}
```

Arguments, bodies, CLI stdout/stderr, and credential values are not logged. Upstream output may contain sensitive data and become part of a successful result; restrict it through the transformation and schema.

Stderr may also contain plain-text startup, validation, and SDK messages. Collectors must not assume every line is JSON. Duration refers to each call reaching the runtime; not every protocol rejection generates a tool log.

To save diagnostics in a POSIX terminal:

```sh
node dist/cli.js serve --config examples/cli.yaml 2>sidecar.log
```

In stdio mode, do not merge stderr into stdout with `2>&1`, because stdout carries MCP. There is no built-in log rotation or metrics endpoint; manage these externally if needed.

## Troubleshooting by stage

| Stage / symptom | What to check |
| --- | --- |
| `[config]` at startup | Extension, valid YAML/JSON, unknown fields, version 1, nonempty tools, and unique names. |
| Required environment variable | Missing/empty variable, client/supervisor environment, placement of `--env-file`; also unused profiles. |
| Invalid/unsupported JSON Schema | Object root, correct types, internal references, and strict AJV validator restrictions. |
| Invalid regex/JSONata | Syntax, named groups, flags, and worker compilation budget. |
| `[input]` or SDK validation error | Required arguments, actual types, limits, and `additionalProperties`; schema defaults do not fill in data. |
| `[parameters]` | Unavailable reference, object where a scalar was expected, `.`/`..` path parameter, excessive stdin. |
| `[auth]` | OAuth endpoint, credentials, scopes, Basic/body method, and Bearer response contract. |
| HTTP 401/403 inside a tool error | Remote service credentials or authorization. A static Bearer token does not renew itself. |
| HTTP 301/302 inside a tool error | The service's final URL is required; redirects are not followed. |
| HTTP request failed | Connectivity, DNS/TLS, deadline, and byte limit. Outgoing proxies from the environment are not used. |
| Could not start executable | PATH, path, permissions, working directory, and available interpreter. |
| CLI exit code not accepted | Run the CLI directly with the same cwd/environment to see its diagnostics. The server does not return stderr. |
| `[parse]` | Empty body/stdout, malformed JSON, mixed-in logs, or no regex match in `first` mode. |
| `[transform]` | Missing fields, invalid conversions, missing result, timeout, or worker resources. |
| `[output]` | Incompatible final object, unwrapped root array, or excessive bytes after transformation. |

Generic messages avoid exposing service details or credentials. Reproducing the request/CLI with your own tools may be necessary to diagnose the upstream; do not automatically copy its complete output into shared logs.

## Transport troubleshooting

| Symptom | Interpretation and action |
| --- | --- |
| Stdio process with no text on screen | It may be working normally and waiting for an MCP client. |
| `Cannot find module .../dist/cli.js` or missing worker | Build and retain the complete `dist/` directory. |
| `node` or CLI not found from a graphical app | Check the process PATH or use an absolute executable path. |
| HTTP 403 from the MCP endpoint | Check Host/Origin and the proxy before investigating remote service auth. |
| HTTP 404 from the MCP endpoint | Use a route published by the configured mode: `/mcp` and/or `/mcp/<group>`. There are no routes named after tools. |
| HTTP 413 | The incoming body exceeds `server.http.maxRequestBytes` or the proxy limit. |
| HTTP 400/405 or negotiation failure | Use a Streamable HTTP client and valid MCP messages; do not invoke it as a REST endpoint. |
| Port already in use | Stop the previous process or change `server.http.port`. |
| `listen EPERM` in TCP tests | The environment prohibits opening sockets. Run the suite in a terminal/CI where this is allowed. |

The 18 network tests that depend on listeners were blocked by `EPERM` during local verification in this environment. The workflow includes them in CI, but they are not considered to have passed here. The in-memory suite verifies the protocol and guards without opening a port.

## Current functional limits

OpenAPI import is available through [offline generation scripts](openapi-import.md). There is no hot reload, executable TypeScript configuration, external Zod modules, multi-request workflows, automatic pagination, CSV/XML parsers, binary/multipart uploads, per-user OAuth login, per-tool authorization, or built-in incoming authentication.

Dynamic tools are dynamic **through configuration at startup**. Manually choosing their contracts and transformations is part of integrating an existing API or CLI.

See [Development](development.md) to add capabilities and [Configuration](configuration.md) for existing limits.

## Operating multiple groups

See [Tool groups](tool-groups.md) for `unified`, `separate`, and `both`. Start one process and use the endpoints printed on stderr. All routes share the main HTTP guards, port, and process lifetime; separate connections do not provide access control or failure isolation. Configure any incoming authorization in your trusted proxy for every exposed route, including `/mcp` if it exposes the full catalog.

Configuration is validated atomically at startup. A missing child file or required variable prevents all groups from starting. Restart to load changes; there is no hot reload. Call logs include `group` and the original tool name. Duplicate operations in a client usually mean it connected to both the unified and group-specific endpoints.
