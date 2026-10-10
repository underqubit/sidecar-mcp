# Generate configurations from Swagger and OpenAPI

[Español](../importar-openapi.md) · [Back to index](README.md)

The scripts convert a local JSON/YAML specification into a Sidecar integration file. They generate one HTTP tool per selected operation, including descriptions, schemas, parameters, authentication, and response transformation. The result can run directly or be referenced by a [group composition](tool-groups.md).

## Usage

The `scripts` directory contains three entry points sharing one converter:

| Script | Accepted versions |
| --- | --- |
| `scripts/openapi-to-config.mjs` | Auto-detects Swagger 2.0 and OpenAPI 3.0.x, 3.1.x, and 3.2.x. |
| `scripts/openapi2-to-config.mjs` | Swagger/OpenAPI 2.0 only. |
| `scripts/openapi3-to-config.mjs` | OpenAPI 3.0.x, 3.1.x, and 3.2.x only. |

Unknown future versions are explicitly rejected; compatibility with a future major version is not assumed. Install dependencies and build the project first:

```sh
npm ci
npm run build
node scripts/openapi-to-config.mjs --help
```

Included examples, with no service calls during generation:

```sh
node scripts/openapi2-to-config.mjs \
  --input examples/openapi/swagger2.yaml \
  --output examples/catalog-v2.json

node scripts/openapi3-to-config.mjs \
  --input examples/openapi/openapi3.yaml \
  --output examples/catalog-v3.yaml
```

To import your own specification and include only read operations:

```sh
node scripts/openapi-to-config.mjs \
  --input ./api.yaml \
  --output ./tools.json \
  --base-url https://api.example.com/v1 \
  --methods GET,HEAD \
  --prefix catalog
```

By default, **all supported methods** are included, including write operations. The script generates configuration; it does not execute those operations. Review the tools before connecting them to an agent.

## Options

| Option | Behavior |
| --- | --- |
| `--input` | Required local `.json`, `.yaml`, or `.yml` file, up to 16 MiB. |
| `--output` | JSON/YAML file selected by extension. Without it, prints JSON to stdout. The directory must exist. |
| `--base-url` | Overrides all operation API URLs, including the base path. Does not change the OAuth endpoint. |
| `--name` | Server name; defaults to a name derived from `info.title`. |
| `--prefix` | Tool name prefix, separated by `_`. |
| `--env-prefix` | Credential variable prefix; defaults to `OPENAPI`. |
| `--methods` | Comma-separated HTTP methods, case-insensitive. |
| `--tags` | Comma-separated tags; includes operations matching any of them. |
| `--skip-unsupported` | Omits incompatible operations and reports each on stderr. Without it, fails without generating partial configuration. |
| `--force` | Allows replacing an existing output file, never the input specification. |

Warnings, skipped operations, and required variable names go to stderr. Specifications and external references are not downloaded. No API calls or credential verification take place. The result must pass the project's configuration validation and cannot exceed 4 MiB.

YAML rejects duplicate keys and aliases. Bundle multi-file specifications into one document with local `#/...` references first.

## Generated mapping

**Names:** uses `operationId` or a method/path-derived name, normalizes characters, and adds a deterministic suffix for collisions. Names do not exceed 128 characters. Descriptions preserve `description`, `summary`, or method/path, in that order. Annotations treat GET, HEAD, and OPTIONS as read-only; other methods are conservatively marked as potentially destructive.

**URL:** Swagger uses `schemes`, `host`, and `basePath`; missing `schemes` defaults to HTTPS with a warning. OpenAPI 3 uses the first server at operation, path, or document level, in that order, and substitutes server variable defaults. Relative URLs or missing hosts require `--base-url`. URLs must use HTTP(S), without embedded credentials, query strings, or fragments. Generated paths are relative to preserve prefixes such as `/api/v3`.

**Parameters:** inputs are named `path_id`, `query_limit`, `header_X_Count`, `form_name`, etc. Operation declarations override same-location/name path parameters. URL placeholders are renamed internally to accommodate names that are not valid Sidecar template identifiers.

Optional query and form parameters become **required nullable keys**: send `null` to omit a parameter, for example `{"query_limit":null}`. Omitting the key fails input validation. Optional headers and request bodies become required with a warning, because the runtime cannot omit their templates; review this choice when the API distinguishes absence from a supplied value. Schema defaults do not populate arguments automatically.

**Body:** supports JSON, text, and URL-encoded forms. JSON/text use `body`; forms use `form_*` inputs. OpenAPI 3 forms must declare a simple object with fixed properties and `additionalProperties: false`. The converter does not serialize nested objects into form values.

**Response:** selects the lowest explicit 2xx status and sets `successStatuses` to that one code. Multiple successful statuses produce a warning; other 2xx responses become errors until the configuration is reviewed. `default` or `2XX` without a concrete code is insufficient. For content, prefers JSON (including `application/*+json` in OpenAPI 3 responses), then text; warns when discarding alternatives.

Every response is wrapped as `{"data":...}`, preserving an MCP object root even for an API array or scalar. HEAD, 204, 205, and responses without a body produce `{"data":null}`. Empty and singleton arrays remain arrays. The output schema describes the content inside `data`.

**Schemas:** converts local references to `$defs`, supports recursive references, and projects `readOnly` properties out of inputs and `writeOnly` properties out of outputs. Converts OpenAPI 3.0 `nullable`, Swagger `x-nullable`, and boolean exclusive bounds to JSON Schema. OpenAPI 3.1/3.2 supports native unions with `null`. Formats unknown to the validator are omitted with a warning while preserving the underlying type. Unsupported validation keywords cause errors rather than being silently removed. Complex schemas must also be accepted by AJV in strict mode.

## Authentication and execution

Operation `security` overrides global security; `security: []` removes inherited authentication. Supports header/query API keys, Basic, Bearer, and OAuth2 `client_credentials` (`flow: application` in Swagger 2). OAuth endpoints must be absolute; the converter emits `tokenAuthMethod: basic` and a warning to verify it with the provider.

When multiple OR alternatives exist, it uses the first and warns. It does not combine AND schemes or replace unsupported schemes with anonymous access. Only profiles used by selected tools are generated.

Credentials are represented as `${env.VARIABLE}`. Names contain the prefix, normalized scheme name, a stable hash, and secret type. The script lists exact variable names without requesting or reading real credentials. For example, the OpenAPI 3 fixture requires:

```dotenv
OPENAPI_BEARERAUTH_C41694_TOKEN=replace-with-your-token
```

After configuring `.env`:

```sh
node --env-file=.env dist/cli.js validate --config examples/catalog-v3.yaml
node --env-file=.env dist/cli.js serve --config examples/catalog-v3.yaml
```

No `.env` file is generated automatically. Generator validation uses dummy values and checks structure, schemas, and templates; it does not establish that credentials or the API work.

To use the integration as a group, reference it from a composition file:

```yaml
groups:
  - id: catalog
    config: ./catalog-v3.yaml
```

## Limitations and development

Rejects external references or anchors, methods unsupported by the executor (TRACE, QUERY, COPY, etc.), cookies, multipart/files/binary data, serialization such as `deepObject`, CSV arrays and path/header arrays, `allowReserved: true`, parameters using `content`, incompatible schemas/dialects, interactive OAuth, OpenID Connect, and combined authentication. Query/form arrays must contain scalars and use Swagger `collectionFormat: multi` or OpenAPI 3 `style: form`, `explode: true`. Scalar path/header parameters use `simple`.

Callbacks and webhooks are reported as not generated. OpenAPI 3.2-specific features that do not fit the current executor require manual mapping. This is not a complete specification validator or universal API client generator.

Shared code lives in `scripts/lib`: `openapi-cli.mjs` handles files/options, `openapi-converter.mjs` translates operations, and `openapi-schema.mjs` normalizes schemas/references. The three entry points avoid duplicating version-specific logic. The runtime and configuration format are unchanged.

Tests: `npm run check`. `tests/openapi.test.ts` generates files through the scripts and executes resulting tools against intercepted HTTP, covering authentication, URLs, parameters, forms, schemas, responses, and conversion failures.

Format references: [Swagger 2.0](https://spec.openapis.org/oas/v2.0), [OpenAPI 3.0](https://spec.openapis.org/oas/v3.0.4.html), [3.1](https://spec.openapis.org/oas/v3.1.2.html), [3.2](https://spec.openapis.org/oas/v3.2.0.html).
