# Referencia de JSON Schema para las tools

[English](en/json-schema.md) · [Índice](README.md) · [Configuración](configuracion.md)

Esta guía explica las palabras clave de JSON Schema draft 2020-12 y cómo funcionan en `inputSchema` y `outputSchema` de este proyecto. Incluye las extensiones del validador instalado, las opciones sin efecto y las incompatibilidades. No confundir estas palabras clave con los campos propios del servidor, como `execution`, `auth` o `response`, documentados en [Configuración](configuracion.md).

## Qué se valida y cuándo

| Nivel | Validador | Comportamiento |
| --- | --- | --- |
| Archivo de configuración | Zod | Comprueba la estructura y aplica defaults del servidor, ejecución y parsers. |
| `inputSchema` | AJV, antes de ejecutar | Comprueba los argumentos enviados por el cliente MCP. Si fallan, no ejecuta HTTP ni CLI. |
| `outputSchema` | AJV, después del parser y JSONata | Comprueba el resultado estructurado. Si falla, devuelve error; el request o CLI ya se ejecutó. |

Ambos esquemas deben declarar literalmente `"type": "object"` en su raíz. Un array o valor escalar de una API se envuelve, por ejemplo, en `{"items": [...]}` mediante `response.transform`. Los ejemplos JSON de esta guía son **esquemas completos para pegar en `inputSchema` u `outputSchema`**, no archivos de configuración completos.

Las reglas del proyecto están en [src/config.ts](../src/config.ts), [src/config-schema.ts](../src/config-schema.ts) y [src/runtime.ts](../src/runtime.ts). AJV usa `strict: true`, `allErrors: true`, `ownProperties: true` y `validateFormats: true`, con `ajv-formats`. No se habilitan `useDefaults`, `coerceTypes`, `removeAdditional`, `$data` ni `discriminator`.

Por eso validar **no transforma los datos**: no convierte `"10"` en `10`, no agrega valores de `default`, no borra propiedades sobrantes y no oculta contraseñas. Las propiedades heredadas de JavaScript no cuentan. La transformación de salida se configura aparte; ver [Respuestas](respuestas.md).

## Cómo leer un esquema

Un esquema es un conjunto de condiciones que se aplican al mismo valor. `properties` describe campos, pero no los hace obligatorios: eso corresponde a `required`. Una condición para strings, números, objetos o arrays debe acompañarse del `type` correspondiente, declarado en ese esquema o en un contexto compatible; AJV estricto rechaza usos ambiguos.

En posiciones de subesquema también se admiten `true` (cualquier valor), `false` (ningún valor) y `{}` (sin restricciones). No sirven por sí solos como raíz de una tool, donde se exige `type: object`. Por ejemplo, `properties: {"metadata": true, "obsolete": false}` permite cualquier `metadata` y prohíbe que aparezca `obsolete`.

### Tipos, valores fijos y ausencia

| Palabra clave | Valor | Regla y efecto al omitirla |
| --- | --- | --- |
| `type` | `object`, `array`, `string`, `number`, `integer`, `boolean`, `null` | Restringe el tipo. Sin ella, JSON Schema no restringe el tipo; la raíz de una tool sí la exige. `integer` admite números sin parte fraccionaria, incluido `1.0`. |
| `enum` | Array no vacío de valores distintos | Permite solo esos valores, comparando también la estructura de objetos/arrays. Sin ella, no hay lista cerrada. |
| `const` | Un valor JSON | Exige exactamente ese valor. Sin ella, no hay valor fijo. |

**Ausente**, `null`, `""`, `0` y `false` son diferentes. Un campo opcional se puede omitir, pero no admite `null` salvo que su esquema lo permita. `required` exige presencia, no un string no vacío: para eso se agrega `minLength: 1`.

En campos anidados se acepta una unión con null, como `"type": ["string", "null"]`. Con esta configuración estricta, una unión de tipos no nulos como `["string", "number"]` se rechaza; usar `anyOf`. Si se combina nullable con `enum` o `const`, estos también deben permitir `null`. No usar un array de tipos en la raíz de una tool.

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

Válido: `{"issueKey":"CS-303","assignee":null}`. Inválido: `{"issueKey":null}` o `{"issueKey":"CS-303","state":"unknown"}`. `assignee`, `state` y `apiVersion` se pueden omitir.

## Objetos y campos adicionales

| Palabra clave | Valor | Regla y efecto al omitirla |
| --- | --- | --- |
| `properties` | Mapa nombre → subesquema | Valida cada campo declarado si está presente. No exige presencia ni prohíbe otros campos. |
| `required` | Array de nombres únicos | Todos deben estar presentes. Omitirlo equivale a `[]`. En modo estricto, declarar los nombres también en `properties` en un contexto compatible. |
| `additionalProperties` | Booleano o subesquema | Controla campos no cubiertos por `properties` o `patternProperties` **en ese mismo objeto de esquema**. Omitido permite campos adicionales. |
| `patternProperties` | Mapa regex → subesquema | Valida campos cuyos nombres coinciden. Si coinciden varios patrones, se aplican todos. Sin ella no hay reglas por patrón. |
| `propertyNames` | Subesquema de string | Valida el nombre de cada campo, no su valor. No declara ni habilita campos por sí sola. Omitida no restringe nombres. |
| `minProperties` | Entero ≥ 0 | Mínimo de campos presentes. Omitido equivale a 0. |
| `maxProperties` | Entero ≥ 0 | Máximo de campos presentes. Omitido no impone límite. |
| `dependentRequired` | Mapa nombre → array de nombres | Si aparece la clave, exige los campos listados. Es una dependencia de presencia, de una sola dirección. Omitida no agrega dependencias. |
| `dependentSchemas` | Mapa nombre → subesquema | Si aparece la clave, aplica el subesquema al **objeto completo**. Omitida no agrega condiciones. |
| `unevaluatedProperties` | Booleano o subesquema | Controla campos que no fueron evaluados por reglas aplicables, incluso mediante `$ref`, `allOf` y ramas válidas. Omitida no impone una restricción adicional. |

### `additionalProperties`: false, true o un esquema

| Configuración | Resultado |
| --- | --- |
| `false` | Un campo adicional hace fallar la validación. No se elimina. |
| `true` | Se permiten campos adicionales con cualquier valor. Los campos declarados siguen validándose. |
| Omitida | Se permiten campos adicionales, salvo otra regla como `unevaluatedProperties`. |
| `{ "type": "string" }` | Los campos adicionales se permiten solo si sus valores son strings. |

Con el primer ejemplo de esta guía, `{"issueKey":"CS-303","verbose":true}` falla. Cambiar `additionalProperties` a `true` lo admite. Esa opción no vuelve opcional a `issueKey` ni cambia su tipo.

Cada objeto anidado tiene sus propias reglas: `additionalProperties: false` en la raíz no cierra los objetos internos. En este ejemplo, se rechazan tanto un campo extra en la raíz como un campo extra dentro de `issue`:

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

En entradas, `false` ayuda a detectar argumentos inventados o mal escritos. En salidas, usarlo cuando se construye una estructura precisa. Si Jira devuelve muchos campos y el esquema declara dos, se debe proyectar la respuesta con JSONata o permitir campos extra. **El esquema no realiza esa proyección.**

### Diccionarios y patrones

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

`{"labels":{"team":"support"},"metrics":{"metric_count":3}}` es válido. `metric_count: "3"` falla. Las regex no están ancladas automáticamente: usar `^` y `$` para validar el nombre completo. AJV estricto rechaza que un nombre declarado en `properties` coincida también con un patrón de `patternProperties`.

### Composición y cierre de objetos

`additionalProperties` no reúne propiedades declaradas en otros miembros de `allOf`. Para componer un objeto y cerrar el resultado, usar `unevaluatedProperties: false` en el nivel de composición y dejar abiertas las partes:

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

Admite `{"key":"CS-303","summary":"Example"}` y rechaza un campo `extra`. En uniones, cuentan las ramas que validan: no asumir que declarar un campo en cualquier rama lo habilita siempre. Un `additionalProperties: true` explícito también evalúa esos campos y puede impedir que un `unevaluatedProperties: false` exterior los rechace.

## Strings y números

| Palabra clave | Tipo aplicable / valor | Regla y efecto al omitirla |
| --- | --- | --- |
| `minLength` | String / entero ≥ 0 | Mínimo de caracteres Unicode (puntos de código, no bytes ni grafemas). Omitido: 0. |
| `maxLength` | String / entero ≥ 0 | Máximo de caracteres. Omitido: sin límite. |
| `pattern` | String / regex como string | Debe encontrar coincidencia. No usar delimitadores `/.../`; por ejemplo, escribir `"pattern": "^\\d+$"` en JSON para representar la regex `^\d+$`. Omitido: sin patrón. |
| `format` | Nombre de formato | Aquí sí valida mediante `ajv-formats`. Omitido: sin validación de formato. Formatos desconocidos fallan al compilar. |
| `minimum` | Number/integer / número | Límite inferior inclusivo. Omitido: sin límite. |
| `maximum` | Number/integer / número | Límite superior inclusivo. Omitido: sin límite. |
| `exclusiveMinimum` | Number/integer / número | Exige un valor estrictamente mayor. No es un booleano en 2020-12. Omitido: sin límite. |
| `exclusiveMaximum` | Number/integer / número | Exige un valor estrictamente menor. Omitido: sin límite. |
| `multipleOf` | Number/integer / número > 0 | Exige un múltiplo exacto. Omitido: sin restricción de múltiplos. |

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

`{"limit":10,"score":0.5,"amountCents":15}` es válido. `"limit":"10"`, `score: 1` y `amountCents: 12` fallan. JSON no representa `NaN` ni `Infinity`; AJV también rechaza números no finitos. JavaScript usa coma flotante: para dinero o identificadores grandes, preferir centavos enteros dentro del rango seguro o strings; `multipleOf: 0.01` puede sufrir redondeo.

### Todos los formatos registrados

Este inventario corresponde a `newValidator()` y al lockfile del proyecto. Todos salvo `int32`, `int64`, `float` y `double` se usan sobre strings; declarar siempre el tipo adecuado. Un formato comprueba sintaxis, no existencia, permisos ni accesibilidad de una dirección.

| Formato | Qué comprueba |
| --- | --- |
| `date` | Fecha de calendario, por ejemplo `2026-10-13`. |
| `time` | Hora con zona horaria, por ejemplo `14:30:00Z`. |
| `date-time` | Fecha y hora con zona, por ejemplo `2026-10-13T14:30:00Z`. |
| `iso-time` | Variante que también permite hora sin zona. |
| `iso-date-time` | Variante que también permite fecha-hora sin zona. |
| `duration` | Duración ISO, como `P3D` o `PT2H`. |
| `uri` | URI absoluta; no limitada a HTTP. |
| `uri-reference` | Referencia URI absoluta o relativa. |
| `uri-template` | Sintaxis de plantilla URI; no sustituye variables del servidor. |
| `url` | Validador heredado de URL con restricciones propias; preferir `uri`. Puede rechazar localhost y direcciones privadas. |
| `email` | Sintaxis de correo; no verifica la casilla. |
| `hostname` | Sintaxis de nombre de host; no consulta DNS. |
| `ipv4` | Dirección IPv4. |
| `ipv6` | Dirección IPv6. |
| `regex` | Sintaxis de expresión regular. No ejecuta el patrón contra otros campos. |
| `uuid` | Sintaxis de UUID. |
| `json-pointer` | JSON Pointer, por ejemplo `/issue/key`. |
| `json-pointer-uri-fragment` | Pointer como fragmento, por ejemplo `#/issue/key`. |
| `relative-json-pointer` | JSON Pointer relativo, por ejemplo `1/key`. |
| `byte` | Sintaxis base64; no decodifica ni transforma la cadena. |
| `int32` | Número entero con signo de 32 bits. Usar `type: integer`. |
| `int64` | Comprueba que el número sea entero; no proporciona precisión de 64 bits ni un límite seguro de JavaScript. |
| `float` | Acepta números; no convierte ni impone precisión IEEE de 32 bits. |
| `double` | Acepta números; no añade precisión a JavaScript. |
| `password` | Reconocido sin validación adicional. No encripta ni oculta el valor. |
| `binary` | Reconocido sin validación adicional. No habilita archivos, multipart ni transporte binario. |

`idn-email`, `idn-hostname`, `iri` e `iri-reference`, aunque existen en el estándar, no están registrados en este proyecto. No usarlos sin cambiar el validador.

### Límites de formatos: extensión de ajv-formats

| Palabra clave | Comparación |
| --- | --- |
| `formatMinimum` | Mayor o igual al límite. |
| `formatMaximum` | Menor o igual al límite. |
| `formatExclusiveMinimum` | Estrictamente mayor. |
| `formatExclusiveMaximum` | Estrictamente menor. |

Los límites son strings y requieren `format` en el mismo esquema, con una función de comparación. Los formatos instalados que la ofrecen son `date`, `time`, `date-time`, `iso-time` e `iso-date-time`. No sirven para ordenar emails o UUIDs. Sin esos límites no hay restricciones adicionales de rango.

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

## Arrays, tuplas y coincidencias

| Palabra clave | Valor | Regla y efecto al omitirla |
| --- | --- | --- |
| `items` | Subesquema o booleano | Valida todos los elementos, o los posteriores a `prefixItems`. Omitido: no restringe esos elementos. No admite un array de esquemas en 2020-12. |
| `prefixItems` | Array no vacío de subesquemas | Valida por posición los primeros elementos. No exige que esas posiciones existan. Omitido: no define tupla. |
| `minItems` | Entero ≥ 0 | Longitud mínima. Omitido: 0. |
| `maxItems` | Entero ≥ 0 | Longitud máxima. Omitido: sin límite. |
| `uniqueItems` | Booleano | Con `true`, prohíbe elementos JSON iguales; no deduplica. Omitido: `false`. No significa unicidad de un campo como `id`. |
| `contains` | Subesquema | Exige elementos que lo cumplan. Por defecto al menos uno. Omitido: no exige coincidencias. |
| `minContains` | Entero ≥ 0 | Mínimo de coincidencias de `contains`; omitido: 1 cuando existe `contains`. |
| `maxContains` | Entero ≥ 0 | Máximo de coincidencias de `contains`; omitido: sin límite. |
| `unevaluatedItems` | Booleano o subesquema | Valida elementos no evaluados por otras reglas aplicables, incluidas composiciones. Omitido: sin restricción adicional. |

`minContains` y `maxContains` sin `contains` se rechazan en modo estricto. `contains` valida coincidencias, pero no filtra ni extrae los elementos. Con `minContains: 0`, `maxContains: 0` se puede prohibir que alguno coincida. Un `items: true` evalúa todos los elementos restantes; un `unevaluatedItems: false` exterior no los vuelve a cerrar.

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

`{"tags":["support"],"coordinate":[10,20],"states":["open","closed"]}` es válido. Tags duplicados, una coordenada de tres elementos o `states: ["closed"]` fallan. AJV estricto exige tuplas con límites coherentes: para dos posiciones fijas, usar `minItems: 2` y `items: false` o `maxItems: 2`.

## Combinaciones y condiciones

| Palabra clave | Valor | Regla |
| --- | --- | --- |
| `allOf` | Array no vacío de esquemas | Debe cumplir todos. No fusiona, transforma ni sobrescribe propiedades. |
| `anyOf` | Array no vacío de esquemas | Debe cumplir al menos uno; puede cumplir varios. |
| `oneOf` | Array no vacío de esquemas | Debe cumplir exactamente uno. Si dos ramas coinciden, falla. |
| `not` | Un esquema | Debe incumplir ese esquema. |
| `if` | Un esquema | Selecciona una rama, pero no exige por sí mismo que los datos cumplan la condición. |
| `then` | Un esquema | Se aplica cuando `if` valida. |
| `else` | Un esquema | Se aplica cuando `if` no valida. |

Omitirlas no agrega condiciones. AJV estricto rechaza `then`/`else` sin `if`, o `if` sin ninguna rama. En `if`, `properties` no exige presencia: agregar `required` cuando se quiera comprobar que el discriminante existe. Usar un `const` diferente en cada rama de `oneOf` evita solapamientos.

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

Válidos: `{"mode":"issue","issueKey":"CS-303"}` y `{"mode":"search","jql":"project = CS"}`. Inválidos: modo issue sin `issueKey`, o ambos `issueKey` y `jql` presentes.

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

Ejemplo válido: `{"identifier":3,"result":{"status":"ok","value":"done"}}`. Ni un booleano como identificador ni una respuesta `status: "ok"` sin `value` cumplen el esquema.

### Dependencias entre campos

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

`{"cursor":"next","jql":"project = CS"}` es válido; `{"cursor":"next"}` no. Si aparece `credentials`, incluso con valor `false`, se exige `account`: estas dependencias evalúan presencia. Para depender de su valor, usar `if`/`then`.

## Referencias, identidad y vocabularios

| Palabra clave | Función y soporte en el proyecto |
| --- | --- |
| `$schema` | Declara el dialecto del esquema. Omitido se usa AJV 2020-12. Usar `https://json-schema.org/draft/2020-12/schema`; no carga otros drafts automáticamente. El `$schema` de la configuración exterior es una indicación distinta para el editor. |
| `$id` | Identifica un recurso de esquema y establece una base para referencias. No descarga nada ni registra una definición global entre tools. Omitido no asigna un identificador explícito. Evitar cambiar bases en subesquemas salvo necesidad. |
| `$ref` | Aplica un esquema referenciado. Solo se permiten referencias internas que comiencen con `#`, como `#/$defs/issue`. En 2020-12 también se aplican sus keywords hermanas. |
| `$defs` | Mapa de subesquemas reutilizables. Declararlos no obliga a validarlos contra los datos: se aplican al referenciarlos. Cada esquema de entrada/salida tiene su propio mapa. |
| `$anchor` | El estándar define anclas con nombre, pero la versión/configuración instalada de AJV las rechaza como keyword desconocida en modo estricto. Usar pointers a `$defs`. |
| `$dynamicAnchor` | Define un ancla dinámica con nombre para referencias recursivas/extensibles. Admitida por AJV; normalmente no es necesaria para una integración simple. |
| `$dynamicRef` | Referencia que se resuelve según el ámbito dinámico. Solo interna (`#...`) en este servidor. Preferir `$ref` para reutilización ordinaria. |
| `$vocabulary` | En metaschemas declara vocabularios y si son requeridos (mapa URI → booleano). No instala plugins ni habilita keywords nuevas en este servidor. No usarlo para eludir el modo estricto. |
| `$comment` | Comentario para mantenedores. No restringe datos ni se ejecuta como código; no tiene un callback de logging configurado. |

Salvo las restricciones de raíz del proyecto, estas keywords son opcionales. Un pointer JSON usa `~1` para `/` y `~0` para `~` en nombres; `#/...` no es una ruta de archivo. Referencias a URLs, a otros archivos o a otra tool están prohibidas. Las referencias internas inexistentes fallan al cargar la configuración. No confundir `$ref` con `${input...}`: las plantillas no se resuelven dentro de esquemas.

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

Una estructura recursiva también puede describirse sin descargar esquemas:

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

Admite `{"name":"root","children":[{"name":"child"}]}`. Para esquemas recursivos o composiciones complejas, validar también la compatibilidad del cliente MCP que consumirá la definición.

## Anotaciones: describen, no transforman

| Palabra clave | Valor y efecto |
| --- | --- |
| `title` | Nombre legible del valor descrito. No reemplaza automáticamente `tool.title`. |
| `description` | Explicación para agentes, usuarios y editores. No constituye una regla ejecutable. |
| `default` | Valor sugerido. Aquí no se inserta ni hace opcional un campo requerido. |
| `examples` | Array de valores ilustrativos. No restringe como `enum` ni implica que AJV los verifique al compilar. |
| `deprecated` | Booleano; `true` indica que se desaconseja el campo. No lo prohíbe. Omitido equivale a no declararlo obsoleto. |
| `readOnly` | Booleano; describe un campo de lectura. El runtime no lo elimina de entradas ni bloquea su escritura. |
| `writeOnly` | Booleano; describe un campo de escritura. El runtime no lo elimina de salidas ni lo oculta. |
| `x-mcp-header` | Extensión del proyecto, string, aceptada como metadata MCP. No configura headers HTTP por sí sola; usar `execution.headers`. |

Al omitir anotaciones, no se agregan sugerencias ni restricciones; `readOnly` y `writeOnly` se consideran `false`. No guardar secretos en `default`, `examples` o descripciones: los esquemas se publican al cliente MCP. `readOnly`/`writeOnly` son distintos de las anotaciones de tool `readOnlyHint` y similares.

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

`{}` falla aunque `limit` tenga `default: 20`. `{"limit":10}` valida y se mantiene sin cambios. Si una plantilla de ejecución referencia un argumento opcional ausente, también puede fallar al resolverla: el esquema no suministra el valor faltante.

### Contenido codificado

| Palabra clave | Significado | Efecto real aquí |
| --- | --- | --- |
| `contentEncoding` | Codificación de un string, como `base64`. | Metadata; no verifica ni decodifica. |
| `contentMediaType` | Tipo MIME del contenido, como `application/json`. | Metadata; no parsea JSON ni configura headers. |
| `contentSchema` | Esquema del contenido decodificado. | Metadata; no valida ese contenido con esta configuración de AJV. |

Si necesitás verificar base64, `format: byte` comprueba la sintaxis. Para parsear y validar contenido, configurar el parser/transformación y un `outputSchema` efectivo. Estas anotaciones tampoco habilitan uploads o respuestas binarias.

## Compatibilidad y opciones no habilitadas

La referencia cubre las keywords de los vocabularios Core, Applicator, Validation, Unevaluated, Metadata, Format y Content de 2020-12, además de las extensiones registradas. No implica soporte universal de todos los drafts, formatos opcionales o extensiones de terceros.

| Nombre o construcción | Estado / alternativa |
| --- | --- |
| `definitions` | Forma heredada aceptada por AJV. Preferir `$defs`. |
| `dependencies` | Forma heredada aceptada; listas exigen campos y esquemas se aplican al objeto completo. Preferir `dependentRequired` / `dependentSchemas`. |
| `nullable` | Extensión OpenAPI aceptada por AJV junto con `type`; `true` añade null al tipo, pero no a `enum`/`const`. Preferir `type: ["string", "null"]` en campos anidados. |
| `additionalItems` | No usar en 2020-12; se rechaza en modo estricto. Usar `prefixItems` + `items`. |
| `items: [...]` | Sintaxis de tuplas de drafts anteriores; rechazada. Usar `prefixItems`. |
| `$recursiveAnchor`, `$recursiveRef` | Keywords antiguas de 2019-09. No usar como contrato de 2020-12; `$recursiveAnchor: true` se rechaza con el metaschema instalado. Usar `$dynamicAnchor` / `$dynamicRef`. |
| `id` | Forma antigua no soportada. Usar `$id`. |
| `$async` | Prohibida por el cargador, incluso con valor `false`: las tools usan validación síncrona. |
| `$data` | Referencias a valores de otros campos no habilitadas. Usar condiciones estándar cuando alcancen; comparaciones arbitrarias requieren lógica adicional. |
| `discriminator` | Extensión no habilitada. Usar `oneOf` con discriminantes `const`. |
| `example`, `xml`, `externalDocs`, `x-*` arbitrarios | No son keywords admitidas directamente, salvo `x-mcp-header`. `examples` sí se admite. El importador OpenAPI puede convertir u omitir metadata. |
| `transform`, `errorMessage`, `select` | Extensiones de otros plugins, no instaladas. Para transformar la salida usar `response.transform`. |
| Metaschemas/drafts externos | No se descargan ni registran automáticamente. Normalizar a 2020-12. |

Los strings dentro de `const`, `enum`, `default` o `examples` son datos, no keywords. Un campo de usuario llamado `$ref` dentro de `properties` no es por sí mismo una referencia de esquema.

### Importación OpenAPI y ejecución son etapas distintas

Los scripts OpenAPI no aceptan necesariamente todo lo que acepta AJV. Normalizan `nullable`, referencias locales y algunos formatos; pueden descartar metadata o rechazar binarios y keywords fuera de su lista. Durante la importación sí se proyectan campos `readOnly` fuera de la entrada y `writeOnly` fuera de la salida. Esa proyección sucede al **generar la configuración**, no al validar una llamada. Revisar advertencias y [la guía de importación](importar-openapi.md).

## Validar, diagnosticar y mantener

Para comprobar un archivo de configuración completo:

```sh
npm run build
node dist/cli.js validate --config examples/cli.json
```

Reemplazar la ruta por el archivo propio. `validate` compila los esquemas y valida configuración/referencias/entorno; **no llama a APIs ni ejecuta tools ni comprueba respuestas reales**. Probar llamadas válidas e inválidas en [MCP Inspector](inicio-rapido.md#probar-con-mcp-inspector). Un cliente MCP puede rechazar argumentos antes de que lleguen al runtime.

| Síntoma | Qué revisar |
| --- | --- |
| `Invalid or unsupported JSON Schema` | Tipo ausente/incompatible, keyword desconocida, referencia incorrecta, formato no registrado o condición ignorada en modo estricto. |
| `[input]` / argumentos inválidos | `required`, tipos reales, `enum`, rangos, patrones y campos adicionales. La ejecución no debe comenzar. |
| `[output]` / resultado incompatible | Forma obtenida después del parser/JSONata, campos anidados extra, nulls y raíz objeto. La operación externa ya ocurrió; no reintentar escrituras automáticamente. |
| Falta un valor de `default` | Es una sugerencia del esquema, no un valor insertado. Enviarlo explícitamente o cambiar la configuración. |
| `oneOf` falla inesperadamente | Ninguna rama o varias ramas validan. Revisar discriminantes y campos requeridos. |
| Un `allOf` rechaza un campo declarado | Revisar cierres `additionalProperties` dentro de ramas; considerar `unevaluatedProperties`. |

No confundir `maxLength` o `maxItems` con `maxOutputBytes`: este último limita bytes de transporte/procesamiento y se configura fuera del esquema. Tampoco asumir que el timeout del worker aísla AJV: la validación es síncrona en el proceso principal. Mantener regex y esquemas con un costo razonable.

Los ejemplos y el inventario se verifican con `npm run docs:check-schema`; el comando compara ambos idiomas, compila los ejemplos con el validador del proyecto y comprueba casos válidos e inválidos. Después de editar las guías ejecutar `npm run docs:build` para regenerar el HTML y verificar enlaces.

Referencias oficiales: [JSON Schema 2020-12](https://json-schema.org/specification), [validación](https://json-schema.org/draft/2020-12/json-schema-validation), [Core y Applicator](https://json-schema.org/draft/2020-12/json-schema-core), [modo estricto de AJV](https://ajv.js.org/strict-mode.html), [ajv-formats](https://ajv.js.org/packages/ajv-formats.html). Para el comportamiento concreto de este servidor, prevalecen su configuración del validador, su lockfile y las comprobaciones de esta guía.
