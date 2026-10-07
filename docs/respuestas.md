# Parseo, transformación y salida MCP

[Volver al índice](README.md)

La respuesta de una API o CLI pasa por tres pasos: **parsear el texto**, **transformar el dato si se configuró JSONata** y **validar contra `outputSchema`**. El esquema describe el resultado final, no necesariamente la respuesta original del servicio.

## Referencia de `response`

| Campo | Default | Uso |
| --- | --- | --- |
| `parser` | `{type: json}` | Objeto discriminado por `type: json`, `text` o `regex`. |
| `transform` | Omitido | Expresión JSONata; sin ella se conserva el dato parseado. |
| `workerTimeoutMs` | `1000` | Presupuesto del worker cuando se utiliza regex o JSONata. |

Un parser JSON/texto sin transformación se procesa en el hilo principal. Si hay regex o transformación, el parseo y la transformación se ejecutan en un worker.

## JSON

**Fragmento**:

```yaml
response:
  parser: { type: json }
```

Se aplica `JSON.parse` al texto completo. Un body vacío, varias líneas JSON independientes, un banner antes del JSON o texto que no sea JSON producen error. Content-Type no cambia el parser seleccionado.

Si la respuesta ya es un objeto compatible con `outputSchema`, no hace falta transformación. Para una lista raíz, envolverla:

```yaml
response:
  parser: { type: json }
  transform: '{"items": data}'
```

## Texto

El parser `text` conserva el string completo. Como `outputSchema` debe tener raíz objeto, una tool que lo use normalmente necesita envolverlo.

**Fragmento**:

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

`$trim` es opcional: omitirlo si espacios y saltos de línea forman parte del resultado que se quiere preservar.

## Regex con grupos nombrados

| Campo de `parser` | Default / requisito |
| --- | --- |
| `type` | Literal `regex`. |
| `pattern` | String obligatorio, con grupos nombrados `(?<nombre>...)`. |
| `flags` | String vacío. Se permiten `i`, `m`, `s`, `u`, sin repeticiones. |
| `mode` | `first`; alternativa `all`. |

No agregar `g` a flags: se incorpora internamente cuando `mode` es `all`. Se utiliza la sintaxis RegExp de JavaScript.

Para el texto `requests=120 errors=3`:

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

Resultado: `{"requests":120,"errors":3}`. Antes de JSONata, los grupos son strings. En YAML, las comillas simples preservan las barras de la regex; en JSON se escriben como `"\\d+"` dentro del string JSON.

En modo `first`, se usa la primera coincidencia y no encontrar ninguna es error. En modo `all`, se obtiene un array de objetos y no encontrar coincidencias devuelve `[]`.

Para una línea por elemento:

```yaml
response:
  parser:
    type: regex
    pattern: '^(?<name>\w+)=(?<count>\d+)$'
    flags: m
    mode: all
  transform: '{"items": [data.{"name": name, "count": $number(count)}]}'
```

Con `cpu=2` y `memory=4` en líneas separadas, el resultado contiene una lista de dos objetos. Declarar `outputSchema.properties.items` como array de objetos con `name: string` y `count: integer`.

## Contexto de JSONata

El documento raíz de la expresión contiene:

```json
{
  "data": {"id": 42, "name": "Ada"},
  "metadata": {"status": 200, "headers": {"content-type": "application/json"}}
}
```

| Origen | Metadata disponible |
| --- | --- |
| HTTP | `status`, `headers."content-type"` y `headers."retry-after"`, si esos headers existen. |
| CLI | `exitCode`. |

No se incorporan input, variables de entorno, perfiles de auth, cookies ni stderr al contexto. No hay funciones registradas que accedan a filesystem o red. `${input...}` y `${env...}` no se interpolan en la expresión.

Recetas de transformación:

| Necesidad | Expresión |
| --- | --- |
| Elegir y normalizar campos | `{"id": $string(data.id), "name": data.name}` |
| Mantener una lista aun con cero o un resultado | `{"users": [data.items.{"id": $string(id), "name": name}]}` |
| Filtrar una lista | `{"active": [data.items[active = true]]}` |
| Incorporar estado HTTP | `{"result": data, "status": metadata.status}` |
| Convertir un grupo regex | `{"count": $number(data.count)}` |
| Respuesta vacía aceptada, usando parser texto | `{"ok": true}` |

Los corchetes explícitos ayudan a preservar arrays en JSONata. Es importante comprobar cero, uno y varios elementos, porque algunas expresiones de selección producen secuencias o valores únicos.

La expresión debe producir un valor serializable como JSON. Un resultado ausente (`undefined`), un fallo de evaluación o una conversión numérica inválida generan error. Después de serializar, se valida el objeto final con `outputSchema`.

## Resultado MCP

El runtime construye una respuesta exitosa con contenido estructurado y una copia textual del mismo JSON. Ejemplo del resultado interno, antes de cualquier adaptación de compatibilidad del SDK:

```json
{
  "resultType": "complete",
  "content": [{"type": "text", "text": "{\"message\":\"hola\"}"}],
  "structuredContent": {"message": "hola"}
}
```

Un fallo de tool devuelve `isError: true`, texto con etapa y mensaje seguro, sin un `structuredContent` de éxito. Los errores de validación que detecta el SDK pueden usar su propio texto de error.

## Presupuestos y límites

Cada worker tiene entorno vacío, límite de generación vieja del heap de 64 MiB y stack de 4 MiB. Ese límite de heap no equivale a un límite total de memoria de todo el proceso. El tiempo configurado incluye inicio del worker y serialización; también se aplica al compilar regex/JSONata durante `validate`.

Un worker que excede tiempo o recursos se termina. El deadline de la tool también puede cancelarlo. Regex/JSONata se compilan para comprobar sintaxis al iniciar; eso no garantiza que la transformación funcione con cualquier respuesta real.

El JSON final debe caber en `maxOutputBytes`. La respuesta MCP incluye tanto su forma estructurada como textual, por lo que el tamaño total transmitido puede superar el tamaño de ese JSON individual. No se trunca salida para forzar su validación.

Ver [Operación y diagnóstico](operacion-y-diagnostico.md) para resolver errores de parseo y salida.
