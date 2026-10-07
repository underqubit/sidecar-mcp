# Parsing, transformation, and MCP output

[Back to index](README.md) · [Español](../respuestas.md)

An API or CLI response goes through three steps: **parse the text**, **transform the data if JSONata is configured**, and **validate against `outputSchema`**. The schema describes the final result, which may differ from the original service response.

## `response` reference

| Field | Default | Purpose |
| --- | --- | --- |
| `parser` | `{type: json}` | Object discriminated by `type: json`, `text`, or `regex`. |
| `transform` | Omitted | JSONata expression; without it, parsed data is preserved. |
| `workerTimeoutMs` | `1000` | Worker budget when using regex or JSONata. |

A JSON/text parser without a transformation runs on the main thread. With regex or a transformation, parsing and transformation run in a worker.

## JSON

**Fragment**:

```yaml
response:
  parser: { type: json }
```

`JSON.parse` is applied to the entire text. An empty body, multiple independent JSON lines, a banner before JSON, or non-JSON text causes an error. Content-Type does not change the selected parser.

If the response is already an object compatible with `outputSchema`, no transformation is needed. Wrap a root list:

```yaml
response:
  parser: { type: json }
  transform: '{"items": data}'
```

## Text

The `text` parser preserves the entire string. Because `outputSchema` must have an object root, a tool using it usually needs to wrap the string.

**Fragment**:

```yaml
response:
  parser: { type: text }
  transform: '{"text": $trim(data)}'
outputSchema:
  type: object
  properties: { text: { type: string } }
  required: [text]
  additionalProperties: false
```

`$trim` is optional: omit it if spaces and newlines are part of the result you want to preserve.

## Regex with named groups

| `parser` field | Default / requirement |
| --- | --- |
| `type` | Literal `regex`. |
| `pattern` | Required string with named groups `(?<name>...)`. |
| `flags` | Empty string. Allowed flags: `i`, `m`, `s`, `u`, without duplicates. |
| `mode` | `first`; alternative: `all`. |

Do not add `g` to flags: it is added internally when `mode` is `all`. JavaScript RegExp syntax is used.

For the text `requests=120 errors=3`:

```yaml
response:
  parser:
    type: regex
    pattern: 'requests=(?<requests>\d+) errors=(?<errors>\d+)'
  transform: '{"requests": $number(data.requests), "errors": $number(data.errors)}'
outputSchema:
  type: object
  properties:
    requests: { type: integer }
    errors: { type: integer }
  required: [requests, errors]
  additionalProperties: false
```

Result: `{"requests":120,"errors":3}`. Before JSONata, groups are strings. In YAML, single quotes preserve regex backslashes; in JSON, write them as `"\\d+"` inside the JSON string.

In `first` mode, the first match is used, and finding no match is an error. In `all` mode, the result is an array of objects, and finding no matches returns `[]`.

For one item per line:

```yaml
response:
  parser:
    type: regex
    pattern: '^(?<name>\w+)=(?<count>\d+)$'
    flags: m
    mode: all
  transform: '{"items": [data.{"name": name, "count": $number(count)}]}'
```

With `cpu=2` and `memory=4` on separate lines, the result contains a list of two objects. Declare `outputSchema.properties.items` as an array of objects with `name: string` and `count: integer`.

## JSONata context

The expression's root document contains:

```json
{
  "data": {"id": 42, "name": "Ada"},
  "metadata": {"status": 200, "headers": {"content-type": "application/json"}}
}
```

| Source | Available metadata |
| --- | --- |
| HTTP | `status`, `headers."content-type"`, and `headers."retry-after"`, if those headers exist. |
| CLI | `exitCode`. |

Input, environment variables, auth profiles, cookies, and stderr are not included in the context. No registered functions access the filesystem or network. `${input...}` and `${env...}` are not interpolated in the expression.

Transformation recipes:

| Need | Expression |
| --- | --- |
| Select and normalize fields | `{"id": $string(data.id), "name": data.name}` |
| Preserve a list even with zero or one result | `{"users": [data.items.{"id": $string(id), "name": name}]}` |
| Filter a list | `{"active": [data.items[active = true]]}` |
| Include HTTP status | `{"result": data, "status": metadata.status}` |
| Convert a regex group | `{"count": $number(data.count)}` |
| Accept an empty response using the text parser | `{"ok": true}` |

Explicit brackets help preserve arrays in JSONata. Check zero, one, and multiple items because some selection expressions produce sequences or single values.

The expression must produce a JSON-serializable value. A missing result (`undefined`), evaluation failure, or invalid numeric conversion causes an error. After serialization, the final object is validated against `outputSchema`.

## MCP result

The runtime builds a successful response with structured content and a text copy of the same JSON. Example internal result, before any SDK compatibility adaptation:

```json
{
  "resultType": "complete",
  "content": [{"type": "text", "text": "{\"message\":\"hello\"}"}],
  "structuredContent": {"message": "hello"}
}
```

A tool failure returns `isError: true` and text containing a stage and a safe message, without successful `structuredContent`. Validation errors detected by the SDK may use its own error text.

## Budgets and limits

Each worker has an empty environment, a 64 MiB old-generation heap limit, and a 4 MiB stack. That heap limit is not a total memory limit for the entire process. The configured time includes worker startup and serialization; it also applies when compiling regex/JSONata during `validate`.

A worker exceeding its time or resource limits is terminated. The tool deadline can also cancel it. Regex/JSONata are compiled at startup to check syntax; that does not guarantee the transformation will work for every actual response.

The final JSON must fit within `maxOutputBytes`. The MCP response includes both its structured and textual forms, so the total transmitted size may exceed the size of that individual JSON value. Output is not truncated to force validation.

See [Operations and troubleshooting](operations-and-troubleshooting.md) for help with parsing and output errors.
