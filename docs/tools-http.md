# Tools HTTP: adaptar una API REST

[English](en/tools-http.md)

[Volver al índice](README.md) · [Configuración común](configuracion.md)

Cada tool HTTP realiza un request mediante Axios. Los argumentos MCP se mapean explícitamente a ruta, query, headers o body. El servidor no descubre endpoints ni importa OpenAPI automáticamente.

## Referencia de `execution`

| Campo | Tipo / default | Uso |
| --- | --- | --- |
| `type` | Literal `http` | Selecciona el adaptador. |
| `baseUrl` | String obligatorio | HTTP/HTTPS fijo o desde entorno. Sin query, fragmento o credenciales embebidas. |
| `method` | `GET` | GET, POST, PUT, PATCH, DELETE, HEAD u OPTIONS. |
| `path` | String, `""` | Ruta fija con placeholders `{nombre}` opcionales. |
| `pathParams` | Objeto, `{}` | Valores de placeholders, con plantillas opcionales. |
| `query` | Objeto, `{}` | Parámetros de consulta. |
| `headers` | Mapa de strings, `{}` | Nombres fijos, valores con plantillas opcionales. |
| `body` | Valor JSON, omitido | Cuerpo con plantillas opcionales. |
| `bodyEncoding` | `json` | También `form` o `text`. |
| `auth` | Nombre de perfil, omitido | Referencia a `auth.<nombre>`; no admite selección dinámica por input. |
| `successStatuses` | Lista de enteros, omitida | Sin lista se aceptan 200–299. Una lista reemplaza ese rango. |
| `timeoutMs` | Hereda del servidor | Deadline de tool y timeout del request. |
| `maxOutputBytes` | Hereda del servidor | Límite de body, respuesta capturada y resultado. |

No se acepta un objeto Axios arbitrario: solo los campos declarados arriba. Opciones como interceptores, agentes TLS, proxy, multipart, redirects y retries no tienen configuración pública en esta versión.

## Ejemplo completo: obtener un usuario

Guardar como `usuario.yaml` en la raíz. El contrato remoto esperado es un endpoint `GET /users/{id}` que devuelve un objeto con `id` y `name`.

```yaml
version: 1
auth:
  users_service:
    type: bearer
    token: '${env.API_TOKEN}'
tools:
  - name: users_get
    description: Consulta un usuario por su identificador y devuelve ID y nombre.
    inputSchema:
      type: object
      properties:
        id: { type: string, minLength: 1, description: Identificador del usuario. }
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

Definir `API_BASE_URL` y `API_TOKEN` en el entorno o en `.env`, con los datos del servicio real:

```sh
node --env-file=.env dist/cli.js validate --config usuario.yaml
node --env-file=.env dist/cli.js serve --config usuario.yaml
```

Argumentos MCP: `{"id":"42"}`. Si la API devuelve `{"id":42,"name":"Ada","email":"ada@example.org"}`, la tool devuelve `{"id":"42","name":"Ada"}`. El esquema comprueba el resultado después de la transformación.

El repositorio también incluye [examples/http.yaml](../examples/http.yaml), preparado para servir por HTTP.

## Ejemplo Jira Cloud

[examples/jira.json](../examples/jira.json) publica cuatro tools con requests GET a Jira Cloud REST API v3:

| Tool | Uso |
| --- | --- |
| `jira_search_issues` | Buscar tickets con JQL y recorrer páginas por token. |
| `jira_get_issue` | Consultar detalle, descripción, responsables, estado y fechas. |
| `jira_list_issue_comments` | Leer comentarios paginados. |
| `jira_list_issue_changelog` | Revisar cambios de campos paginados. |

Configurar `JIRA_BASE_URL`, `JIRA_EMAIL` y `JIRA_API_TOKEN` en `.env`, usando [.env.example](../.env.example) como referencia. La autenticación Basic usa el correo de Atlassian y un API token, no la contraseña de la cuenta. Para tokens sin scopes, la base es `https://your-domain.atlassian.net`; para tokens con scopes, usar `https://api.atlassian.com/ex/jira/YOUR_CLOUD_ID` y permisos de lectura adecuados. Las rutas del ejemplo son relativas para preservar ese prefijo. Ver [autenticación](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/) y [tokens de Atlassian](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/).

Desde la raíz del proyecto, con las dependencias instaladas:

```sh
npm run build
node --env-file=.env dist/cli.js validate --config examples/jira.json
npx -y @modelcontextprotocol/inspector node -- \
  --env-file=.env dist/cli.js serve --config examples/jira.json --transport stdio
```

Argumentos de ejemplo para `jira_search_issues`:

```json
{"jql":"project = DEMO ORDER BY updated DESC","maxResults":25,"nextPageToken":null}
```

Reemplazar `DEMO` por un proyecto real. En la siguiente página enviar el token recibido con el mismo JQL; terminar cuando `isLast` sea `true`. Se usa la [búsqueda mejorada `search/jql`](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-jql-get), sin inventar un total de resultados. Los cambios recientes pueden tardar en aparecer.

Para detalle, enviar `{"issueIdOrKey":"DEMO-42"}`. Para comentarios o historial, enviar `{"issueIdOrKey":"DEMO-42","startAt":0,"maxResults":25}` y continuar con `nextStartAt` hasta que sea `null`. Todos los argumentos mostrados son obligatorios: el runtime no aplica defaults de los esquemas de entrada. Si llega una página vacía, detenerse aunque el total haya cambiado durante la consulta.

Las descripciones y los comentarios mantienen su estructura ADF. Las transformaciones seleccionan campos útiles y conservan listas vacías o de un elemento. El acceso depende de los permisos de la cuenta y las restricciones del ticket/comentario. El ejemplo está dirigido a Jira Cloud; no presupone compatibilidad con Jira Data Center. `validate` comprueba la configuración, pero no verifica credenciales ni conectividad reales.

### Diagnosticar errores de Jira

El runtime muestra el estado HTTP sin publicar el body de error del servicio. Para investigar un 400/404 localmente, ejecutar el diagnóstico con una clave real de ticket y su proyecto; `PROJECT-123` y `PROJECT` son marcadores a reemplazar:

```sh
node --env-file=.env scripts/diagnose-jira.mjs \
  --issue PROJECT-123 --jql 'project = PROJECT ORDER BY updated DESC'
```

Requiere la compilación en `dist/`. Lee `examples/jira.json`, comprueba la identidad con `GET /rest/api/3/myself` y reproduce las consultas de detalle/búsqueda con el mismo mapeo y autenticación. La búsqueda diagnóstica usa la primera página con un máximo de un resultado. Sin argumentos, solo comprueba identidad. No modifica tickets.

La salida incluye estados y los campos `errorMessages`, `errors` o `message` devueltos por Jira; oculta los valores de las credenciales y no imprime cuerpos completos, tickets ni headers. Termina con código `1` si alguna comprobación falla. El runtime MCP conserva sus mensajes habituales.

Un 404 puede indicar ticket inexistente o no visible para la cuenta. Un 400 requiere leer el mensaje de Jira: por ejemplo, JQL inválido, proyecto desconocido/no accesible o cursor inválido. Usar un ticket que la cuenta del API token pueda abrir y reemplazar los valores `DEMO` de los ejemplos. Un fallo de `/myself` también puede deberse a los scopes específicos de ese endpoint; no demuestra por sí solo que todas las tools carezcan de acceso. Ver [diagnóstico HTTP de Atlassian](https://support.atlassian.com/jira/kb/webhooks-or-web-requests-fail-with-http-status-code-400-401-or-403-in-jira/).

## Construcción de la URL

Con `baseUrl: https://api.example.com/v1`:

| `path` | URL resultante |
| --- | --- |
| `users` | `https://api.example.com/v1/users` |
| `/users` | `https://api.example.com/users` |
| Vacío | `https://api.example.com/v1` |

Una ruta con `/` inicial reemplaza el path de la base. Una ruta relativa se agrega tratando la base como directorio. Si se declara una URL completa en `path`, debe conservar el mismo origen de `baseUrl`.

Los placeholders de ruta usan `{nombre}`, y sus nombres admiten letras, números, `_` y `-`. Cada nombre utilizado necesita una entrada en `pathParams`. Pasar el valor sin codificar: el adaptador aplica `encodeURIComponent`. `/`, `?`, `#` y espacios dentro de un parámetro se codifican; los valores exactos `.` y `..` se rechazan.

La URL final no puede cambiar el origen configurado ni incorporar credenciales o fragmentos. El cliente MCP no puede decidir el host mediante `${input...}` en `baseUrl`.

## Query, headers y body

**Fragmento** de consulta:

```yaml
query:
  limit: '${input.limit}'
  active: '${input.active}'
  tag: [backend, 'needs review']
  unused: null
```

Con `limit: 10` y `active: true`, se genera `limit=10&active=true&tag=backend&tag=needs+review`. Las listas repiten la clave; `null` omite la clave completa. No se admiten objetos anidados ni elementos `null` dentro de listas de query/formulario. La paginación se expone mediante argumentos como `limit`, `offset` o `cursor`; el servidor no recorre páginas automáticamente.

**Fragmento** de escritura JSON, suponiendo que los campos están declarados en `inputSchema`:

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

| Codificación | Body esperado | Content-Type aplicado |
| --- | --- | --- |
| `json` | Cualquier valor JSON resoluble | `application/json` |
| `form` | Objeto de escalares/listas de escalares | `application/x-www-form-urlencoded` |
| `text` | String, número finito o booleano | `text/plain; charset=utf-8` |

Cuando hay body, el adaptador establece su Content-Type según `bodyEncoding`, reemplazando un Content-Type configurado en headers. Los perfiles de auth se aplican sobre headers/query y reemplazan credenciales del mismo nombre. Evitar usar `Content-Type` como nombre de una API key: es un header controlado también por la codificación del body.

## Respuesta y errores

Axios captura la respuesta como texto. `response.parser` decide cómo interpretarla; no se selecciona automáticamente según Content-Type.

Los estados fuera de `successStatuses` producen un error como `[execution] The API returned HTTP 404.`. El body de error remoto no se publica ni pasa por la transformación. Para tratar un estado específico como un resultado estructurado, incluirlo explícitamente en `successStatuses` y adaptar parser/esquema al contrato real.

Una respuesta 204/HEAD puede tener body vacío: el parser JSON fallará. Si ese es el contrato esperado, usar este **fragmento** y un `outputSchema` con `ok: boolean`:

```yaml
response:
  parser: { type: text }
  transform: '{"ok": true}'
```

No se siguen redirecciones, no se reintentan fallos y no se usa el proxy saliente de variables de entorno (`proxy: false`). TLS conserva la verificación de certificados de Node/Axios. Cancelación, deadline o exceso de bytes terminan el request con error.

Continuar con [Autenticación](autenticacion.md) y [Respuestas](respuestas.md).
