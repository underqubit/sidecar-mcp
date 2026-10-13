# Generar configuraciones desde Swagger y OpenAPI

[English](en/openapi-import.md) · [Volver al índice](README.md)

Los scripts convierten una especificación local JSON/YAML en un archivo de integración Sidecar. Generan una tool HTTP por operación seleccionada, con descripción, esquemas, parámetros, autenticación y transformación de respuesta. El resultado se puede ejecutar directamente o referenciar desde una [composición de grupos](grupos-de-tools.md).

## Uso

La carpeta `scripts` incluye tres entradas que comparten el mismo conversor:

| Script | Versiones aceptadas |
| --- | --- |
| `scripts/openapi-to-config.mjs` | Detección automática de Swagger 2.0 y OpenAPI 3.0.x, 3.1.x y 3.2.x. |
| `scripts/openapi2-to-config.mjs` | Solo Swagger/OpenAPI 2.0. |
| `scripts/openapi3-to-config.mjs` | Solo OpenAPI 3.0.x, 3.1.x y 3.2.x. |

Las versiones futuras no reconocidas se rechazan explícitamente; no se asume compatibilidad automática con una futura versión mayor. Los scripts requieren las dependencias instaladas y el proyecto compilado:

```sh
npm ci
npm run build
node scripts/openapi-to-config.mjs --help
```

Ejemplos incluidos, sin llamadas a servicios durante la generación:

```sh
node scripts/openapi2-to-config.mjs \
  --input examples/openapi/swagger2.yaml \
  --output examples/catalog-v2.json

node scripts/openapi3-to-config.mjs \
  --input examples/openapi/openapi3.yaml \
  --output examples/catalog-v3.yaml
```

Para importar una especificación propia con solo las operaciones de lectura:

```sh
node scripts/openapi-to-config.mjs \
  --input ./api.yaml \
  --output ./tools.json \
  --base-url https://api.example.com/v1 \
  --methods GET,HEAD \
  --prefix catalog
```

Por defecto se incluyen **todos los métodos soportados**, también operaciones de escritura. El script genera configuración; no ejecuta esas operaciones. Revisar las tools antes de conectarlas a un agente.

## Opciones

| Opción | Comportamiento |
| --- | --- |
| `--input` | Archivo local `.json`, `.yaml` o `.yml`, hasta 16 MiB. Obligatorio. |
| `--output` | Archivo JSON/YAML según extensión. Sin esta opción, JSON por stdout. El directorio debe existir. |
| `--base-url` | Reemplaza las URLs de API de todas las operaciones, incluyendo su prefijo de ruta. No cambia el endpoint OAuth. |
| `--name` | Nombre del servidor; por defecto deriva de `info.title`. |
| `--prefix` | Prefijo de nombres de tools, separado con `_`. |
| `--env-prefix` | Prefijo de variables de credenciales; por defecto `OPENAPI`. |
| `--methods` | Lista de métodos separados por comas, sin distinguir mayúsculas. |
| `--tags` | Lista de tags separados por comas; incluye operaciones con cualquiera de ellos. |
| `--skip-unsupported` | Omite operaciones incompatibles y reporta cada una por stderr. Sin la opción, falla sin generar configuración parcial. |
| `--force` | Permite reemplazar el archivo de salida existente; nunca la especificación de entrada. |

Los avisos, operaciones omitidas y nombres de variables requeridas se imprimen por stderr. No se descargan especificaciones ni referencias externas. No hay requests a las APIs ni validación de credenciales. El resultado debe pasar las validaciones de configuración del proyecto y no puede superar 4 MiB.

YAML rechaza claves duplicadas y aliases. Si una especificación está dividida en archivos, consolidarla primero en un documento con referencias locales `#/...`.

## Mapeo generado

**Nombres:** usa `operationId` o un nombre derivado de método/ruta, normaliza caracteres y agrega un sufijo determinista cuando hay colisiones. Los nombres no superan 128 caracteres. Las descripciones conservan `description`, `summary` o método/ruta, en ese orden. Las anotaciones consideran GET, HEAD y OPTIONS de lectura; los demás métodos se marcan conservadoramente como potencialmente destructivos.

**URL:** Swagger usa `schemes`, `host` y `basePath`; si no hay `schemes`, usa HTTPS con aviso. OpenAPI 3 usa el primer servidor de la operación, ruta o documento, en ese orden, y los defaults de sus variables. URLs relativas o sin host requieren `--base-url`. Las URLs deben ser HTTP(S), sin credenciales embebidas, query ni fragmentos. Las rutas generadas son relativas para conservar prefijos como `/api/v3`.

**Parámetros:** las entradas se llaman `path_id`, `query_limit`, `header_X_Count`, `form_name`, etc. Las declaraciones de operación sobrescriben parámetros homónimos de la ruta. Los placeholders de la URL se renombran internamente para admitir nombres que no son válidos en una plantilla Sidecar.

Los query y campos de formulario opcionales se representan con una clave **obligatoria y nullable**: enviar `null` omite ese parámetro. Por ejemplo, `{"query_limit":null}`. Omitir la clave falla en la validación de entrada. Los headers opcionales y el cuerpo opcional pasan a ser obligatorios, con aviso, porque el runtime no puede omitir sus plantillas; revisar esa decisión si la API distingue entre ausencia y valor. Los defaults de los esquemas no completan argumentos automáticamente.

**Cuerpo:** admite JSON, texto y formularios URL-encoded. El JSON/texto se recibe en `body`; los formularios usan entradas `form_*`. En OpenAPI 3, los formularios deben declarar un objeto simple de propiedades fijas con `additionalProperties: false`. El conversor no aplica serialización de objetos anidados a los formularios.

**Respuesta:** selecciona el menor código 2xx explícito y configura `successStatuses` con ese único código. Si hay varios, emite un aviso; otras respuestas 2xx serán errores hasta revisar la configuración. `default` o `2XX` sin un código concreto no bastan. Para contenido, prefiere JSON (también `application/*+json` en respuestas OpenAPI 3) y después texto; avisa si descarta otras alternativas.

Todas las respuestas se envuelven como `{"data":...}`, para conservar un objeto raíz MCP incluso si la API devuelve un array o escalar. HEAD, 204, 205 y respuestas sin cuerpo generan `{"data":null}`. Las listas vacías y de un elemento se conservan como listas. El esquema de respuesta describe el contenido dentro de `data`.

**Esquemas:** convierte referencias locales a `$defs`, admite referencias recursivas y proyecta propiedades `readOnly` fuera de la entrada y `writeOnly` fuera de la salida. Convierte `nullable` de OpenAPI 3.0 y `x-nullable` de Swagger, además de límites exclusivos booleanos, a JSON Schema. OpenAPI 3.1/3.2 admite uniones con `null` nativas. Formatos desconocidos para el validador se omiten con aviso, conservando el tipo. Los keywords de validación no soportados provocan un error; no se eliminan silenciosamente. Los esquemas complejos también deben ser aceptados por AJV en modo estricto.

## Autenticación y ejecución

Se respeta `security` de la operación sobre el global; `security: []` elimina la autenticación heredada. Admite API keys en header/query, Basic, Bearer y OAuth2 `client_credentials` (`flow: application` en Swagger 2). Para OAuth, el endpoint debe ser absoluto; genera `tokenAuthMethod: basic` y un aviso para verificarlo con el proveedor.

Si hay varias alternativas OR, usa la primera y avisa. No combina esquemas AND ni sustituye esquemas no soportados por acceso anónimo. Solo genera perfiles utilizados por las tools seleccionadas.

Las credenciales se representan como `${env.VARIABLE}`. Los nombres contienen el prefijo, el nombre normalizado del esquema, un hash estable y el tipo de secreto. El script lista las variables exactas sin solicitar ni leer credenciales reales. Por ejemplo, el ejemplo OpenAPI 3 requiere:

```dotenv
OPENAPI_BEARERAUTH_C41694_TOKEN=replace-with-your-token
```

Después de configurar `.env`:

```sh
node --env-file=.env dist/cli.js validate --config examples/catalog-v3.yaml
node --env-file=.env dist/cli.js serve --config examples/catalog-v3.yaml
```

No se genera un `.env` automáticamente. La validación realizada por el generador usa valores ficticios y comprueba estructura, esquemas y plantillas; no demuestra que las credenciales ni la API funcionen.

Para usar la integración como grupo, referenciarla desde el archivo de composición:

```yaml
groups:
  - id: catalog
    config: ./catalog-v3.yaml
```

## Límites y desarrollo

Se rechazan: referencias externas o anchors, métodos no soportados por el ejecutor (TRACE, QUERY, COPY, etc.), cookies, multipart/archivos/binarios, serializaciones como `deepObject`, arrays CSV y arrays de path/header, `allowReserved: true`, parámetros por `content`, esquemas/dialectos incompatibles, OAuth interactivo, OpenID Connect y autenticación combinada. Los arrays de query/formulario deben contener escalares y usar `collectionFormat: multi` en Swagger o `style: form`, `explode: true` en OpenAPI 3. Los parámetros escalares de path/header usan `simple`.

Callbacks y webhooks se reportan como no generados. Las funciones específicas de OpenAPI 3.2 que no encajan en el ejecutor actual requieren mapeo manual. No es un validador completo de la especificación ni un generador universal de clientes.

El código compartido está en `scripts/lib`: `openapi-cli.mjs` maneja archivos/opciones, `openapi-converter.mjs` traduce operaciones y `openapi-schema.mjs` normaliza esquemas y referencias. Las tres entradas evitan duplicar la lógica por versión. No se cambia el runtime ni el formato de configuración.

Pruebas: `npm run check`. `tests/openapi.test.ts` genera archivos mediante los scripts y ejecuta las tools resultantes contra HTTP interceptado, incluyendo autenticación, URLs, parámetros, formularios, schemas, respuestas y errores de conversión.

Referencias del formato: [Swagger 2.0](https://spec.openapis.org/oas/v2.0), [OpenAPI 3.0](https://spec.openapis.org/oas/v3.0.4.html), [3.1](https://spec.openapis.org/oas/v3.1.2.html), [3.2](https://spec.openapis.org/oas/v3.2.0.html).
