# CLI tools: adapt a local executable

[Español](../tools-cli.md) · [Back to index](README.md) · [Common configuration](configuration.md)

A CLI tool starts a process, sends arguments and stdin, captures stdout, and processes its result. It works with existing programs; when a CLI supports JSON output, using it usually simplifies mapping.

## `execution` reference

| Field | Type / default | Purpose |
| --- | --- | --- |
| `type` | Literal `cli` | Selects the adapter. |
| `command` | Required string | Fixed executable or one from the environment; never from input. |
| `args` | String list, `[]` | Each element is resolved as one argument. |
| `cwd` | Configuration file directory | Fixed working directory or one from the environment. |
| `env` | String map, `{}` | Explicit child process variables. |
| `stdin` | JSON value, omitted | Literal string or JSON serialization of another value. |
| `successExitCodes` | `[0]` | Nonempty list of integers from 0 to 255. |
| `timeoutMs` | Inherited from server | Tool deadline. |
| `maxOutputBytes` | Inherited from server | Limit for stdin, captured output, and result. |

## Complete runnable example

Save as `local.yaml` in the project root. It uses the existing example script at `examples/echo.mjs`.

```yaml
version: 1
tools:
  - name: local_message
    description: Receives a message and returns it through a local example CLI.
    inputSchema:
      type: object
      properties:
        message: { type: string, maxLength: 1024 }
      required: [message]
      additionalProperties: false
    outputSchema:
      type: object
      properties:
        message: { type: string }
      required: [message]
      additionalProperties: false
    annotations:
      readOnlyHint: true
      destructiveHint: false
      idempotentHint: true
      openWorldHint: false
    execution:
      type: cli
      command: node
      args: [examples/echo.mjs]
      cwd: .
      stdin:
        message: '${input.message}'
    response:
      parser: { type: json }
```

```sh
node dist/cli.js validate --config local.yaml
node dist/cli.js serve --config local.yaml
```

From an MCP client, calling `local_message` with `{"message":"hello"}` returns `{"message":"hello"}`. To try it without creating a new file, use [examples/cli.yaml](../../examples/cli.yaml) or [examples/cli.json](../../examples/cli.json).

## Arguments and shell

The adapter uses `spawn(command, args, {shell: false})`. A string such as `"hello world"` is one argument and should not include extra quotes to protect spaces.

**Fragment** for an existing CLI:

```yaml
execution:
  type: cli
  command: service-cli
  args: [users, get, '${input.id}', --output, json]
```

Do not put the entire command line in `command: 'service-cli users get ...'`: the adapter would look for an executable with that full name. There is no automatic expansion of `~`, globbing, pipes, redirection, `$HOME`, or `$(...)` substitution.

A numeric or boolean reference in `args` is converted to a string. Objects and arrays do not expand into multiple arguments. If the program needs structured JSON, use stdin or an appropriate argument contract.

For scripts, declare an interpreter and pass the path as an argument: `command: node`, `args: [script.mjs]`. Configuration is trusted: explicitly configuring an interpreter that executes code retains that interpreter's permissions and capabilities.

## Directories and executable lookup

| Value | Resolution |
| --- | --- |
| `command: node` | Look up in PATH. |
| `command: ./bin/tool` | Relative to the configuration file directory. |
| Absolute path in `command` | Preserved as an absolute path on the corresponding platform. |
| `cwd` omitted | Configuration file directory. |
| `cwd: ../workspace` | Relative to the configuration file. |
| Path inside `args` | Interpreted by the CLI from its `cwd`. |

Moving a YAML file from `examples/` to the root may therefore require adjusting paths. The file name passed to `--config` is resolved from the directory where Node starts.

On Windows, declare executables compatible with shell-free `spawn` or the corresponding interpreter. The implementation does not offer a `shell: true` mode for `.cmd`/`.bat` scripts.

## Environment and credentials

Only these variables are inherited from the server when present: `PATH`, `SystemRoot`, `WINDIR`, `TMPDIR`, `TEMP`, `TMP`, and `LANG`. `execution.env` is added afterward and can override them.

**Fragment**:

```yaml
env:
  SERVICE_TOKEN: '${env.SERVICE_TOKEN}'
  HOME: '${env.HOME}'
  SERVICE_PROFILE: production
```

`HOME` is not inherited by default. If the CLI reads credentials or configuration from the user's home directory, declare it explicitly. Server environment variables used in templates are captured at startup; basic inherited variables are read when creating the process.

The CLI adapter does not use `execution.auth`: authentication is delegated to the program through environment variables or stdin. See [Authentication](authentication.md).

## Stdin, stdout, and stderr

If `stdin` is a string, it is sent unchanged without an added newline. To include one, use a YAML string with `\n` or a literal block. Objects, arrays, numbers, booleans, and `null` are serialized as JSON. When omitted, stdin closes without sending data.

The process must exit to produce an MCP result. This is not an interactive terminal or a TTY session.

The complete stdout is interpreted as UTF-8 and passed to the parser. If the program writes banners or logs before JSON, the JSON parser fails; configure quiet/JSON mode or choose an appropriate parser. Stderr is drained and counted toward the capture limit but discarded: it is not added to the result or logs.

An exit code outside `successExitCodes`, or termination by signal, causes an error before parsing. If nonzero codes are accepted, a valid parser/schema must also exist for their output.

## Cancellation and limits

A timeout, MCP cancellation, server shutdown, or excessive output requests SIGTERM. On POSIX, the signal targets the tool's process group and escalates to SIGKILL after 250 ms if needed. On Windows, the direct process is terminated; terminating independent descendants is not guaranteed. A process that detaches from its group on POSIX is likewise not isolated by the server.

The limit adds the bytes received on stdout and stderr. Stdin has its own check using the same configured value. The final JSON result is checked again. Partial captured output is not returned as a successful result.

To structure text output, continue with [Responses](responses.md).
