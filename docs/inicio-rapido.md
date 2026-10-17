# Inicio rápido

[English](en/quick-start.md) · [Volver al índice](README.md)

Esta guía instala el paquete publicado en npm en un directorio de trabajo y usa los ejemplos que incluye. Para ejecutar el servidor desde el repositorio, ver [Desde el código fuente](#desde-el-código-fuente).

## Requisitos

- Node.js 24 o superior, con npm, pnpm o Yarn.
- Un cliente MCP que pueda iniciar procesos por stdio o conectarse mediante Streamable HTTP.
- Para tools CLI: el ejecutable o intérprete instalado en la máquina donde corre el servidor.
- Para tools HTTP: acceso desde esa misma máquina a la API y, cuando corresponda, a su endpoint OAuth2.

Una tool CLI se ejecuta en el host del servidor MCP. Si MCP está desplegado remotamente, no ejecuta comandos en la computadora del cliente.

## Instalar

```sh
mkdir sidecar && cd sidecar
npm init -y
npm install @underqubit/sidecar-mcp
npx @underqubit/sidecar-mcp --help
```

Con pnpm, usar `pnpm add @underqubit/sidecar-mcp` y `pnpm exec underqubit-sidecar-mcp --help`. Con Yarn, usar `yarn add @underqubit/sidecar-mcp` y `yarn underqubit-sidecar-mcp --help`; en Yarn 2 o superior, configurar antes `nodeLinker: node-modules` en `.yarnrc.yml` (ver [Instalación](README.md#instalación)).

Instalar el paquete en un proyecto fija su versión en el lockfile y deja los ejemplos en `node_modules/@underqubit/sidecar-mcp/examples/`. También se puede ejecutar sin instalar, con `npx -y @underqubit/sidecar-mcp` o `pnpm dlx @underqubit/sidecar-mcp`; en ese caso, `--config` debe apuntar a un archivo propio.

Los comandos de esta guía usan npm y se ejecutan desde el directorio `sidecar`. Con otro gestor, reemplazar `npx @underqubit/sidecar-mcp` según la [tabla de instalación](README.md#instalación).

## Probar sin APIs externas

```sh
npx @underqubit/sidecar-mcp validate --config node_modules/@underqubit/sidecar-mcp/examples/cli.yaml
npx @underqubit/sidecar-mcp serve --config node_modules/@underqubit/sidecar-mcp/examples/cli.yaml
```

La validación informa por stderr que hay dos tools válidas. `serve` queda esperando mensajes MCP por stdio; no es una consola interactiva de comandos.

El ejemplo publica:

| Tool | Argumentos | Resultado |
| --- | --- | --- |
| `local_node_version` | `{}` | Objeto con `version`, obtenida ejecutando `node --version` y parseando una regex. |
| `local_echo` | `{"message":"hola"}` | `{"message":"hola"}`, obtenido de un proceso Node que recibe JSON por stdin. |

La versión concreta de Node depende de la instalación local. Para usar el ejemplo como punto de partida, copiar `cli.yaml` junto con `echo.mjs`: las rutas relativas de una tool CLI se resuelven desde el directorio del archivo de configuración.

## Probar con MCP Inspector

El Inspector permite descubrir e invocar las tools desde una interfaz web. Desde el directorio `sidecar`, ejecutar:

```sh
npx -y @modelcontextprotocol/inspector node node_modules/@underqubit/sidecar-mcp/dist/cli.js -- \
  serve --config node_modules/@underqubit/sidecar-mcp/examples/cli.yaml --transport stdio
```

El Inspector inicia con Node el CLI del paquete, el mismo archivo que ejecuta el comando `underqubit-sidecar-mcp`. El separador `--` hace que los argumentos posteriores se pasen al servidor. Es necesario porque el Inspector también reconoce `--config` y `--transport`: sin el separador, podría interpretar el YAML de tools como su propia configuración de cliente. Ver la [referencia oficial de argumentos del Inspector](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/configuration#the--separator).

El Inspector inicia el servidor como proceso hijo mediante stdio; no hace falta ejecutar `serve` previamente en otra terminal.

1. Abrir la URL completa que imprime el Inspector, incluido su token de sesión.
2. Conectarse al servidor desde la interfaz y abrir **Tools**.
3. Listar las tools e invocar `local_node_version` con `{}` o `local_echo` con `{"message":"hola"}`.
4. Comprobar el resultado estructurado: la segunda tool debe devolver `{"message":"hola"}`.

La URL impresa permite acceder a la sesión del Inspector; usarla completa en lugar de escribir solo el host y puerto. Ver la [guía oficial de la interfaz web](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/web).

### Probar tools de API REST con `.env`

Crear `.env` en el directorio `sidecar` con las variables que usa el ejemplo HTTP y los datos del servicio real:

```dotenv
API_BASE_URL=https://api.example.com
API_TOKEN=replace-me
```

Después ejecutar:

```sh
npx -y @modelcontextprotocol/inspector node -- \
  --env-file=.env node_modules/@underqubit/sidecar-mcp/dist/cli.js \
  serve --config node_modules/@underqubit/sidecar-mcp/examples/http.yaml --transport stdio
```

En este comando, `--env-file` se pasa a Node antes del archivo JavaScript. `--transport stdio` define la conexión entre Inspector y MCP y sobrescribe el transporte HTTP declarado en el ejemplo. La tool `api_get_user` sigue llamando a la API REST mediante Axios; probarla con un argumento como `{"id":"42"}` que corresponda al servicio configurado.

Después de cambiar configuración o variables, reiniciar la conexión/proceso del servidor desde el Inspector para cargar los nuevos valores.

## Conectar un cliente mediante stdio

En modo stdio, el cliente MCP inicia el proceso del servidor y le asigna las variables de entorno declaradas en su configuración. Así se pasan las credenciales que la configuración referencia con `${env.VARIABLE}`, sin archivos `.env`.

### Claude Desktop

Editar `claude_desktop_config.json` (en macOS, en `~/Library/Application Support/Claude/`; en Windows, en `%APPDATA%\Claude\`) y reiniciar la aplicación:

```json
{
  "mcpServers": {
    "underqubit": {
      "command": "npx",
      "args": [
        "-y",
        "@underqubit/sidecar-mcp@{{version}}",
        "serve",
        "--config",
        "/ruta/absoluta/config.yaml"
      ],
      "env": {
        "API_BASE_URL": "https://api.example.com",
        "API_TOKEN": "replace-me"
      }
    }
  }
}
```

Otros clientes que usan un objeto `mcpServers` aceptan la misma estructura; algunos pueden requerir otra forma.

### Claude Code

```sh
claude mcp add --transport stdio \
  --env API_BASE_URL=https://api.example.com \
  --env API_TOKEN=replace-me \
  underqubit -- npx -y @underqubit/sidecar-mcp@{{version}} serve --config /ruta/absoluta/config.yaml
```

Para compartir la configuración en un proyecto sin escribir secretos, declararla en `.mcp.json` y referenciar variables del entorno de quien ejecuta Claude Code:

```json
{
  "mcpServers": {
    "underqubit": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@underqubit/sidecar-mcp@{{version}}", "serve", "--config", "/ruta/absoluta/config.yaml"],
      "env": {
        "API_BASE_URL": "${API_BASE_URL}",
        "API_TOKEN": "${API_TOKEN}"
      }
    }
  }
}
```

### Variables de entorno desde el cliente

- **Solo en stdio.** En HTTP, el cliente se conecta a un proceso que ya está en ejecución; las variables las define quien lo inicia: la shell, el supervisor del servicio o Node con `--env-file`.
- **Se leen al iniciar.** Después de cambiar un valor, reiniciar el servidor desde el cliente o reiniciar la aplicación.
- **Los valores quedan en texto plano** en el archivo de configuración del cliente. No versionar archivos con tokens reales; en `.mcp.json`, usar referencias `${VARIABLE}`.
- **Una variable referenciada ausente o vacía impide el arranque.** El cliente muestra el servidor MCP como fallido; el mensaje `[config] Required environment variable: ...` aparece en sus logs.

### Probar la conexión

Para probar sin credenciales, apuntar `--config` al ejemplo `node_modules/@underqubit/sidecar-mcp/examples/cli.yaml` del directorio `sidecar`, con ruta absoluta, y omitir `env`. El cliente inicia el proceso y descubre las tools. Pedirle que invoque `local_echo` con `message: hola`. El contenido estructurado esperado es:

```json
{"message":"hola"}
```

Indicar la versión (`@{{version}}`) hace que el cliente siempre inicie la misma versión; sin ella, npx puede usar la última publicada. El primer arranque descarga el paquete y puede tardar más. Con pnpm, usar `"command": "pnpm"` y `"args": ["dlx", "@underqubit/sidecar-mcp@{{version}}", "serve", "--config", "..."]`.

Para cargar un archivo `.env` en lugar de declarar las variables en el cliente, ver [Cargar variables de entorno](#cargar-variables-de-entorno). Si una aplicación gráfica no encuentra `npx` o `node`, usar la ruta absoluta del ejecutable: el PATH de una aplicación gráfica puede diferir del de la terminal.

## Conectar mediante HTTP

```sh
npx @underqubit/sidecar-mcp serve \
  --config node_modules/@underqubit/sidecar-mcp/examples/cli.yaml --transport http
```

El proceso informa el endpoint por stderr. Con los defaults es `http://127.0.0.1:3000/mcp`. Configurar esa URL como servidor **Streamable HTTP** en el cliente MCP.

HTTP no sirve una página web ni una API REST de tools. Las operaciones de descubrimiento e invocación se realizan mediante MCP. Abrir la URL en un navegador no equivale a invocar una tool.

`--transport` prevalece sobre `server.transport`. Cada proceso inicia un solo transporte. Consultar [Operación](operacion-y-diagnostico.md) antes de exponer el endpoint fuera de localhost.

## Cargar variables de entorno

El paquete no carga archivos `.env` automáticamente. `--env-file` es una opción de Node: no se puede pasar a través de `npx`, `pnpm exec` ni `yarn`, y Node no la acepta en `NODE_OPTIONS`. Hay dos alternativas:

- Ejecutar con Node el CLI del paquete instalado:

  ```sh
  node --env-file=.env node_modules/@underqubit/sidecar-mcp/dist/cli.js \
    validate --config node_modules/@underqubit/sidecar-mcp/examples/http.yaml
  node --env-file=.env node_modules/@underqubit/sidecar-mcp/dist/cli.js \
    serve --config node_modules/@underqubit/sidecar-mcp/examples/http.yaml
  ```

  En un cliente stdio, usar `"command": "node"` con `--env-file=/ruta/absoluta/.env` como primer argumento, antes de la ruta absoluta de `dist/cli.js`.
- Definir las variables en el entorno del proceso: en la shell, en el supervisor del servicio o en el bloque `env` del cliente MCP.

`validate` comprueba que las variables existan; no comprueba que las credenciales funcionen ni llama al servicio remoto.

## Referencia de comandos

| Comando | Efecto |
| --- | --- |
| `npx @underqubit/sidecar-mcp --help` | Muestra ayuda y termina. También admite `-h`. |
| `npx @underqubit/sidecar-mcp validate --config archivo.yaml` | Valida y termina, sin ejecutar tools. |
| `npx @underqubit/sidecar-mcp serve --config archivo.yaml` | Sirve el transporte declarado; stdio si se omite. |
| `npx @underqubit/sidecar-mcp serve --config archivo.json --transport http` | Fuerza HTTP para esa ejecución. |

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
npx @underqubit/sidecar-mcp validate --config node_modules/@underqubit/sidecar-mcp/examples/composition.json
npx @underqubit/sidecar-mcp serve --config node_modules/@underqubit/sidecar-mcp/examples/composition.json
```

El ejemplo JSON publica un catálogo unificado por stdio. Para HTTP con catálogo completo y endpoints por grupo, usar `composition.yaml` del mismo directorio. La guía incluye conexiones con Inspector y nombres esperados de tools. `--transport` cambia el transporte, no el modo de publicación; solo `unified` admite stdio.

## Desde el código fuente

Para contribuir o probar cambios que todavía no se publicaron, desde un checkout del repositorio:

```sh
npm ci
npm run build
node dist/cli.js validate --config examples/cli.yaml
```

Las demás guías muestran esta forma: `node dist/cli.js` con ejemplos en `examples/`. `npm start -- serve --config examples/cli.yaml` y `npm run dev -- serve --config examples/cli.yaml` son atajos de terminal; en clientes stdio, invocar `node` directamente para que los mensajes de npm no se mezclen con el canal de protocolo. Ver [Desarrollo](desarrollo.md).
