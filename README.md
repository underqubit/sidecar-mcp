# Underqubit Sidecar MCP

[English](README.en.md) · [Documentación en español](docs/README.md)

Servidor MCP en Node.js 24 y TypeScript que convierte APIs REST y CLIs existentes en tools declaradas en YAML o JSON. Agregar una tool no requiere programar ni recompilar: editar la configuración y reiniciar el proceso.

Soporta stdio y Streamable HTTP, autenticación de servicio, JSON Schema de entrada/salida y transformación de respuestas con JSONata.

La documentación completa está en [docs/README.md](docs/README.md): guías de uso, referencia de configuración, autenticación, respuestas, arquitectura, desarrollo y operación.

Para agentes de IA, la skill de uso está en [skills/underqubit-sidecar-mcp/SKILL.md](skills/underqubit-sidecar-mcp/SKILL.md), en inglés.

## Inicio rápido

```sh
npm ci
npm run build
node dist/cli.js validate --config examples/cli.yaml
node dist/cli.js serve --config examples/cli.yaml
```

El último comando inicia MCP por stdio: espera mensajes de un cliente MCP, no comandos escritos en la terminal. El ejemplo expone `local_node_version` y `local_echo` sin necesitar secretos ni servicios externos.

Para probar las tools desde una interfaz web, seguir la guía de [MCP Inspector](docs/inicio-rapido.md#probar-con-mcp-inspector), con ejemplos locales y de API REST usando `.env`.

Configuración de un cliente MCP con soporte de stdio (reemplazar las rutas):

```json
{
  "mcpServers": {
    "underqubit": {
      "command": "node",
      "args": [
        "/ruta/underqubit-sidecar-mcp/dist/cli.js",
        "serve", "--config", "/ruta/underqubit-sidecar-mcp/examples/cli.yaml"
      ]
    }
  }
}
```

Para HTTP:

```sh
node dist/cli.js serve --config examples/cli.yaml --transport http
```

Endpoint predeterminado: `http://127.0.0.1:3000/mcp`. El transporte HTTP es stateless y usa una instancia MCP por request; el núcleo de ejecución y la caché OAuth son compartidos. El SDK atiende clientes modernos y clientes con handshake MCP 2025.

## Configuración

La definición completa para el editor está en [schema/config.schema.json](schema/config.schema.json). YAML puede incluir:

```yaml
# yaml-language-server: $schema=../schema/config.schema.json
version: 1
server:
  name: underqubit-sidecar-mcp
  version: 0.1.0
  transport: stdio
  timeoutMs: 30000
  maxOutputBytes: 1048576
  http:
    host: 127.0.0.1
    port: 3000
    allowedHosts: [127.0.0.1, localhost, '[::1]']
    allowedOrigins: []
    maxRequestBytes: 1048576
auth: {}
tools: [] # Reemplazar por al menos una tool.
```

`version: 1` identifica el formato de configuración. Se rechazan claves desconocidas, nombres duplicados, JSON Schemas inválidos, perfiles inexistentes, expresiones inválidas y variables de entorno ausentes o vacías. YAML no admite aliases ni claves duplicadas. El archivo tiene un máximo de 4 MiB.

`validate` realiza las mismas comprobaciones que el arranque, incluyendo compilación de regex/JSONata y presencia de variables. No ejecuta CLIs, no llama APIs y no obtiene tokens. No comprueba conectividad ni existencia del ejecutable. No hay recarga automática.

### Contrato de una tool

| Campo | Descripción |
| --- | --- |
| `name` | Único, 1–128 caracteres: letras ASCII, números, `_`, `-`, `.`. |
| `description` | Descripción de la operación visible al modelo. Obligatoria. |
| `title` | Título opcional para clientes MCP. |
| `inputSchema` / `outputSchema` | JSON Schema 2020-12, raíz `type: object`. Ambos obligatorios. |
| `annotations` | `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`; opcionales, informativos. |
| `execution` | Configuración HTTP o CLI. |
| `response` | Parser y transformación opcional. Por defecto, parser JSON. |

Zod valida la configuración; AJV valida las entradas y salidas de cada tool. Los JSON Schemas admiten `$defs` y referencias internas `#...`; no referencias remotas ni validadores asíncronos. La validación no convierte tipos, agrega defaults ni elimina propiedades. Para rechazar campos extra, declarar `additionalProperties: false`.

### Plantillas

- `${input.campo}` toma un argumento de la tool; se permiten rutas como `${input.user.id}` y `${input.items.0}`.
- `${env.VARIABLE}` toma una variable de entorno declarada en configuración. Se captura al iniciar y no se expone al modelo.
- Una referencia que ocupa todo el valor conserva su tipo, incluidos objetos, listas, booleanos y números.
- Dentro de texto (`user-${input.id}`), solo se admiten strings, números y booleanos. Las claves de objetos no se interpolan.
- Referencias ausentes fallan explícitamente. No hay expresiones JavaScript, evaluación recursiva del texto recibido, ni sustituciones de shell.

Los campos que permiten plantillas son los parámetros de ejecución y credenciales. Descripciones, JSON Schemas, regex y expresiones JSONata no se interpolan. Ejecutable, directorio y origen HTTP no aceptan argumentos de entrada.

## APIs REST con Axios

Ejemplo completo: [examples/http.yaml](examples/http.yaml).

```yaml
execution:
  type: http
  baseUrl: '${env.API_BASE_URL}'
  method: POST
  path: /users/{id}
  pathParams: { id: '${input.id}' }
  query: { active: true, tag: [a, b] }
  headers: { Accept: application/json }
  body: { name: '${input.name}', enabled: '${input.enabled}' }
  bodyEncoding: json
  auth: service
  timeoutMs: 10000
  maxOutputBytes: 1048576
```

- Métodos: GET (predeterminado), POST, PUT, PATCH, DELETE, HEAD y OPTIONS.
- `baseUrl` requiere HTTP/HTTPS sin credenciales, query ni fragmento. Una ruta con `/` inicial parte de la raíz; una ruta relativa se agrega al path de `baseUrl`.
- `{id}` se resuelve desde `pathParams` y se codifica como segmento de URL. El origen no puede cambiar. Query y formularios aceptan escalares o listas de escalares; las listas repiten la clave y `null` omite el parámetro.
- `bodyEncoding`: `json`, `form` (URL-encoded) o `text`. Se configura el Content-Type correspondiente. No hay multipart ni archivos binarios.
- `successStatuses` puede sustituir el rango 200–299 predeterminado, por ejemplo `[200, 201]`.
- Sin reintentos, redirecciones ni proxy saliente implícito del entorno. La verificación TLS usa los defaults de Node/Axios.
- El límite de bytes también limita el cuerpo enviado. El deadline global incluye la obtención de credenciales, ejecución y procesamiento de respuesta.

## CLIs locales

Ejemplos completos: [examples/cli.yaml](examples/cli.yaml) y [examples/cli.json](examples/cli.json).

```yaml
execution:
  type: cli
  command: existing-cli
  args: [show, '${input.id}', --format, json]
  cwd: .
  env:
    SERVICE_TOKEN: '${env.SERVICE_TOKEN}'
  stdin:
    options: '${input.options}'
  successExitCodes: [0]
```

La ejecución usa `spawn` con `shell: false`. Cada elemento de `args` es un argumento literal: espacios, comillas y metacaracteres no crean comandos adicionales. No se admiten pipelines de shell. El ejecutable debe ser nativo o invocarse mediante su intérprete, por ejemplo `node` más la ruta de un script.

`cwd` y rutas de ejecutable con separadores se resuelven respecto del archivo de configuración. Un nombre de ejecutable sin separadores se busca en PATH. Las rutas dentro de `args` las interpreta el CLI con su `cwd`.

Solo se heredan `PATH`, `SystemRoot`, `WINDIR`, `TMPDIR`, `TEMP`, `TMP` y `LANG`; el resto se declara en `env`. Para usar credenciales del CLI almacenadas en el home del usuario, declarar `HOME: '${env.HOME}'` explícitamente. `stdin` se envía literalmente si es string o serializado como JSON si es otro tipo; luego se cierra.

Stdout alimenta el parser. Stderr se drena y cuenta para el límite conjunto de bytes, pero no se devuelve ni se registra: los errores contienen el código de salida. La cancelación termina el proceso y, en POSIX, su grupo de procesos; tras 250 ms escala de SIGTERM a SIGKILL. En Windows se termina el proceso directo; no se garantiza terminar descendientes independientes.

## Autenticación

Los perfiles se declaran bajo `auth` y cada ejecución HTTP selecciona uno por nombre. Si se omite `auth`, no se agregan credenciales. El perfil prevalece sobre un header o query configurado con el mismo nombre.

| Tipo | Campos |
| --- | --- |
| `none` | Sin campos adicionales. |
| `apiKey` | `in: header\|query`, `name`, `value: '${env.API_KEY}'`. |
| `bearer` | `token: '${env.API_TOKEN}'`. |
| `basic` | `username: '${env.API_USERNAME}'`, `password: '${env.API_PASSWORD}'`. |
| `oauth2` | `tokenUrl`, `clientId`, `clientSecret`, `scopes`, `tokenAuthMethod: basic\|body`, `timeoutMs`. |

Los secretos de los perfiles requieren referencias de entorno, no literales. [examples/auth.yaml](examples/auth.yaml) muestra todas las variantes. Los CLIs reciben credenciales por `env` o `stdin`, usando la autenticación que ya soporte cada programa.

OAuth2 usa `grant_type=client_credentials`. Comparte solicitudes concurrentes de token, mantiene la caché en memoria y renueva antes de `expires_in`. Si no hay expiración válida, no cachea el token. Solo admite tokens de tipo Bearer; el timeout del endpoint es de 10 segundos por defecto. No persiste tokens ni implementa login por usuario.

Node puede cargar `.env` explícitamente:

```sh
node --env-file=.env dist/cli.js validate --config examples/http.yaml
node --env-file=.env dist/cli.js serve --config examples/http.yaml
```

Usar [.env.example](.env.example) como referencia. Se comprueban todas las variables referenciadas, incluso en perfiles que ninguna tool usa todavía.

## Parseo y transformación

```yaml
response:
  parser: { type: json }
  transform: '{"users": [data.items.{"id": $string(id), "name": name}]}'
  workerTimeoutMs: 1000
```

| Parser | Resultado previo a la transformación |
| --- | --- |
| `json` | JSON parseado; formato predeterminado, también para HTTP. |
| `text` | String completo. Ejemplo de transformación: `{"text": $trim(data)}`. |
| `regex` | Grupos nombrados de la primera coincidencia (`mode: first`) o lista de grupos (`mode: all`). |

Regex usa `pattern`, `flags` opcionales (`i`, `m`, `s`, `u`) y `mode`. Requiere grupos nombrados, por ejemplo `(?<name>\w+)=(?<count>\d+)`. En modo `first`, no encontrar coincidencia es error; en `all`, devuelve lista vacía. Los grupos capturados son strings: convertir números explícitamente con `$number(...)`.

JSONata recibe `{data, metadata}`. Para HTTP, metadata contiene `status` y los headers `content-type`/`retry-after`; para CLI, `exitCode`. No recibe los argumentos, credenciales, entorno, cookies ni stderr. Si se omite `transform`, el dato parseado se valida directamente.

Entrada y salida MCP tienen raíz objeto. Envolver listas en `{"items": data}` o texto en `{"text": data}` cuando sea necesario. Un resultado JSONata ausente, error de parseo o incumplimiento de `outputSchema` devuelve error de tool; no se convierte silenciosamente ni se trunca.

Regex y JSONata corren en workers terminables, con entorno vacío, presupuesto predeterminado de un segundo y 64 MiB de heap. No se registran funciones de acceso a filesystem o red. El presupuesto del worker también incluye su inicio y la serialización.

## Operación

Flujo: **validar entrada → resolver parámetros/credenciales → ejecutar → parsear → transformar → validar salida → responder MCP**.

Las respuestas correctas incluyen `structuredContent` y un bloque textual con el mismo JSON. Los fallos de tool usan `isError: true` y una etapa (`input`, `parameters`, `auth`, `execution`, `parse`, `transform`, `output`). Errores del protocolo los gestiona el SDK.

Logs JSON por stderr: tool, duración, resultado y etapa de error. No se registran bodies, argumentos ni credenciales. Stdout queda reservado para MCP en modo stdio. SIGINT, SIGTERM y cierre de stdin cancelan el trabajo activo y liberan recursos.

La configuración y los CLIs son administrados por un operador de confianza. El servidor ejecuta las operaciones autorizadas por esa configuración con los permisos del usuario del proceso; no es un sandbox de programas arbitrarios.

HTTP escucha en loopback por defecto. Para acceso externo, configurar bind, `allowedHosts` y un proxy que aplique TLS/autenticación y restrinja el acceso directo al backend. El servidor no implementa autenticación entrante ni usuarios propios. `allowedHosts` compara hostname sin puerto; `allowedOrigins` compara el origen completo. Requests sin Origin son válidos; un Origin presente pero vacío o `null` se rechaza. Las mismas validaciones se aplican al handler fetch y al servidor Node. CORS no se habilita automáticamente.

## Desarrollo y pruebas

```sh
npm run check          # build, typecheck y suite sin puertos TCP
npm run test:network   # integración con servidores HTTP reales en localhost
npm run schema        # regenera el JSON Schema de configuración
```

Las pruebas se ejecutan contra `dist`, incluido el worker distribuido. La suite predeterminada usa Axios con interceptores HTTP, un cliente MCP real por stdio y el transporte Streamable HTTP mediante fetch en memoria. Las pruebas TCP separadas verifican sockets, Host/Origin y límites de requests, y necesitan permiso para abrir puertos. No llaman servicios externos ni requieren credenciales reales.

Los módulos de `src` separan configuración, plantillas, autenticación, adaptadores, procesamiento de respuesta, runtime y transporte. Para cambios de configuración, actualizar Zod y regenerar `schema/config.schema.json`.

[evaluations/questions.xml](evaluations/questions.xml) contiene diez preguntas de solo lectura sobre una muestra operativa fija. Para evaluar el uso de las tools por un agente, conectarlo con `--config tests/fixtures/evaluation.yaml`. La suite verifica las respuestas esperadas mediante llamadas MCP reales; no ejecuta una evaluación con un modelo externo ni genera costos de API.

Fuera de esta versión: recarga en caliente, importación OpenAPI, OAuth por usuario, pipelines de múltiples ejecuciones, CSV/XML, multipart y archivos binarios.

Referencias: [SDK MCP v2](https://ts.sdk.modelcontextprotocol.io/v2/), [JSON Schema](https://json-schema.org/draft/2020-12), [JSONata](https://docs.jsonata.org/overview), [Axios](https://axios-http.com/docs/req_config).
