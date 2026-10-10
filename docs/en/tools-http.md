# HTTP tools: adapt a REST API

[Back to index](README.md) · [Common configuration](configuration.md) · [Español](../tools-http.md)

Each HTTP tool performs one request using Axios. MCP arguments are explicitly mapped to the path, query, headers, or body. The server does not discover endpoints or import OpenAPI automatically.

## `execution` reference

| Field | Type / default | Purpose |
| --- | --- | --- |
| `type` | Literal `http` | Selects the adapter. |
| `baseUrl` | Required string | Fixed HTTP/HTTPS URL or one from the environment. No query, fragment, or embedded credentials. |
| `method` | `GET` | GET, POST, PUT, PATCH, DELETE, HEAD, or OPTIONS. |
| `path` | String, `""` | Fixed path with optional `{name}` placeholders. |
| `pathParams` | Object, `{}` | Placeholder values, optionally using templates. |
| `query` | Object, `{}` | Query parameters. |
| `headers` | String map, `{}` | Fixed names; values may use templates. |
| `body` | JSON value, omitted | Body with optional templates. |
| `bodyEncoding` | `json` | Also `form` or `text`. |
| `auth` | Profile name, omitted | Reference to `auth.<name>`; dynamic selection from input is not supported. |
| `successStatuses` | Integer list, omitted | Without a list, 200–299 are accepted. A list replaces that range. |
| `timeoutMs` | Inherited from server | Tool deadline and request timeout. |
| `maxOutputBytes` | Inherited from server | Limit for the body, captured response, and result. |

An arbitrary Axios object is not accepted: only the fields above. Options such as interceptors, TLS agents, proxies, multipart, redirects, and retries have no public configuration in this version.

## Complete example: get a user

Save as `user.yaml` in the root. The expected remote contract is a `GET /users/{id}` endpoint returning an object with `id` and `name`.

```yaml
version: 1
auth:
  users_service:
    type: bearer
    token: '${env.API_TOKEN}'
tools:
  - name: users_get
    description: Looks up a user by identifier and returns their ID and name.
    inputSchema:
      type: object
      properties:
        id: { type: string, minLength: 1, description: User identifier. }
      required: [id]
      additionalProperties: false
    outputSchema:
      type: object
      properties:
        id: { type: string }
        name: { type: string }
      required: [id, name]
      additionalProperties: false
    annotations:
      readOnlyHint: true
      destructiveHint: false
      idempotentHint: true
      openWorldHint: true
    execution:
      type: http
      baseUrl: '${env.API_BASE_URL}'
      method: GET
      path: /users/{id}
      pathParams: { id: '${input.id}' }
      headers: { Accept: application/json }
      auth: users_service
    response:
      parser: { type: json }
      transform: '{"id": $string(data.id), "name": data.name}'
```

Set `API_BASE_URL` and `API_TOKEN` in the environment or `.env` using your actual service values:

```sh
node --env-file=.env dist/cli.js validate --config user.yaml
node --env-file=.env dist/cli.js serve --config user.yaml
```

MCP arguments: `{"id":"42"}`. If the API returns `{"id":42,"name":"Ada","email":"ada@example.org"}`, the tool returns `{"id":"42","name":"Ada"}`. The schema checks the result after transformation.

The repository also includes [examples/http.yaml](../../examples/http.yaml), configured to serve over HTTP.

## Jira Cloud example

[examples/jira.json](../../examples/jira.json) exposes four tools using GET requests to Jira Cloud REST API v3:

| Tool | Purpose |
| --- | --- |
| `jira_search_issues` | Search issues with JQL and follow token-based pages. |
| `jira_get_issue` | Read details, description, owners, status, and dates. |
| `jira_list_issue_comments` | Read paginated comments. |
| `jira_list_issue_changelog` | Review paginated field changes. |

Set `JIRA_BASE_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN` in `.env`, using [.env.example](../../.env.example) as a reference. Basic authentication uses the Atlassian email and an API token, not the account password. For tokens without scopes, use `https://your-domain.atlassian.net`; for scoped tokens, use `https://api.atlassian.com/ex/jira/YOUR_CLOUD_ID` with suitable read permissions. Example paths are relative to preserve that prefix. See [authentication](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/) and [Atlassian tokens](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/).

From the project root, with dependencies installed:

```sh
npm run build
node --env-file=.env dist/cli.js validate --config examples/jira.json
npx -y @modelcontextprotocol/inspector node -- \
  --env-file=.env dist/cli.js serve --config examples/jira.json --transport stdio
```

Example arguments for `jira_search_issues`:

```json
{"jql":"project = DEMO ORDER BY updated DESC","maxResults":25,"nextPageToken":null}
```

Replace `DEMO` with a real project. For the next page, send the returned token with the same JQL; stop when `isLast` is `true`. This uses [enhanced `search/jql`](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-jql-get), without inventing a total result count. Recent updates may take time to appear.

For details, send `{"issueIdOrKey":"DEMO-42"}`. For comments or history, send `{"issueIdOrKey":"DEMO-42","startAt":0,"maxResults":25}` and continue with `nextStartAt` until it is `null`. All shown arguments are required: the runtime does not apply input schema defaults. Stop on an empty page even if the total changed during the query.

Descriptions and comments retain their ADF structure. Transformations select useful fields and preserve empty or single-item arrays. Access depends on account permissions and issue/comment restrictions. This example targets Jira Cloud; Jira Data Center compatibility is not assumed. `validate` checks configuration, but does not verify real credentials or connectivity.

### Diagnose Jira errors

The runtime reports HTTP status without exposing the service's error body. To investigate a 400/404 locally, run diagnostics with a real issue key and its project; replace the `PROJECT-123` and `PROJECT` placeholders:

```sh
node --env-file=.env scripts/diagnose-jira.mjs \
  --issue PROJECT-123 --jql 'project = PROJECT ORDER BY updated DESC'
```

Requires the build in `dist/`. It reads `examples/jira.json`, checks identity with `GET /rest/api/3/myself`, and reproduces issue/search requests with the same mapping and authentication. Diagnostic search requests the first page with at most one result. Without arguments, it checks identity only. It does not modify issues.

Output includes statuses and Jira's `errorMessages`, `errors`, or `message` fields; it redacts credential values and does not print complete bodies, issues, or headers. It exits with code `1` if any check fails. The MCP runtime retains its usual messages.

A 404 can mean the issue does not exist or is not visible to the account. A 400 requires reading Jira's message: for example, invalid JQL, an unknown/inaccessible project, or an invalid cursor. Use an issue the API token's account can open and replace the examples' `DEMO` values. A `/myself` failure may also reflect scopes specific to that endpoint; it does not by itself prove that all tools lack access. See [Atlassian HTTP troubleshooting](https://support.atlassian.com/jira/kb/webhooks-or-web-requests-fail-with-http-status-code-400-401-or-403-in-jira/).

## URL construction

With `baseUrl: https://api.example.com/v1`:

| `path` | Resulting URL |
| --- | --- |
| `users` | `https://api.example.com/v1/users` |
| `/users` | `https://api.example.com/users` |
| Empty | `https://api.example.com/v1` |

A path starting with `/` replaces the base path. A relative path is appended, treating the base as a directory. If `path` declares a full URL, it must preserve the origin of `baseUrl`.

Path placeholders use `{name}`, with names containing letters, numbers, `_`, and `-`. Every name used requires an entry in `pathParams`. Pass the value without encoding: the adapter applies `encodeURIComponent`. `/`, `?`, `#`, and spaces inside a parameter are encoded; the exact values `.` and `..` are rejected.

The final URL cannot change the configured origin or add credentials or fragments. The MCP client cannot choose the host through `${input...}` in `baseUrl`.

## Query, headers, and body

Query **fragment**:

```yaml
query:
  limit: '${input.limit}'
  active: '${input.active}'
  tag: [backend, 'needs review']
  unused: null
```

With `limit: 10` and `active: true`, this produces `limit=10&active=true&tag=backend&tag=needs+review`. Lists repeat the key; `null` omits the entire key. Nested objects and `null` elements inside query/form lists are not supported. Expose pagination through arguments such as `limit`, `offset`, or `cursor`; the server does not traverse pages automatically.

JSON write **fragment**, assuming the fields are declared in `inputSchema`:

```yaml
execution:
  type: http
  baseUrl: '${env.API_BASE_URL}'
  path: /users
  method: POST
  bodyEncoding: json
  body:
    name: '${input.name}'
    enabled: '${input.enabled}'
    tags: '${input.tags}'
  successStatuses: [201]
```

| Encoding | Expected body | Applied Content-Type |
| --- | --- | --- |
| `json` | Any resolvable JSON value | `application/json` |
| `form` | Object of scalars/lists of scalars | `application/x-www-form-urlencoded` |
| `text` | String, finite number, or boolean | `text/plain; charset=utf-8` |

When a body is present, the adapter sets Content-Type according to `bodyEncoding`, replacing any Content-Type configured in headers. Auth profiles apply over headers/query and replace credentials with the same name. Avoid using `Content-Type` as an API key name: body encoding also controls that header.

## Response and errors

Axios captures the response as text. `response.parser` determines how to interpret it; the parser is not selected automatically from Content-Type.

Statuses outside `successStatuses` produce an error such as `[execution] The API returned HTTP 404.`. The remote error body is neither exposed nor passed through the transformation. To treat a particular status as a structured result, explicitly include it in `successStatuses` and adapt the parser/schema to the actual contract.

A 204/HEAD response may have an empty body, causing the JSON parser to fail. If that is the expected contract, use this **fragment** and an `outputSchema` with `ok: boolean`:

```yaml
response:
  parser: { type: text }
  transform: '{"ok": true}'
```

Redirects are not followed, failures are not retried, and the outgoing proxy from environment variables is not used (`proxy: false`). TLS retains Node/Axios certificate verification. Cancellation, a deadline, or exceeding the byte limit ends the request with an error.

Continue with [Authentication](authentication.md) and [Responses](responses.md).
