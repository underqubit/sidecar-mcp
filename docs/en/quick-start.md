# Quick start

[Back to index](README.md) · [Español](../inicio-rapido.md)

## Requirements

- Node.js 24 or later and npm.
- An MCP client that can start processes over stdio or connect using Streamable HTTP.
- For CLI tools: the executable or interpreter installed on the machine running the server.
- For HTTP tools: access from that machine to the API and, when applicable, its OAuth2 endpoint.

A CLI tool runs on the MCP server host. If MCP is deployed remotely, it does not run commands on the client's computer.

## Install and build

```sh
npm ci
npm run build
node dist/cli.js --help
```

`npm ci` uses the versions in `package-lock.json`. The build generates JavaScript, type declarations, and source maps in `dist/`, including the response worker.

## Try it without external APIs

```sh
node dist/cli.js validate --config examples/cli.yaml
node dist/cli.js serve --config examples/cli.yaml
```

Validation reports two valid tools on stderr. `serve` waits for MCP messages over stdio; it is not an interactive command console.

The example exposes:

| Tool | Arguments | Result |
| --- | --- | --- |
| `local_node_version` | `{}` | An object with `version`, obtained by running `node --version` and parsing it with a regex. |
| `local_echo` | `{"message":"hello"}` | `{"message":"hello"}`, returned by a Node process that receives JSON on stdin. |

The exact Node version depends on the local installation.

## Test with MCP Inspector

The Inspector lets you discover and invoke tools through a web interface. From the project root, with dependencies installed, run:

```sh
npm run build
npx -y @modelcontextprotocol/inspector node dist/cli.js -- \
  serve --config examples/cli.yaml --transport stdio
```

The `--` separator passes subsequent arguments to the server. It is needed because the Inspector also recognizes `--config` and `--transport`: without the separator, it could interpret the tools YAML as its own client configuration. See the [official Inspector argument reference](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/configuration#the--separator).

The Inspector starts the server as a child process over stdio; you do not need to run `serve` in another terminal first. `npx` obtains the Inspector, which then runs the project's local build. Sidecar does not need to be published on npm.

1. Open the complete URL printed by the Inspector, including its session token.
2. Connect to the server through the interface and open **Tools**.
3. List the tools and invoke `local_node_version` with `{}` or `local_echo` with `{"message":"hello"}`.
4. Check the structured result: the second tool should return `{"message":"hello"}`.

The printed URL provides access to the Inspector session; use it in full instead of typing only the host and port. See the [official web interface guide](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/web).

### Test REST API tools with `.env`

Create `.env` from `.env.example` and set `API_BASE_URL` and `API_TOKEN` to your actual service values, as described in [Load environment variables](#load-environment-variables). Then run:

```sh
npx -y @modelcontextprotocol/inspector node -- \
  --env-file=.env dist/cli.js \
  serve --config examples/http.yaml --transport stdio
```

In this command, `--env-file` is passed to Node before the JavaScript file. `--transport stdio` controls the Inspector-to-MCP connection and overrides the HTTP transport declared in the example. The `api_get_user` tool still calls the REST API through Axios; test it with an argument such as `{"id":"42"}` that matches the configured service.

After changing code, rebuild. After changing configuration or variables, restart the server connection/process from the Inspector to load the new values.

## Connect a client over stdio

For clients that use a `mcpServers` object, the configuration looks like this. Replace the paths with absolute paths to your installation; other clients may require a different structure.

```json
{
  "mcpServers": {
    "underqubit": {
      "command": "node",
      "args": [
        "/path/to/underqubit-sidecar-mcp/dist/cli.js",
        "serve",
        "--config",
        "/path/to/underqubit-sidecar-mcp/examples/cli.yaml"
      ]
    }
  }
}
```

The client starts the process and discovers its tools. Ask it to call `local_echo` with `message: hello`. The expected structured content is:

```json
{"message":"hello"}
```

If a graphical application cannot find `node`, use the executable's absolute path. A graphical application's PATH may differ from the terminal's PATH.

## Connect over HTTP

```sh
node dist/cli.js serve --config examples/cli.yaml --transport http
```

The process reports its endpoint on stderr. With the defaults, it is `http://127.0.0.1:3000/mcp`. Configure that URL as a **Streamable HTTP** server in the MCP client.

HTTP does not serve a web page or a REST API for tools. Discovery and invocation use MCP. Opening the URL in a browser is not equivalent to calling a tool.

`--transport` overrides `server.transport`. Each process starts a single transport. See [Operations](operations-and-troubleshooting.md) before exposing the endpoint outside localhost.

## Load environment variables

The project does not load `.env` files automatically. Node lets you load them explicitly:

```sh
cp .env.example .env
```

Edit `.env` with your actual service values, then run:

```sh
node --env-file=.env dist/cli.js validate --config examples/http.yaml
node --env-file=.env dist/cli.js serve --config examples/http.yaml
```

`--env-file` is a Node option and goes before `dist/cli.js`. `validate` checks that variables exist; it does not check whether credentials work or call the remote service.

To use `.env` from a stdio client, add `--env-file=/absolute/path/.env` as the first Node argument, before the JavaScript file. You can also supply variables through the environment the client assigns to the process.

## Command reference

| Command | Effect |
| --- | --- |
| `node dist/cli.js --help` | Displays help and exits. Also accepts `-h`. |
| `node dist/cli.js validate --config file.yaml` | Validates and exits without running tools. |
| `node dist/cli.js serve --config file.yaml` | Serves the configured transport; stdio if omitted. |
| `node dist/cli.js serve --config file.json --transport http` | Forces HTTP for this run. |
| `npm start -- serve --config examples/cli.yaml` | Terminal shortcut; requires a previous build. |
| `npm run dev -- serve --config examples/cli.yaml` | Builds and runs with source maps. Does not watch for changes. |

For stdio clients, invoke `node` directly as shown above: npm script messages must not mix with the protocol channel.

`--config` is required and has no default path. Supported file extensions are `.json`, `.yaml`, and `.yml`. Startup or validation errors exit with code `1`; successful validation exits with `0`.

## Add your first integration

1. Choose a specific API or CLI operation.
2. Declare its arguments and result using JSON Schema.
3. Map the arguments in `execution`.
4. Choose a parser and, if needed, a transformation in `response`.
5. Run `validate`, start the server, and test it with an MCP client.
6. Restart the process after changing configuration or variables.

Continue with [Configuration](configuration.md), [HTTP tools](tools-http.md), or [CLI tools](tools-cli.md).

## Multiple integration files

Use [tool groups](tool-groups.md) to load several files in one process. The examples require no API credentials:

```sh
node dist/cli.js validate --config examples/composition.json
node dist/cli.js serve --config examples/composition.json
```

The JSON example exposes a unified stdio catalog. For HTTP with both the full catalog and separate group endpoints, run `node dist/cli.js serve --config examples/composition.yaml`. The guide includes Inspector connections and expected tool names. `--transport` changes transport, not publication mode; only `unified` supports stdio.
