# Varios grupos de tools en un proceso

[English](en/tool-groups.md) · [Volver al índice](README.md)

Una composición carga archivos de integración existentes y los publica desde un único proceso Node.js. Cada grupo conserva sus tools, perfiles de autenticación, variables referenciadas, límites de ejecución y rutas relativas. No es necesario fusionar los archivos ni cambiar sus nombres de tools.

## Elegir cómo publicarlos

| `mode` | Transporte | Endpoints HTTP | Nombres de tools |
| --- | --- | --- | --- |
| `unified` | stdio o HTTP | `/mcp` | `<grupo>.<nombre-original>` |
| `separate` | HTTP | `/mcp/<grupo>` | Nombre original dentro de cada grupo |
| `both` | HTTP | `/mcp` y `/mcp/<grupo>` | Prefijos solo en `/mcp` |

El catálogo unificado publica una conexión MCP. Los prefijos identifican grupos, pero los clientes no necesariamente muestran carpetas o secciones. Los endpoints separados se agregan como conexiones distintas en el cliente, aunque pertenecen al mismo proceso y puerto.

En `both`, conectar el catálogo completo y uno de sus grupos en el mismo cliente expone dos veces esas operaciones. Elegir las conexiones que se necesiten.

## Archivo principal

Ejemplo ejecutable desde la raíz, sin credenciales externas: [composition.yaml](../examples/composition.yaml).

```yaml
# yaml-language-server: $schema=../schema/config.schema.json
version: 1
kind: composition
server:
  name: underqubit
  transport: http
  http:
    host: 127.0.0.1
    port: 3000
mode: both
groups:
  - id: local
    config: ./cli.yaml
  - id: echo
    config: ./cli.json
```

`version`, `kind`, `mode` y una lista `groups` no vacía son obligatorios. Cada grupo tiene únicamente `id` y `config`. Los IDs son únicos, de 1 a 126 caracteres, y admiten letras minúsculas ASCII, números, `_` y `-`. Las rutas son literales, sin interpolación de variables ni globbing.

`server` admite `name`, `version`, `transport` y `http`, con los mismos defaults que una integración: nombre `underqubit-sidecar-mcp`, versión `0.1.0`, transporte `stdio` y HTTP en `127.0.0.1:3000`. No admite `timeoutMs` ni `maxOutputBytes` en la composición: esos valores pertenecen a cada integración. Para `separate` o `both`, declarar HTTP o pasar `--transport http`.

Las rutas `config` se resuelven respecto del archivo principal. Dentro de cada integración, `command` y `cwd` relativos siguen resolviéndose respecto de su propio archivo. No se admiten composiciones anidadas. Cada archivo tiene un límite de 4 MiB y las mismas restricciones de YAML/JSON que una integración individual.

El servidor unificado toma su identidad del archivo principal. Cada endpoint separado usa el ID del grupo como nombre MCP y `server.version` de la integración como versión. El nombre, transporte y opciones HTTP de las integraciones no crean listeners adicionales.

Los nombres unificados siempre incluyen el prefijo: una tool llamada `jira_get_issue` en el grupo `jira` se publica como `jira.jira_get_issue`. No se quitan prefijos existentes. El nombre final no puede superar 128 caracteres; esta comprobación se realiza en cualquier modo. Tools y perfiles de auth pueden repetir nombres entre grupos, pero las tools de una misma integración deben tener nombres únicos.

## Ejecutar y conectar Inspector

```sh
npm run build
node dist/cli.js validate --config examples/composition.yaml
node dist/cli.js serve --config examples/composition.yaml
```

El último comando inicia un listener y muestra por stderr:

```text
http://127.0.0.1:3000/mcp
http://127.0.0.1:3000/mcp/local
http://127.0.0.1:3000/mcp/echo
```

En otra terminal, iniciar Inspector:

```sh
npx -y @modelcontextprotocol/inspector
```

Abrir la URL que imprime Inspector, seleccionar **Streamable HTTP** y conectarse a uno de los endpoints. En `/mcp`, llamar `echo.local_echo` con `{"message":"hola"}`. En `/mcp/echo`, llamar `local_echo` con los mismos argumentos. Ambas llamadas devuelven `{"message":"hola"}`. `/mcp/local` también ofrece `local_node_version`.

Para stdio, usar el [ejemplo JSON unificado](../examples/composition.json):

```sh
node dist/cli.js validate --config examples/composition.json
npx -y @modelcontextprotocol/inspector node -- \
  dist/cli.js serve --config examples/composition.json --transport stdio
```

Inspector inicia el proceso stdio; no iniciarlo por separado. Si las integraciones necesitan `.env`, agregar `--env-file=.env` antes de `dist/cli.js`. En clientes configurados desde otro directorio, usar rutas absolutas para el ejecutable, CLI, configuración y `.env`.

`--transport` sobrescribe el transporte del archivo principal, tanto en `serve` como en `validate`. No cambia `mode`: `both` y `separate` con stdio fallan. Para migrar una integración existente, referenciarla desde `groups`; ejecutarla directamente sigue conservando sus nombres y `/mcp` originales.

## Credenciales, operación y diagnóstico

Cada grupo tiene su propio snapshot de variables referenciadas y su propio administrador de autenticación. En modo `both`, el catálogo unificado y el endpoint del grupo usan el mismo runtime, por lo que comparten su caché OAuth. No hay perfiles globales ni overrides de entorno por grupo: para usar credenciales diferentes, referenciar nombres de variables diferentes en cada archivo. `.env` se carga mediante Node, no automáticamente por el proyecto.

Los archivos se validan por completo antes de abrir el listener. Un archivo ausente, una variable requerida faltante o una integración inválida aborta todo el arranque, indicando el grupo. `validate` comprueba la composición y sus integraciones, sin conectarse a APIs ni ejecutar tools. No hay recarga en caliente: reiniciar después de cambiar configuración o credenciales.

Los logs de llamadas contienen `group` y el nombre original de la tool. Los límites y cancelaciones se aplican en cada runtime; el cierre del proceso cancela operaciones de todos los grupos y cierra todos los endpoints.

| Síntoma | Comprobación |
| --- | --- |
| `requires HTTP` | Usar transporte HTTP o cambiar `mode` a `unified`. |
| `Duplicate group` | Asignar IDs únicos en `groups`. |
| `Group …` al iniciar | Corregir el archivo o las variables de esa integración. |
| HTTP 404 | Revisar el modo y la ruta exacta; no hay endpoints por tool ni redirección de barras finales. |
| Tool no encontrada | En `/mcp` usar el prefijo; en `/mcp/<grupo>` usar el nombre original. |
| No aparecen carpetas de tools | La presentación depende del cliente; usar conexiones separadas si se necesita distinguir servidores. |

Host, Origin y tamaño máximo del request se controlan con el `server.http` principal para todos los endpoints. No hay autenticación entrante ni permisos por grupo. Los grupos comparten proceso y recursos del sistema; no son un aislamiento de seguridad. Para exponerlos fuera de localhost, ver [operación HTTP](operacion-y-diagnostico.md).
