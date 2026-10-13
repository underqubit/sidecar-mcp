# Inicio rápido

[English](en/quick-start.md)

[Volver al índice](README.md)

Para una versión publicada en npm, ver [instalación npm y npx](publicacion-npm.md). Los comandos siguientes usan un checkout del código fuente.


## Requisitos

- Node.js 24 o superior y npm.
- Un cliente MCP que pueda iniciar procesos por stdio o conectarse mediante Streamable HTTP.
- Para tools CLI: el ejecutable o intérprete instalado en la máquina donde corre el servidor.
- Para tools HTTP: acceso desde esa misma máquina a la API y, cuando corresponda, a su endpoint OAuth2.

Una tool CLI se ejecuta en el host del servidor MCP. Si MCP está desplegado remotamente, no ejecuta comandos en la computadora del cliente.

## Instalar y compilar

```sh
npm ci
npm run build
node dist/cli.js --help
```

`npm ci` usa las versiones de `package-lock.json`. La compilación genera JavaScript, declaraciones de tipos y source maps en `dist/`, incluido el worker de respuestas.

## Probar sin APIs externas

```sh
node dist/cli.js validate --config examples/cli.yaml
node dist/cli.js serve --config examples/cli.yaml
```

La validación informa por stderr que hay dos tools válidas. `serve` queda esperando mensajes MCP por stdio; no es una consola interactiva de comandos.

El ejemplo publica:

| Tool | Argumentos | Resultado |
| --- | --- | --- |
| `local_node_version` | `{}` | Objeto con `version`, obtenida ejecutando `node --version` y parseando una regex. |
| `local_echo` | `{"message":"hola"}` | `{"message":"hola"}`, obtenido de un proceso Node que recibe JSON por stdin. |

La versión concreta de Node depende de la instalación local.

## Probar con MCP Inspector

El Inspector permite descubrir e invocar las tools desde una interfaz web. Desde la raíz del proyecto, con las dependencias instaladas, ejecutar:

```sh
npm run build
npx -y @modelcontextprotocol/inspector node dist/cli.js -- \
  serve --config examples/cli.yaml --transport stdio
```

El separador `--` hace que los argumentos posteriores se pasen al servidor. Es necesario porque el Inspector también reconoce `--config` y `--transport`: sin el separador, podría interpretar el YAML de tools como su propia configuración de cliente. Ver la [referencia oficial de argumentos del Inspector](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/configuration#the--separator).

El Inspector inicia el servidor como proceso hijo mediante stdio; no hace falta ejecutar `serve` previamente en otra terminal. `npx` obtiene el Inspector y este ejecuta la compilación local del proyecto. No requiere publicar Sidecar en npm.

1. Abrir la URL completa que imprime el Inspector, incluido su token de sesión.
2. Conectarse al servidor desde la interfaz y abrir **Tools**.
3. Listar las tools e invocar `local_node_version` con `{}` o `local_echo` con `{"message":"hola"}`.
4. Comprobar el resultado estructurado: la segunda tool debe devolver `{"message":"hola"}`.

La URL impresa permite acceder a la sesión del Inspector; usarla completa en lugar de escribir solo el host y puerto. Ver la [guía oficial de la interfaz web](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/web).

### Probar tools de API REST con `.env`

Crear `.env` a partir de `.env.example` y configurar `API_BASE_URL` y `API_TOKEN` con los datos del servicio real, como se explica en [Cargar variables de entorno](#cargar-variables-de-entorno). Después ejecutar:

```sh
npx -y @modelcontextprotocol/inspector node -- \
  --env-file=.env dist/cli.js \
  serve --config examples/http.yaml --transport stdio
```

En este comando, `--env-file` se pasa a Node antes del archivo JavaScript. `--transport stdio` define la conexión entre Inspector y MCP y sobrescribe el transporte HTTP declarado en el ejemplo. La tool `api_get_user` sigue llamando a la API REST mediante Axios; probarla con un argumento como `{"id":"42"}` que corresponda al servicio configurado.

Después de cambiar código, volver a compilar. Después de cambiar configuración o variables, reiniciar la conexión/proceso del servidor desde el Inspector para cargar los nuevos valores.

## Conectar un cliente mediante stdio

En clientes que utilizan un objeto `mcpServers`, la configuración tiene esta forma. Reemplazar las rutas por las rutas absolutas de la instalación; otros clientes pueden requerir una estructura distinta.

```json
{
  "mcpServers": {
    "underqubit": {
      "command": "node",
      "args": [
        "/ruta/underqubit-sidecar-mcp/dist/cli.js",
        "serve",
        "--config",
        "/ruta/underqubit-sidecar-mcp/examples/cli.yaml"
      ]
    }
  }
}
```

El cliente inicia el proceso y descubre las tools. Pedirle que invoque `local_echo` con `message: hola`. El contenido estructurado esperado es:

```json
{"message":"hola"}
```

Si una aplicación gráfica no encuentra `node`, usar la ruta absoluta del ejecutable. El PATH de una aplicación gráfica puede diferir del de la terminal.

## Conectar mediante HTTP

```sh
node dist/cli.js serve --config examples/cli.yaml --transport http
```

El proceso informa el endpoint por stderr. Con los defaults es `http://127.0.0.1:3000/mcp`. Configurar esa URL como servidor **Streamable HTTP** en el cliente MCP.

HTTP no sirve una página web ni una API REST de tools. Las operaciones de descubrimiento e invocación se realizan mediante MCP. Abrir la URL en un navegador no equivale a invocar una tool.

`--transport` prevalece sobre `server.transport`. Cada proceso inicia un solo transporte. Consultar [Operación](operacion-y-diagnostico.md) antes de exponer el endpoint fuera de localhost.

## Cargar variables de entorno

El proyecto no carga archivos `.env` automáticamente. Node permite hacerlo explícitamente:

```sh
cp .env.example .env
```

Editar `.env` con los valores del servicio real y después ejecutar:

```sh
node --env-file=.env dist/cli.js validate --config examples/http.yaml
node --env-file=.env dist/cli.js serve --config examples/http.yaml
```

La opción `--env-file` pertenece a Node y se ubica antes de `dist/cli.js`. `validate` comprueba que las variables existan; no comprueba que las credenciales funcionen ni llama al servicio remoto.

Para usar `.env` desde un cliente stdio, agregar `--env-file=/ruta/absoluta/.env` como primer argumento de Node, antes del archivo JavaScript. También se pueden proporcionar variables mediante el entorno que el cliente asigna al proceso.

## Referencia de comandos

| Comando | Efecto |
| --- | --- |
| `node dist/cli.js --help` | Muestra ayuda y termina. También admite `-h`. |
| `node dist/cli.js validate --config archivo.yaml` | Valida y termina, sin ejecutar tools. |
| `node dist/cli.js serve --config archivo.yaml` | Sirve el transporte declarado; stdio si se omite. |
| `node dist/cli.js serve --config archivo.json --transport http` | Fuerza HTTP para esa ejecución. |
| `npm start -- serve --config examples/cli.yaml` | Atajo de terminal; requiere compilación previa. |
| `npm run dev -- serve --config examples/cli.yaml` | Compila y ejecuta con source maps. No observa cambios automáticamente. |

Para clientes stdio se recomienda invocar `node` directamente, como en el ejemplo: los mensajes de los scripts npm no deben mezclarse con el canal de protocolo.

`--config` es obligatorio y no tiene una ruta predeterminada. Los archivos admitidos terminan en `.json`, `.yaml` o `.yml`. Un error de arranque o validación termina con código de salida `1`; una validación correcta termina con `0`.

## Agregar la primera integración

1. Elegir una operación concreta de la API o CLI.
2. Declarar sus argumentos y resultado con JSON Schema.
3. Mapear los argumentos en `execution`.
4. Elegir parser y, si hace falta, transformación en `response`.
5. Ejecutar `validate`, iniciar el servidor y probar con un cliente MCP.
6. Reiniciar el proceso después de cambiar configuración o variables.

Continuar con [Configuración](configuracion.md), [Tools HTTP](tools-http.md) o [Tools CLI](tools-cli.md).

## Varios archivos de integración

Usar [grupos de tools](grupos-de-tools.md) para cargar varios archivos en un proceso. Los ejemplos no requieren credenciales de APIs:

```sh
node dist/cli.js validate --config examples/composition.json
node dist/cli.js serve --config examples/composition.json
```

El ejemplo JSON publica un catálogo unificado por stdio. Para HTTP con catálogo completo y endpoints por grupo, ejecutar `node dist/cli.js serve --config examples/composition.yaml`. La guía incluye conexiones con Inspector y nombres esperados de tools. `--transport` cambia el transporte, no el modo de publicación; solo `unified` admite stdio.
