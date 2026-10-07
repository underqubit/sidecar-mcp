# Authentication and environment variables

[Back to index](README.md) · [Español](../autenticacion.md)

Authentication has two directions: **MCP server to external services** and **client to the MCP endpoint**. The `auth` profiles handle the first. Incoming HTTP access is delegated to a private network or proxy; declaring an API profile does not protect it.

## Declare and select profiles

Configuration **fragment**:

```yaml
auth:
  backend:
    type: bearer
    token: '${env.API_TOKEN}'
```

An HTTP tool selects that profile with `execution.auth: backend`. The name is literal. Tools can share a profile. If `execution.auth` is omitted or a `type: none` profile is selected, no credentials are added; headers explicitly declared in the configuration remain in place.

Secrets require a complete `${env.VARIABLE}` reference with a conventional variable name. Literal secrets, partial interpolation, and `${input...}` arguments are not accepted in these fields. Configuration and references are not advertised to the model as MCP parameters.

## Available types

The following are **fragments** of the `auth` map:

```yaml
auth:
  public_api:
    type: none

  key_in_header:
    type: apiKey
    in: header
    name: X-API-Key
    value: '${env.API_KEY}'

  key_in_query:
    type: apiKey
    in: query
    name: api_key
    value: '${env.API_KEY}'

  fixed_token:
    type: bearer
    token: '${env.API_TOKEN}'

  username_password:
    type: basic
    username: '${env.API_USERNAME}'
    password: '${env.API_PASSWORD}'

  service_oauth:
    type: oauth2
    tokenUrl: '${env.OAUTH_TOKEN_URL}'
    clientId: '${env.OAUTH_CLIENT_ID}'
    clientSecret: '${env.OAUTH_CLIENT_SECRET}'
    scopes: [users.read]
    tokenAuthMethod: basic
    timeoutMs: 10000
```

| Type | Behavior |
| --- | --- |
| `apiKey` | Inserts the secret into a header or query parameter with a fixed name. |
| `bearer` | Writes `Authorization: Bearer <token>`. The environment value must contain only the token. |
| `basic` | Builds `Authorization: Basic ...` from the username and password. |
| `oauth2` | Obtains an access token using client credentials and sends it as Bearer. |
| `none` | Does not modify request authentication. |

Auth replaces an existing header/query parameter of the same name. The HTTP adapter subsequently sets Content-Type when sending a body; do not use that header for an API key. A tool cannot select a list of multiple profiles.

## OAuth2 client credentials

The adapter sends a form URL-encoded POST to `tokenUrl` with `grant_type=client_credentials`. `scopes` is a list of literal strings joined with spaces in `scope`. If empty, that field is omitted.

| Field | Required / default |
| --- | --- |
| `tokenUrl` | Required; HTTP/HTTPS without embedded username/password or a fragment. Fixed or from the environment. |
| `clientId` | Required environment reference. |
| `clientSecret` | Required environment reference. |
| `scopes` | `[]`. |
| `tokenAuthMethod` | `basic`; alternative: `body`. |
| `timeoutMs` | `10000`. |

With `basic`, credentials are encoded for the OAuth endpoint's Basic header. With `body`, they are sent as `client_id` and `client_secret` in the form.

The response must be a JSON object with a nonempty string `access_token` and `token_type` equal to Bearer, case-insensitively. A numeric, finite, positive `expires_in` enables caching. If it is missing or invalid, the token is used for consumers of that retrieval but is not retained for future calls.

The cache lives in memory, per profile and process. Its effective lifetime subtracts the smaller of 30 seconds or 10% of the TTL. There is no renewal timer: a subsequent call requests another token when the previous one is no longer valid.

Concurrent calls to the same profile share a pending retrieval. Canceling one consumer does not cancel the others; when no consumers remain, retrieval is aborted. Closing the runtime cancels pending requests and clears the cache.

The OAuth endpoint accepts only 2xx statuses, does not follow redirects, and limits requests/responses to 64 KiB. There are no refresh tokens, persistence, interactive login, per-user storage, or automatic operation retries after a service returns 401.

## CLI credentials

The existing CLI implements authentication. Use `execution.env` or `execution.stdin` according to its contract. **Fragment**:

```yaml
execution:
  type: cli
  command: service-cli
  args: [account, show, --json]
  env:
    SERVICE_TOKEN: '${env.SERVICE_TOKEN}'
    HOME: '${env.HOME}'
```

If the program reads a JSON object from stdin, the body could be `stdin: {token: '${env.SERVICE_TOKEN}'}`. This only works if the CLI documents that protocol. No login format is injected automatically.

## Load and rotate secrets

The process can receive variables from its supervisor, stdio client, or Node with `--env-file`. There is no automatic `.env` loading or external secret manager resolution.

```sh
node --env-file=.env dist/cli.js validate --config examples/auth.yaml
node --env-file=.env dist/cli.js serve --config examples/auth.yaml
```

[examples/auth.yaml](../../examples/auth.yaml) includes all profiles, so it requires all their variables, even if a tool only uses OAuth. [.env.example](../../.env.example) contains sample names and values, not operational credentials.

To rotate credentials, update the process environment and restart it. Editing an `.env` file while the server is running is not sufficient.

Error messages avoid printing auth bodies and secrets. Successful responses come from the API or CLI: there is no universal filter that removes credentials if the service itself returns them. Select only the necessary fields in the transformation and output schema.

## Incoming MCP authentication

`allowedHosts` and `allowedOrigins` check request destinations and origins; they do not identify or authorize people. Incoming Bearer tokens are not validated, there is no built-in login, and incoming OAuth discovery is not implemented.

When exposing HTTP, the proxy must authenticate clients and restrict direct backend access. Accepted clients share the process configuration and service credentials. See [Operations and troubleshooting](operations-and-troubleshooting.md).
