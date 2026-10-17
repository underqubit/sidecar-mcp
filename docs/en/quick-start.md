# Quick start

[Español](../inicio-rapido.md) · [Back to index](README.md)

This guide installs the package published on npm in a working directory and uses the examples it includes. To run the server from the repository, see [From source](#from-source).

## Requirements

- Node.js 24 or later, with npm, pnpm, or Yarn.
- An MCP client that can start processes over stdio or connect using Streamable HTTP.
- For CLI tools: the executable or interpreter installed on the machine running the server.
- For HTTP tools: access from that machine to the API and, when applicable, its OAuth2 endpoint.

A CLI tool runs on the MCP server host. If MCP is deployed remotely, it does not run commands on the client's computer.

## Install

```sh
mkdir sidecar && cd sidecar
npm init -y
npm install @underqubit/sidecar-mcp
npx @underqubit/sidecar-mcp --help
```

With pnpm, use `pnpm add @underqubit/sidecar-mcp` and `pnpm exec underqubit-sidecar-mcp --help`. With Yarn, use `yarn add @underqubit/sidecar-mcp` and `yarn underqubit-sidecar-mcp --help`; on Yarn 2 or later, first set `nodeLinker: node-modules` in `.yarnrc.yml` (see [Installation](README.md#installation)).

Installing the package in a project pins its version in the lockfile and places the examples in `node_modules/@underqubit/sidecar-mcp/examples/`. You can also run it without installing, with `npx -y @underqubit/sidecar-mcp` or `pnpm dlx @underqubit/sidecar-mcp`; in that case, `--config` must point to your own file.

The commands in this guide use npm and run from the `sidecar` directory. With another package manager, replace `npx @underqubit/sidecar-mcp` according to the [installation table](README.md#installation).

## Try it without external APIs

```sh
npx @underqubit/sidecar-mcp validate --config node_modules/@underqubit/sidecar-mcp/examples/cli.yaml
npx @underqubit/sidecar-mcp serve --config node_modules/@underqubit/sidecar-mcp/examples/cli.yaml
```

Validation reports two valid tools on stderr. `serve` waits for MCP messages over stdio; it is not an interactive command console.

The example exposes:

| Tool | Arguments | Result |
| --- | --- | --- |
| `local_node_version` | `{}` | An object with `version`, obtained by running `node --version` and parsing it with a regex. |
| `local_echo` | `{"message":"hello"}` | `{"message":"hello"}`, returned by a Node process that receives JSON on stdin. |

The exact Node version depends on the local installation. To use the example as a starting point, copy `cli.yaml` together with `echo.mjs`: relative paths in a CLI tool resolve from the configuration file's directory.

## Test with MCP Inspector

The Inspector lets you discover and invoke tools through a web interface. From the `sidecar` directory, run:

```sh
npx -y @modelcontextprotocol/inspector node node_modules/@underqubit/sidecar-mcp/dist/cli.js -- \
  serve --config node_modules/@underqubit/sidecar-mcp/examples/cli.yaml --transport stdio
```

The Inspector uses Node to start the package's CLI, the same file the `underqubit-sidecar-mcp` command runs. The `--` separator passes subsequent arguments to the server. It is needed because the Inspector also recognizes `--config` and `--transport`: without the separator, it could interpret the tools YAML as its own client configuration. See the [official Inspector argument reference](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/configuration#the--separator).

The Inspector starts the server as a child process over stdio; you do not need to run `serve` in another terminal first.

1. Open the complete URL printed by the Inspector, including its session token.
2. Connect to the server through the interface and open **Tools**.
3. List the tools and invoke `local_node_version` with `{}` or `local_echo` with `{"message":"hello"}`.
4. Check the structured result: the second tool should return `{"message":"hello"}`.

The printed URL provides access to the Inspector session; use it in full instead of typing only the host and port. See the [official web interface guide](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/web).

### Test REST API tools with `.env`

Create `.env` in the `sidecar` directory with the variables the HTTP example uses and your actual service values:

```dotenv
API_BASE_URL=https://api.example.com
API_TOKEN=replace-me
```

Then run:

```sh
npx -y @modelcontextprotocol/inspector node -- \
  --env-file=.env node_modules/@underqubit/sidecar-mcp/dist/cli.js \
  serve --config node_modules/@underqubit/sidecar-mcp/examples/http.yaml --transport stdio
```

In this command, `--env-file` is passed to Node before the JavaScript file. `--transport stdio` controls the Inspector-to-MCP connection and overrides the HTTP transport declared in the example. The `api_get_user` tool still calls the REST API through Axios; test it with an argument such as `{"id":"42"}` that matches the configured service.

After changing configuration or variables, restart the server connection/process from the Inspector to load the new values.

## Connect a client over stdio

In stdio mode, the MCP client starts the server process and assigns it the environment variables declared in the client configuration. This is how you pass the credentials the configuration references with `${env.VARIABLE}`, without `.env` files.

### Claude Desktop

Edit `claude_desktop_config.json` (on macOS, in `~/Library/Application Support/Claude/`; on Windows, in `%APPDATA%\Claude\`) and restart the application:

```json
{
  "mcpServers": {
    "underqubit": {
      "command": "npx",
      "args": [
        "-y",
        "@underqubit/sidecar-mcp@{{version}}",
        "serve",
        "--config",
        "/absolute/path/config.yaml"
      ],
      "env": {
        "API_BASE_URL": "https://api.example.com",
        "API_TOKEN": "replace-me"
      }
    }
  }
}
```

Other clients that use a `mcpServers` object accept the same structure; some may require a different format.

### Claude Code

```sh
claude mcp add --transport stdio \
  --env API_BASE_URL=https://api.example.com \
  --env API_TOKEN=replace-me \
  underqubit -- npx -y @underqubit/sidecar-mcp@{{version}} serve --config /absolute/path/config.yaml
```

To share the configuration in a project without writing secrets, declare it in `.mcp.json` and reference variables from the environment of whoever runs Claude Code:

```json
{
  "mcpServers": {
    "underqubit": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@underqubit/sidecar-mcp@{{version}}", "serve", "--config", "/absolute/path/config.yaml"],
      "env": {
        "API_BASE_URL": "${API_BASE_URL}",
        "API_TOKEN": "${API_TOKEN}"
      }
    }
  }
}
```

### Environment variables from the client

- **stdio only.** Over HTTP, the client connects to a process that is already running; whoever starts that process sets its variables: the shell, the service supervisor, or Node with `--env-file`.
- **Read at startup.** After changing a value, restart the server from the client or restart the application.
- **Values are stored in plain text** in the client's configuration file. Do not commit files containing real tokens; in `.mcp.json`, use `${VARIABLE}` references.
- **A missing or empty referenced variable prevents startup.** The client shows the MCP server as failed; the `[config] Required environment variable: ...` message appears in its logs.

### Test the connection

To test without credentials, point `--config` to the `node_modules/@underqubit/sidecar-mcp/examples/cli.yaml` example in the `sidecar` directory, using an absolute path, and omit `env`. The client starts the process and discovers its tools. Ask it to call `local_echo` with `message: hello`. The expected structured content is:

```json
{"message":"hello"}
```

Specifying the version (`@{{version}}`) makes the client always start the same version; without it, npx may use the latest published one. The first startup downloads the package and may take longer. With pnpm, use `"command": "pnpm"` and `"args": ["dlx", "@underqubit/sidecar-mcp@{{version}}", "serve", "--config", "..."]`.

To load a `.env` file instead of declaring variables in the client, see [Load environment variables](#load-environment-variables). If a graphical application cannot find `npx` or `node`, use the executable's absolute path: a graphical application's PATH may differ from the terminal's PATH.

## Connect over HTTP

```sh
npx @underqubit/sidecar-mcp serve \
  --config node_modules/@underqubit/sidecar-mcp/examples/cli.yaml --transport http
```

The process reports its endpoint on stderr. With the defaults, it is `http://127.0.0.1:3000/mcp`. Configure that URL as a **Streamable HTTP** server in the MCP client.

HTTP does not serve a web page or a REST API for tools. Discovery and invocation use MCP. Opening the URL in a browser is not equivalent to calling a tool.

`--transport` overrides `server.transport`. Each process starts a single transport. See [Operations](operations-and-troubleshooting.md) before exposing the endpoint outside localhost.

## Load environment variables

The package does not load `.env` files automatically. `--env-file` is a Node option: it cannot be passed through `npx`, `pnpm exec`, or `yarn`, and Node does not accept it in `NODE_OPTIONS`. There are two alternatives:

- Run the installed package's CLI with Node:

  ```sh
  node --env-file=.env node_modules/@underqubit/sidecar-mcp/dist/cli.js \
    validate --config node_modules/@underqubit/sidecar-mcp/examples/http.yaml
  node --env-file=.env node_modules/@underqubit/sidecar-mcp/dist/cli.js \
    serve --config node_modules/@underqubit/sidecar-mcp/examples/http.yaml
  ```

  In a stdio client, use `"command": "node"` with `--env-file=/absolute/path/.env` as the first argument, before the absolute path to `dist/cli.js`.
- Set the variables in the process environment: in the shell, the service supervisor, or the MCP client's `env` block.

`validate` checks that variables exist; it does not check whether credentials work or call the remote service.

## Command reference

| Command | Effect |
| --- | --- |
| `npx @underqubit/sidecar-mcp --help` | Displays help and exits. Also accepts `-h`. |
| `npx @underqubit/sidecar-mcp validate --config file.yaml` | Validates and exits without running tools. |
| `npx @underqubit/sidecar-mcp serve --config file.yaml` | Serves the configured transport; stdio if omitted. |
| `npx @underqubit/sidecar-mcp serve --config file.json --transport http` | Forces HTTP for this run. |

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
npx @underqubit/sidecar-mcp validate --config node_modules/@underqubit/sidecar-mcp/examples/composition.json
npx @underqubit/sidecar-mcp serve --config node_modules/@underqubit/sidecar-mcp/examples/composition.json
```

The JSON example exposes a unified stdio catalog. For HTTP with both the full catalog and separate group endpoints, use `composition.yaml` from the same directory. The guide includes Inspector connections and expected tool names. `--transport` changes transport, not publication mode; only `unified` supports stdio.

## From source

To contribute or test unreleased changes, from a repository checkout:

```sh
npm ci
npm run build
node dist/cli.js validate --config examples/cli.yaml
```

The other guides use this form: `node dist/cli.js` with examples in `examples/`. `npm start -- serve --config examples/cli.yaml` and `npm run dev -- serve --config examples/cli.yaml` are terminal shortcuts; for stdio clients, invoke `node` directly so npm messages do not mix with the protocol channel. See [Development](development.md).
