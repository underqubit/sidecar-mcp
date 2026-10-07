# Referencia de configuración

[Volver al índice](README.md)

## Formato y validación

Se carga un único archivo YAML o JSON, de hasta 4 MiB. No hay includes, mezcla de archivos ni recarga en caliente. YAML rechaza claves duplicadas y aliases. Los bloques de configuración son estrictos: una clave desconocida es un error, excepto dentro de los documentos JSON Schema de entrada/salida.

Zod valida el archivo de configuración y aplica sus defaults. AJV valida los esquemas y los datos de las tools. Son dos niveles diferentes: los defaults de configuración sí se aplican; un `default` dentro de `inputSchema` no rellena automáticamente un argumento faltante.

Para asistencia en el editor, agregar el comentario siguiente a un YAML ubicado, por ejemplo, en `examples/`:

```yaml
# yaml-language-server: $schema=../schema/config.schema.json
```

En JSON se puede declarar `"$schema": "../schema/config.schema.json"`. Ajustar la ruta según la ubicación del archivo. El esquema generado ayuda al editor, pero no sustituye las comprobaciones semánticas del comando `validate`.

## Raíz

| Campo | Tipo | Obligatorio / default |
| --- | --- | --- |
| `version` | Entero literal `1` | Obligatorio; versión del formato, no del protocolo MCP. |
| `$schema` | String | Opcional; referencia para el editor. |
| `server` | Objeto | Opcional; aplica los defaults de la sección siguiente. |
| `auth` | Mapa de perfiles por nombre | Opcional; `{}`. Ver [Autenticación](autenticacion.md). |
| `tools` | Lista de tools | Obligatorio; al menos una. |

## Servidor

| Campo en `server` | Tipo | Default | Significado |
| --- | --- | --- | --- |
| `name` | String no vacío | `underqubit-sidecar-mcp` | Identidad publicada al cliente MCP. |
| `version` | String no vacío | `0.1.0` | Versión publicada del servidor. |
| `transport` | `stdio` o `http` | `stdio` | Puede sobrescribirse con `--transport`. |
| `timeoutMs` | Entero positivo | `30000` | Deadline de ejecución por tool, salvo override. |
| `maxOutputBytes` | Entero positivo | `1048576` | Límite de bytes por tool, salvo override. |
| `http` | Objeto | Defaults de abajo | Solo se usa para servir por HTTP. |

| Campo en `server.http` | Default | Significado |
| --- | --- | --- |
| `host` | `127.0.0.1` | Interfaz de escucha. |
| `port` | `3000` | Entero entre 0 y 65535; `0` pide un puerto disponible al sistema. |
| `allowedHosts` | `[127.0.0.1, localhost, '[::1]']` | Hostnames aceptados, sin puerto. No son patrones ni rangos de IP. |
| `allowedOrigins` | `[]` | Lista de orígenes completos permitidos, comparados exactamente. Sin Origin se permite continuar. |
| `maxRequestBytes` | `1048576` | Tamaño máximo del body HTTP entrante a MCP. |

La ruta MCP es fija: `/mcp`. No existen flags CLI para cambiar host o puerto; se editan en el archivo. `allowedHosts` no autentica usuarios. Ver [Operación HTTP](operacion-y-diagnostico.md).

**Fragmento** de servidor HTTP:

```yaml
server:
  transport: http
  timeoutMs: 30000
  http:
    host: 127.0.0.1
    port: 3000
    allowedHosts: [localhost, 127.0.0.1, mcp.example.com]
    allowedOrigins: [https://console.example.com]
```

## Tool

| Campo | Requisito |
| --- | --- |
| `name` | Único dentro del servidor, 1–128 caracteres, patrón `^[A-Za-z0-9_.-]{1,128}$`. Distingue mayúsculas/minúsculas. |
| `description` | String no vacío; explicar qué hace, cuándo usarla y qué devuelve. |
| `title` | String no vacío opcional. |
| `inputSchema` | JSON Schema con raíz `type: object`. Obligatorio. |
| `outputSchema` | JSON Schema con raíz `type: object`. Obligatorio. |
| `annotations` | Objeto opcional de hints MCP. |
| `execution` | Objeto con `type: http` o `type: cli`. Obligatorio. |
| `response` | Objeto opcional; parser JSON y worker de 1000 ms por defecto. |

`annotations` acepta únicamente `readOnlyHint`, `destructiveHint`, `idempotentHint` y `openWorldHint`, todos booleanos opcionales. No se deducen del método HTTP o del comando. Son información para el cliente, no restricciones de ejecución.

Las tools se publican ordenadas por nombre. Solo nombre, descripción, título, anotaciones y esquemas forman parte de la definición MCP; `execution` y los perfiles de autenticación no se publican como argumentos.

## JSON Schema de entrada y salida

Se utiliza draft 2020-12 con AJV en modo estricto y formatos de `ajv-formats`. Se admiten referencias internas, como `#/$defs/user`, y combinaciones estándar compatibles con ese validador. No se descargan esquemas remotos ni se admiten validadores asíncronos `$async`.

**Fragmento** de entrada:

```yaml
inputSchema:
  type: object
  properties:
    id:
      type: string
      minLength: 1
      description: Identificador del usuario.
    limit:
      type: integer
      minimum: 1
      maximum: 100
  required: [id, limit]
  additionalProperties: false
```

El cliente debe enviar un número para `limit`: `"10"` no se convierte a `10`. No se eliminan propiedades extra. Un array en la raíz de salida debe envolverse, por ejemplo, en `{"items": [...]}`.

Para una tool sin argumentos, usar `type: object` y `additionalProperties: false`. El cliente enviará `{}`.

**Fragmento** con referencia local:

```yaml
outputSchema:
  type: object
  properties:
    user: { $ref: '#/$defs/user' }
  required: [user]
  additionalProperties: false
  $defs:
    user:
      type: object
      properties: { id: { type: string }, name: { type: string } }
      required: [id, name]
      additionalProperties: false
```

`$defs` pertenece al esquema que contiene la referencia; no existe un registro global de esquemas entre tools. Los nombres de propiedades y los datos literales de `const`, `default` o `examples` pueden contener campos llamados `$ref` o `$async`: no se interpretan como keywords fuera de posiciones de esquema.

## Plantillas

| Sintaxis | Fuente | Ejemplo |
| --- | --- | --- |
| `${input.campo}` | Argumentos validados de la llamada | `${input.user.id}` |
| `${input.lista.0}` | Elemento de array | `${input.tags.0}` |
| `${env.VARIABLE}` | Entorno del proceso al iniciar | `${env.API_TOKEN}` |

Una referencia que ocupa el valor completo conserva el tipo original. Dentro de un string mayor, se convierten a texto strings, booleanos y números finitos. Objetos, arrays y `null` no se pueden interpolar dentro de texto.

**Fragmento** HTTP:

```yaml
body:
  enabled: '${input.enabled}'
  metadata: '${input.metadata}'
headers:
  X-Request-Label: 'user-${input.id}'
```

Si `enabled` es `false`, se envía el booleano, no el string `"false"`. Si `metadata` es un objeto, se conserva como objeto.

Las plantillas se resuelven de forma recursiva en valores de objetos y arrays, pero no en sus claves. Los valores recibidos no vuelven a evaluarse como plantillas. No existen filtros, condicionales, valores por defecto ni expresiones JavaScript en esta sintaxis. No hay escape definido para incluir literalmente una secuencia `${...}` en un campo de plantilla del archivo.

Las rutas usan puntos, no JSONPath ni corchetes. No permiten acceder a propiedades heredadas ni a los segmentos `__proto__`, `prototype` o `constructor`. Usar nombres de entorno convencionales, como `SERVICE_TOKEN`.

### Dónde se resuelven

| Campo | `${input...}` | `${env...}` |
| --- | --- | --- |
| HTTP: valores de `pathParams`, `query`, `headers`, `body` | Sí | Sí |
| HTTP: `baseUrl` | No | Sí |
| HTTP: `path` | No; usar `{nombre}` con `pathParams` | No |
| CLI: `args`, valores de `env`, `stdin` | Sí | Sí |
| CLI: `command`, `cwd` | No | Sí |
| Auth: secretos y `tokenUrl` | No | Sí |
| Auth: nombre de perfil, `name` de API key, `scopes`, selectores de tipo/método | No | No; declarar valores literales |
| `server`, esquemas, descripciones, regex y JSONata | No | No |

Aunque el cargador inspecciona strings de ejecución y auth buscando referencias, solo los campos indicados se resuelven al ejecutar. No usar plantillas en `execution.auth`, nombres de headers ni otros selectores estáticos.

Las variables referenciadas se comprueban al iniciar, incluso en perfiles de auth sin uso. Ausencia o string vacío es error. Para rotarlas, actualizar el entorno y reiniciar. Un argumento opcional ausente no se sustituye automáticamente: si se referencia al ejecutar, la tool falla con una referencia no disponible.

## Precedencia y límites

| Parámetro | Regla |
| --- | --- |
| Transporte | `--transport` → `server.transport` → `stdio`. |
| Timeout de tool | `execution.timeoutMs` → `server.timeoutMs` → 30000 ms. |
| Límite de tool | `execution.maxOutputBytes` → `server.maxOutputBytes` → 1 MiB. |
| Timeout de OAuth | `auth.<perfil>.timeoutMs` → 10000 ms; también sujeto a cancelación de sus consumidores. |
| Timeout de worker | `response.workerTimeoutMs` → 1000 ms; además puede cancelarlo el deadline de tool. |
| Request entrante MCP HTTP | `server.http.maxRequestBytes` → 1 MiB; independiente del límite de respuesta. |

Los timeouts configurables son enteros entre 1 y 2147483647 ms. Los límites configurables de bytes son enteros entre 1 y 67108864 (64 MiB). No se admite `0` para desactivar estos límites.

En HTTP, el límite de tool se aplica al body saliente, la respuesta capturada y el JSON final. En CLI limita stdin, el total de stdout más stderr capturados y el JSON final. Exceder un límite devuelve error; no se trunca una respuesta para presentarla como exitosa.

El deadline empieza después de validar la entrada y cubre auth, ejecución y procesamiento. La cancelación es cooperativa en el proceso principal; regex y JSONata tienen su propio worker terminable. No equivale a aislar toda la validación y serialización síncrona en un proceso con deadline estricto.
