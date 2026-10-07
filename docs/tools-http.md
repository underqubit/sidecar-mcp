# Tools HTTP: adaptar una API REST

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

Los estados fuera de `successStatuses` producen un error como `[execution] La API respondió HTTP 404.`. El body de error remoto no se publica ni pasa por la transformación. Para tratar un estado específico como un resultado estructurado, incluirlo explícitamente en `successStatuses` y adaptar parser/esquema al contrato real.

Una respuesta 204/HEAD puede tener body vacío: el parser JSON fallará. Si ese es el contrato esperado, usar este **fragmento** y un `outputSchema` con `ok: boolean`:

```yaml
response:
  parser: { type: text }
  transform: '{"ok": true}'
```

No se siguen redirecciones, no se reintentan fallos y no se usa el proxy saliente de variables de entorno (`proxy: false`). TLS conserva la verificación de certificados de Node/Axios. Cancelación, deadline o exceso de bytes terminan el request con error.

Continuar con [Autenticación](autenticacion.md) y [Respuestas](respuestas.md).
