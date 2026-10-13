# JSON Schema reference for tools

[Español](../json-schema.md) · [Index](README.md) · [Configuration](configuration.md)

This guide explains JSON Schema draft 2020-12 keywords and how they work in this project's `inputSchema` and `outputSchema`. It includes the installed validator's extensions, options without validation effects, and incompatibilities. These keywords are separate from server configuration fields such as `execution`, `auth`, and `response`, documented in [Configuration](configuration.md).

## What is validated and when

| Layer | Validator | Behavior |
| --- | --- | --- |
| Configuration file | Zod | Checks structure and applies server, execution, and parser defaults. |
| `inputSchema` | AJV, before execution | Checks arguments from the MCP client. Invalid arguments prevent HTTP or CLI execution. |
| `outputSchema` | AJV, after parsing and JSONata | Checks the structured result. Failure returns an error; the request or CLI has already run. |

Both schemas must declare exactly `"type": "object"` at their root. Wrap an API array or scalar, for example as `{"items": [...]}`, using `response.transform`. JSON examples in this guide are **complete schemas to paste into `inputSchema` or `outputSchema`**, not complete configuration files.

Project rules live in [src/config.ts](../../src/config.ts), [src/config-schema.ts](../../src/config-schema.ts), and [src/runtime.ts](../../src/runtime.ts). AJV uses `strict: true`, `allErrors: true`, `ownProperties: true`, and `validateFormats: true`, with `ajv-formats`. `useDefaults`, `coerceTypes`, `removeAdditional`, `$data`, and `discriminator` are not enabled.

Validation therefore **does not transform data**: it does not convert `"10"` into `10`, insert `default` values, remove extra properties, or conceal passwords. Inherited JavaScript properties do not count. Configure output transformation separately; see [Responses](responses.md).

## How to read a schema

A schema combines conditions on the same value. `properties` describes fields without requiring them: `required` controls presence. String, number, object, and array constraints need the corresponding `type`, declared in that schema or a compatible enclosing context; strict AJV rejects ambiguous uses.

Subschema positions also accept `true` (any value), `false` (no value), and `{}` (no constraints). These cannot stand alone as a tool schema root, which requires `type: object`. For example, `properties: {"metadata": true, "obsolete": false}` allows any `metadata` value and forbids the presence of `obsolete`.

### Types, fixed values, and absence

| Keyword | Value | Rule and behavior when omitted |
| --- | --- | --- |
| `type` | `object`, `array`, `string`, `number`, `integer`, `boolean`, `null` | Restricts the type. Without it, JSON Schema imposes no type constraint; tool roots still require it. `integer` accepts numbers without a fractional part, including `1.0`. |
| `enum` | Nonempty array of distinct values | Accepts only those values, including structural comparison of objects/arrays. Omission imposes no closed list. |
| `const` | One JSON value | Requires exactly that value. Omission imposes no fixed value. |

**Absent**, `null`, `""`, `0`, and `false` are different. An optional field may be omitted, but does not accept `null` unless its schema allows it. `required` requires presence, not a nonempty string: add `minLength: 1` for that.

Nested fields support nullable unions such as `"type": ["string", "null"]`. With the current strict settings, non-null unions such as `["string", "number"]` are rejected; use `anyOf`. Combining nullability with `enum` or `const` requires those constraints to allow `null` too. Do not use a type array at the root of a tool schema.

```json
{
  "type": "object",
  "properties": {
    "issueKey": { "type": "string", "pattern": "^[A-Z][A-Z0-9_]*-[1-9][0-9]*$" },
    "assignee": { "type": ["string", "null"] },
    "state": { "type": "string", "enum": ["open", "closed"] },
    "apiVersion": { "const": 1 }
  },
  "required": ["issueKey"],
  "additionalProperties": false
}
```

Valid: `{"issueKey":"CS-303","assignee":null}`. Invalid: `{"issueKey":null}` or `{"issueKey":"CS-303","state":"unknown"}`. `assignee`, `state`, and `apiVersion` may be omitted.

## Objects and extra fields

| Keyword | Value | Rule and behavior when omitted |
| --- | --- | --- |
| `properties` | Field name → subschema map | Validates each declared field when present. Does not require presence or forbid other fields. |
| `required` | Array of unique names | All must be present. Omission is equivalent to `[]`. Strict mode also requires the names in `properties` in a compatible context. |
| `additionalProperties` | Boolean or subschema | Controls fields not covered by `properties` or `patternProperties` **in that same schema object**. Omission allows extra fields. |
| `patternProperties` | Regex → subschema map | Validates matching field names. Multiple matching patterns all apply. Omission defines no pattern-based rules. |
| `propertyNames` | String subschema | Validates each field's name, not its value. Does not declare or allow fields by itself. Omission does not restrict names. |
| `minProperties` | Integer ≥ 0 | Minimum number of present fields. Omission is equivalent to 0. |
| `maxProperties` | Integer ≥ 0 | Maximum number of present fields. Omission imposes no limit. |
| `dependentRequired` | Field name → array of names | When the key is present, the listed fields are required. A one-way presence dependency. Omission adds none. |
| `dependentSchemas` | Field name → subschema | When the key is present, applies the subschema to the **entire object**. Omission adds no conditions. |
| `unevaluatedProperties` | Boolean or subschema | Controls fields not evaluated by applicable rules, including through `$ref`, `allOf`, and successful branches. Omission adds no restriction. |

### `additionalProperties`: false, true, or a schema

| Setting | Result |
| --- | --- |
| `false` | Extra fields fail validation. They are not removed. |
| `true` | Extra fields with any value are accepted. Declared fields are still validated. |
| Omitted | Extra fields are accepted unless another rule such as `unevaluatedProperties` constrains them. |
| `{ "type": "string" }` | Extra fields are allowed only when their values are strings. |

With the first example in this guide, `{"issueKey":"CS-303","verbose":true}` fails. Changing `additionalProperties` to `true` accepts it. This does not make `issueKey` optional or change its type.

Each nested object has its own rules: root-level `additionalProperties: false` does not close nested objects. This example rejects extra fields both at the root and inside `issue`:

```json
{
  "type": "object",
  "properties": {
    "issue": {
      "type": "object",
      "properties": { "key": { "type": "string" }, "summary": { "type": "string" } },
      "required": ["key", "summary"],
      "additionalProperties": false
    }
  },
  "required": ["issue"],
  "additionalProperties": false
}
```

For inputs, `false` helps detect invented or misspelled arguments. For outputs, use it when constructing a precise structure. If Jira returns many fields and the schema declares two, project the response with JSONata or allow extra fields. **The schema does not perform that projection.**

### Dictionaries and patterns

```json
{
  "type": "object",
  "properties": {
    "labels": {
      "type": "object",
      "propertyNames": { "pattern": "^[a-z][a-z0-9_]*$" },
      "additionalProperties": { "type": "string", "maxLength": 80 },
      "maxProperties": 20
    },
    "metrics": {
      "type": "object",
      "patternProperties": { "^metric_[a-z]+$": { "type": "number" } },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

`{"labels":{"team":"support"},"metrics":{"metric_count":3}}` is valid. `metric_count: "3"` fails. Regexes are not automatically anchored: use `^` and `$` to validate the entire name. Strict AJV rejects a name declared in `properties` that also matches a `patternProperties` pattern.

### Composition and closed objects

`additionalProperties` does not collect properties declared in other `allOf` members. To compose an object and close the result, use `unevaluatedProperties: false` at the composition level and leave its parts open:

```json
{
  "type": "object",
  "allOf": [
    { "properties": { "key": { "type": "string" } }, "required": ["key"] },
    { "properties": { "summary": { "type": "string" } }, "required": ["summary"] }
  ],
  "unevaluatedProperties": false
}
```

This accepts `{"key":"CS-303","summary":"Example"}` and rejects an `extra` field. In unions, successful branches count: declaring a field in any branch does not always allow it. An explicit `additionalProperties: true` also evaluates extra fields and can prevent an enclosing `unevaluatedProperties: false` from rejecting them.

## Strings and numbers

| Keyword | Applicable type / value | Rule and behavior when omitted |
| --- | --- | --- |
| `minLength` | String / integer ≥ 0 | Minimum Unicode characters (code points, not bytes or graphemes). Omitted: 0. |
| `maxLength` | String / integer ≥ 0 | Maximum characters. Omitted: no limit. |
| `pattern` | String / regex string | Requires a match. Do not include `/.../` delimiters; for example, write `"pattern": "^\\d+$"` in JSON to represent the regex `^\d+$`. Omitted: no pattern. |
| `format` | Format name | This project validates it using `ajv-formats`. Omitted: no format check. Unknown formats fail compilation. |
| `minimum` | Number/integer / number | Inclusive lower bound. Omitted: no bound. |
| `maximum` | Number/integer / number | Inclusive upper bound. Omitted: no bound. |
| `exclusiveMinimum` | Number/integer / number | Requires a strictly greater value. Not a boolean in 2020-12. Omitted: no bound. |
| `exclusiveMaximum` | Number/integer / number | Requires a strictly smaller value. Omitted: no bound. |
| `multipleOf` | Number/integer / number > 0 | Requires an exact multiple. Omitted: no multiple constraint. |

```json
{
  "type": "object",
  "properties": {
    "limit": { "type": "integer", "minimum": 1, "maximum": 100 },
    "score": { "type": "number", "exclusiveMinimum": 0, "exclusiveMaximum": 1 },
    "amountCents": { "type": "integer", "minimum": 0, "multipleOf": 5 },
    "code": { "type": "string", "minLength": 3, "maxLength": 12, "pattern": "^[A-Z0-9]+$" },
    "email": { "type": "string", "format": "email" }
  },
  "required": ["limit"],
  "additionalProperties": false
}
```

`{"limit":10,"score":0.5,"amountCents":15}` is valid. `"limit":"10"`, `score: 1`, and `amountCents: 12` fail. JSON cannot represent `NaN` or `Infinity`; AJV also rejects non-finite numbers. JavaScript uses floating point: for money or large identifiers, prefer integer cents within the safe range or strings; `multipleOf: 0.01` can encounter rounding errors.

### All registered formats

This inventory reflects `newValidator()` and the project lockfile. All formats except `int32`, `int64`, `float`, and `double` apply to strings; always declare the appropriate type. A format checks syntax, not existence, permissions, or reachability of an address.

| Format | Check |
| --- | --- |
| `date` | Calendar date, such as `2026-10-13`. |
| `time` | Time with timezone, such as `14:30:00Z`. |
| `date-time` | Date and time with timezone, such as `2026-10-13T14:30:00Z`. |
| `iso-time` | Variant also accepting time without a timezone. |
| `iso-date-time` | Variant also accepting date-time without a timezone. |
| `duration` | ISO duration, such as `P3D` or `PT2H`. |
| `uri` | Absolute URI; not limited to HTTP. |
| `uri-reference` | Absolute or relative URI reference. |
| `uri-template` | URI template syntax; does not substitute server variables. |
| `url` | Legacy URL validator with its own restrictions; prefer `uri`. May reject localhost and private addresses. |
| `email` | Email syntax; does not verify the mailbox. |
| `hostname` | Hostname syntax; does not query DNS. |
| `ipv4` | IPv4 address. |
| `ipv6` | IPv6 address. |
| `regex` | Regular expression syntax. Does not execute the pattern against other fields. |
| `uuid` | UUID syntax. |
| `json-pointer` | JSON Pointer, such as `/issue/key`. |
| `json-pointer-uri-fragment` | Pointer as a fragment, such as `#/issue/key`. |
| `relative-json-pointer` | Relative JSON Pointer, such as `1/key`. |
| `byte` | Base64 syntax; does not decode or transform the string. |
| `int32` | Signed 32-bit integer. Use `type: integer`. |
| `int64` | Checks that the number is an integer; does not provide 64-bit precision or enforce JavaScript's safe integer range. |
| `float` | Accepts numbers; does not convert or impose IEEE 32-bit precision. |
| `double` | Accepts numbers; does not extend JavaScript precision. |
| `password` | Recognized without additional validation. Does not encrypt or conceal values. |
| `binary` | Recognized without additional validation. Does not enable files, multipart, or binary transport. |

`idn-email`, `idn-hostname`, `iri`, and `iri-reference` exist in the standard but are not registered in this project. Do not use them without changing the validator.

### Format bounds: ajv-formats extension

| Keyword | Comparison |
| --- | --- |
| `formatMinimum` | Greater than or equal to the bound. |
| `formatMaximum` | Less than or equal to the bound. |
| `formatExclusiveMinimum` | Strictly greater. |
| `formatExclusiveMaximum` | Strictly smaller. |

Bounds are strings and require `format` in the same schema, with a comparison function. Installed formats providing it are `date`, `time`, `date-time`, `iso-time`, and `iso-date-time`. They cannot order emails or UUIDs. Without these keywords there are no additional range restrictions.

```json
{
  "type": "object",
  "properties": {
    "since": { "type": "string", "format": "date", "formatMinimum": "2026-01-01", "formatExclusiveMaximum": "2027-01-01" }
  },
  "required": ["since"],
  "additionalProperties": false
}
```

## Arrays, tuples, and matches

| Keyword | Value | Rule and behavior when omitted |
| --- | --- | --- |
| `items` | Subschema or boolean | Validates all elements, or those following `prefixItems`. Omission does not constrain those elements. Cannot be an array of schemas in 2020-12. |
| `prefixItems` | Nonempty array of subschemas | Validates initial elements by position. Does not require those positions to exist. Omission defines no tuple. |
| `minItems` | Integer ≥ 0 | Minimum length. Omitted: 0. |
| `maxItems` | Integer ≥ 0 | Maximum length. Omitted: no limit. |
| `uniqueItems` | Boolean | When `true`, forbids JSON-equal elements; does not deduplicate. Omitted: `false`. Does not enforce uniqueness of one field such as `id`. |
| `contains` | Subschema | Requires matching elements. At least one by default. Omission requires no matches. |
| `minContains` | Integer ≥ 0 | Minimum matches for `contains`; omitted: 1 when `contains` exists. |
| `maxContains` | Integer ≥ 0 | Maximum matches for `contains`; omitted: no limit. |
| `unevaluatedItems` | Boolean or subschema | Validates elements not evaluated by other applicable rules, including compositions. Omission adds no restriction. |

Strict mode rejects `minContains` and `maxContains` without `contains`. `contains` validates matches without filtering or extracting them. `minContains: 0`, `maxContains: 0` can forbid any matching element. `items: true` evaluates all remaining elements; an enclosing `unevaluatedItems: false` does not close them again.

```json
{
  "type": "object",
  "properties": {
    "tags": { "type": "array", "items": { "type": "string", "minLength": 1 }, "minItems": 1, "maxItems": 5, "uniqueItems": true },
    "coordinate": { "type": "array", "prefixItems": [{ "type": "number" }, { "type": "number" }], "minItems": 2, "items": false },
    "states": { "type": "array", "items": { "type": "string" }, "contains": { "const": "open" }, "minContains": 1, "maxContains": 2 }
  },
  "additionalProperties": false
}
```

`{"tags":["support"],"coordinate":[10,20],"states":["open","closed"]}` is valid. Duplicate tags, a three-element coordinate, or `states: ["closed"]` fail. Strict AJV requires consistently bounded tuples: for two fixed positions, use `minItems: 2` and either `items: false` or `maxItems: 2`.

## Combinations and conditions

| Keyword | Value | Rule |
| --- | --- | --- |
| `allOf` | Nonempty array of schemas | Must satisfy all. Does not merge, transform, or override properties. |
| `anyOf` | Nonempty array of schemas | Must satisfy at least one; may satisfy several. |
| `oneOf` | Nonempty array of schemas | Must satisfy exactly one. Two successful branches cause failure. |
| `not` | One schema | Must fail that schema. |
| `if` | One schema | Selects a branch without independently requiring the condition to hold. |
| `then` | One schema | Applies when `if` succeeds. |
| `else` | One schema | Applies when `if` fails. |

Omission adds no conditions. Strict AJV rejects `then`/`else` without `if`, or `if` without either branch. Inside `if`, `properties` does not require presence: add `required` when testing whether the discriminator exists. Different `const` values in `oneOf` branches avoid overlaps.

```json
{
  "type": "object",
  "properties": {
    "mode": { "type": "string", "enum": ["issue", "search"] },
    "issueKey": { "type": "string", "minLength": 1 },
    "jql": { "type": "string", "minLength": 1 }
  },
  "required": ["mode"],
  "if": { "properties": { "mode": { "const": "issue" } }, "required": ["mode"] },
  "then": { "required": ["issueKey"] },
  "else": { "required": ["jql"] },
  "not": { "properties": { "issueKey": {}, "jql": {} }, "required": ["issueKey", "jql"] },
  "additionalProperties": false
}
```

Valid: `{"mode":"issue","issueKey":"CS-303"}` and `{"mode":"search","jql":"project = CS"}`. Invalid: issue mode without `issueKey`, or both `issueKey` and `jql` present.

```json
{
  "type": "object",
  "properties": {
    "identifier": { "anyOf": [{ "type": "string", "minLength": 1 }, { "type": "integer", "minimum": 1 }] },
    "result": {
      "oneOf": [
        { "type": "object", "properties": { "status": { "const": "ok" }, "value": { "type": "string" } }, "required": ["status", "value"], "additionalProperties": false },
        { "type": "object", "properties": { "status": { "const": "error" }, "message": { "type": "string" } }, "required": ["status", "message"], "additionalProperties": false }
      ]
    }
  },
  "required": ["identifier", "result"],
  "additionalProperties": false
}
```

Valid example: `{"identifier":3,"result":{"status":"ok","value":"done"}}`. A boolean identifier or an `"ok"` result without `value` fails.

### Field dependencies

```json
{
  "type": "object",
  "properties": {
    "cursor": { "type": "string" },
    "jql": { "type": "string" },
    "credentials": { "type": "boolean" },
    "account": { "type": "string" }
  },
  "dependentRequired": { "cursor": ["jql"] },
  "dependentSchemas": { "credentials": { "required": ["account"] } },
  "additionalProperties": false
}
```

`{"cursor":"next","jql":"project = CS"}` is valid; `{"cursor":"next"}` is not. If `credentials` exists, even with value `false`, `account` is required: these dependencies test presence. Use `if`/`then` to depend on its value.

## References, identity, and vocabularies

| Keyword | Purpose and project support |
| --- | --- |
| `$schema` | Declares the schema dialect. Omission uses AJV 2020-12. Use `https://json-schema.org/draft/2020-12/schema`; other drafts are not loaded automatically. The outer configuration's `$schema` is a separate editor hint. |
| `$id` | Identifies a schema resource and establishes a reference base. Does not download anything or register a global definition across tools. Omission assigns no explicit identifier. Avoid changing subschema bases unless necessary. |
| `$ref` | Applies a referenced schema. Only internal references starting with `#`, such as `#/$defs/issue`, are allowed. In 2020-12, sibling keywords also apply. |
| `$defs` | Reusable subschema map. Declaration alone does not require the data to satisfy them: they apply when referenced. Each input/output schema owns its map. |
| `$anchor` | The standard defines named anchors, but the installed AJV version/configuration rejects this as an unknown keyword in strict mode. Use `$defs` pointers. |
| `$dynamicAnchor` | Defines a named dynamic anchor for recursive/extensible references. Accepted by AJV; usually unnecessary for a simple integration. |
| `$dynamicRef` | Reference resolved through dynamic scope. Internal only (`#...`) in this server. Prefer `$ref` for ordinary reuse. |
| `$vocabulary` | In metaschemas, declares vocabularies and whether they are required (URI → boolean map). Does not install plugins or enable new keywords in this server. Cannot bypass strict mode. |
| `$comment` | Maintainer comment. Does not constrain data or execute as code; no logging callback is configured. |

Aside from project root constraints, these keywords are optional. JSON Pointer escapes `/` as `~1` and `~` as `~0` in names; `#/...` is not a file path. References to URLs, other files, or other tools are forbidden. Unresolved internal references fail configuration loading. `$ref` is different from `${input...}`: templates are not resolved inside schemas.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": { "issue": { "$ref": "#/$defs/issue" } },
  "required": ["issue"],
  "additionalProperties": false,
  "$defs": {
    "issue": {
      "type": "object",
      "properties": { "key": { "type": "string" }, "summary": { "type": "string" } },
      "required": ["key", "summary"],
      "additionalProperties": false
    }
  }
}
```

Recursive structures can also be described without fetching schemas:

```json
{
  "type": "object",
  "$dynamicAnchor": "node",
  "properties": {
    "name": { "type": "string" },
    "children": { "type": "array", "items": { "$dynamicRef": "#node" } }
  },
  "required": ["name"],
  "additionalProperties": false
}
```

This accepts `{"name":"root","children":[{"name":"child"}]}`. For recursive schemas or complex compositions, also check compatibility with the MCP client consuming the definition.

## Annotations: describe without transforming

| Keyword | Value and effect |
| --- | --- |
| `title` | Human-readable name of the described value. Does not automatically replace `tool.title`. |
| `description` | Explanation for agents, users, and editors. Not an executable rule. |
| `default` | Suggested value. This project does not insert it or make a required field optional. |
| `examples` | Array of illustrative values. Does not constrain like `enum`, nor imply AJV validates them when compiling. |
| `deprecated` | Boolean; `true` discourages use of the field without forbidding it. Omission does not mark it deprecated. |
| `readOnly` | Boolean describing a read field. The runtime does not remove it from inputs or block writes. |
| `writeOnly` | Boolean describing a write field. The runtime does not remove it from outputs or hide it. |
| `x-mcp-header` | Project extension, a string accepted as MCP metadata. Does not configure HTTP headers by itself; use `execution.headers`. |

Omitting annotations adds no hints or constraints; `readOnly` and `writeOnly` are treated as `false`. Do not put secrets in `default`, `examples`, or descriptions: schemas are published to the MCP client. `readOnly`/`writeOnly` differ from tool annotations such as `readOnlyHint`.

```json
{
  "type": "object",
  "properties": {
    "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 20, "examples": [10, 20] },
    "note": { "type": "string", "description": "Optional note", "deprecated": true }
  },
  "required": ["limit"],
  "additionalProperties": false
}
```

`{}` fails despite `limit` having `default: 20`. `{"limit":10}` validates without changes. An execution template referencing an absent optional argument may also fail during resolution: the schema does not supply the missing value.

### Encoded content

| Keyword | Meaning | Actual effect here |
| --- | --- | --- |
| `contentEncoding` | String encoding, such as `base64`. | Metadata; does not verify or decode. |
| `contentMediaType` | Content MIME type, such as `application/json`. | Metadata; does not parse JSON or configure headers. |
| `contentSchema` | Schema of the decoded content. | Metadata; does not validate that content with this AJV configuration. |

For base64 validation, `format: byte` checks syntax. To parse and validate content, configure the parser/transformation and an effective `outputSchema`. These annotations do not enable uploads or binary responses either.

## Compatibility and disabled options

This reference covers the 2020-12 Core, Applicator, Validation, Unevaluated, Metadata, Format, and Content vocabulary keywords, plus registered extensions. It does not imply universal support for all drafts, optional formats, or third-party extensions.

| Name or construction | Status / alternative |
| --- | --- |
| `definitions` | Legacy form accepted by AJV. Prefer `$defs`. |
| `dependencies` | Accepted legacy form; arrays require fields and schemas apply to the entire object. Prefer `dependentRequired` / `dependentSchemas`. |
| `nullable` | OpenAPI extension accepted by AJV with `type`; `true` adds null to the type, but not to `enum`/`const`. Prefer `type: ["string", "null"]` for nested fields. |
| `additionalItems` | Do not use in 2020-12; rejected in strict mode. Use `prefixItems` + `items`. |
| `items: [...]` | Tuple syntax from older drafts; rejected. Use `prefixItems`. |
| `$recursiveAnchor`, `$recursiveRef` | Old 2019-09 keywords. Do not use as a 2020-12 contract; `$recursiveAnchor: true` fails the installed metaschema. Use `$dynamicAnchor` / `$dynamicRef`. |
| `id` | Unsupported legacy form. Use `$id`. |
| `$async` | Forbidden by the loader, even when `false`: tools use synchronous validation. |
| `$data` | References to other field values are disabled. Use standard conditions where sufficient; arbitrary comparisons require additional logic. |
| `discriminator` | Disabled extension. Use `oneOf` with `const` discriminators. |
| `example`, `xml`, `externalDocs`, arbitrary `x-*` | Not directly accepted, except `x-mcp-header`. `examples` is accepted. The OpenAPI importer may convert or omit metadata. |
| `transform`, `errorMessage`, `select` | Extensions from plugins that are not installed. Use `response.transform` for output transformations. |
| External metaschemas/drafts | Not fetched or registered automatically. Normalize to 2020-12. |

Strings inside `const`, `enum`, `default`, or `examples` are data, not keywords. A user field named `$ref` inside `properties` is not itself a schema reference.

### OpenAPI import and execution are different stages

OpenAPI scripts do not necessarily accept everything AJV accepts. They normalize `nullable`, local references, and selected formats; they may discard metadata or reject binary schemas and keywords outside their allowlist. During import, `readOnly` fields are projected out of inputs and `writeOnly` fields out of outputs. This happens while **generating configuration**, not while validating a call. Review warnings and [the import guide](openapi-import.md).

## Validate, troubleshoot, and maintain

To check a complete configuration file:

```sh
npm run build
node dist/cli.js validate --config examples/cli.json
```

Replace the path with your file. `validate` compiles schemas and checks configuration/references/environment; **it does not call APIs, execute tools, or check actual responses**. Try valid and invalid calls in [MCP Inspector](quick-start.md#test-with-mcp-inspector). An MCP client may reject arguments before they reach the runtime.

| Symptom | Check |
| --- | --- |
| `Invalid or unsupported JSON Schema` | Missing/incompatible type, unknown keyword, bad reference, unregistered format, or an ignored condition rejected by strict mode. |
| `[input]` / invalid arguments | `required`, actual types, `enum`, bounds, patterns, and extra fields. Execution should not begin. |
| `[output]` / incompatible result | Shape after parsing/JSONata, extra nested fields, nulls, and object root. The external operation already happened; do not automatically retry writes. |
| Missing `default` value | It is a schema hint, not an inserted value. Send it explicitly or change configuration. |
| Unexpected `oneOf` failure | Either zero or multiple branches succeeded. Check discriminators and required fields. |
| `allOf` rejects a declared field | Check `additionalProperties` closures in branches; consider `unevaluatedProperties`. |

Do not confuse `maxLength` or `maxItems` with `maxOutputBytes`: the latter limits transport/processing bytes and is configured outside the schema. Do not assume the worker timeout isolates AJV either: validation runs synchronously in the main process. Keep regexes and schemas reasonably bounded in cost.

Examples and inventory are checked with `npm run docs:check-schema`; it compares both languages, compiles examples with the project validator, and checks valid and invalid cases. After editing guides, run `npm run docs:build` to regenerate HTML and verify links.

Official references: [JSON Schema 2020-12](https://json-schema.org/specification), [Validation](https://json-schema.org/draft/2020-12/json-schema-validation), [Core and Applicator](https://json-schema.org/draft/2020-12/json-schema-core), [AJV strict mode](https://ajv.js.org/strict-mode.html), [ajv-formats](https://ajv.js.org/packages/ajv-formats.html). For this server's behavior, its validator configuration, lockfile, and the checks accompanying this guide take precedence.
