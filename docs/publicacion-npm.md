# Licencia y publicación en npm

[English](en/npm-publishing.md) · [Volver al índice](README.md)

El proyecto se distribuye bajo [Apache License 2.0](../LICENSE). El manifiesto declara `license: Apache-2.0` y está preparado para publicar `@underqubit/sidecar-mcp` como paquete público. La preparación del repositorio no implica que una versión ya esté disponible en el registro.

## Usar una versión publicada

Requiere Node.js 24 o superior. Una vez publicada la versión indicada:

```sh
npx -y @underqubit/sidecar-mcp@1.0.0 serve \
  --config /ruta/absoluta/config.yaml --transport stdio
```

También se puede instalar como dependencia local:

```sh
npm install @underqubit/sidecar-mcp@1.0.0
npx @underqubit/sidecar-mcp validate --config ./config.yaml
```

La configuración pertenece al usuario; el paquete no crea ni carga `.env` automáticamente. Para cargarlo con una instalación local:

```sh
node --env-file=.env node_modules/@underqubit/sidecar-mcp/dist/cli.js \
  serve --config ./config.yaml --transport stdio
```

Los ejemplos están dentro de `node_modules/@underqubit/sidecar-mcp/examples`. Si se copia una configuración CLI a otro directorio, copiar también sus scripts referenciados o ajustar las rutas. Los archivos de composición conservan la resolución relativa documentada en [Grupos de tools](grupos-de-tools.md).

El paquete incluye los scripts de importación, listos para ejecutar sin compilar:

```sh
node node_modules/@underqubit/sidecar-mcp/scripts/openapi-to-config.mjs \
  --input ./api.yaml --output ./tools.json
```

Es un paquete de línea de comandos: no se declara una API JavaScript pública mediante `main` o `exports`.

## Qué se publica

`package.json.files` permite únicamente el código compilado y sus mapas/declaraciones, fuentes TypeScript para esos mapas, licencia, READMEs, documentación, esquema, skill, ejemplos seleccionados y scripts OpenAPI. npm añade automáticamente `package.json`, README y LICENSE al paquete.

No se incluyen `.env`, `node_modules`, tests, cachés ni archivos `.tgz`. El ejemplo de Jira (`examples/jira.json`) y su script de diagnóstico (`scripts/diagnose-jira.mjs`) tampoco se publican: están disponibles solo en el repositorio. Algunas guías enlazan archivos que existen únicamente en el checkout.

- `prepack` limpia `dist`, compila, regenera el esquema y da permisos de ejecución a la CLI. Se ejecuta al usar `npm pack` o publicar desde el checkout.
- `prepublishOnly` ejecuta `npm run check` antes de publicar desde el checkout.
- No hay `install`, `postinstall` ni `prepare`: los consumidores reciben JavaScript compilado y no necesitan TypeScript ni dependencias de desarrollo.

Las tareas de desarrollo y empaquetado se ejecutan desde el checkout completo, no desde la carpeta instalada en `node_modules`.

## Verificar el paquete

Desde el repositorio:

```sh
npm ci
npm run check
npm run test:network
npm run check:package
npm pack --dry-run
```

`check:package` construye el tarball real en un directorio temporal, revisa sus archivos y lo instala como dependencia de un proyecto consumidor. Usa las versiones de producción del lockfile para que la prueba sea reproducible. Comprueba el binario con `npm exec`, un cliente MCP stdio, tools de dos grupos, el worker y el conversor OpenAPI. Limpia el directorio temporal al finalizar. No publica nada.

Con las dependencias ya disponibles en la caché npm se puede usar `npm run check:package -- --offline`. La prueba normal puede descargar dependencias. La suite `test:network` requiere permiso para abrir puertos localhost; la prueba de paquete usa stdio y no requiere puertos entrantes.

La CI ejecuta también `check:package`. Para conservar un tarball para revisión manual, ejecutar `npm pack`; los `.tgz` están ignorados por Git.

## Publicar una versión

Antes de publicar, confirmar que el nombre está disponible o pertenece a la cuenta publicadora:

```sh
npm view @underqubit/sidecar-mcp name version maintainers
npm login
npm whoami
```

Un error DNS o de conexión no confirma disponibilidad. La cuenta debe tener permisos para publicar `@underqubit/sidecar-mcp` dentro del scope `@underqubit`. El nombre está sincronizado en `package.json` y `package-lock.json`; el comando CLI se mantiene como `underqubit-sidecar-mcp`.

El manifiesto declara `homepage` y `author` con el sitio de Underqubit (`https://underqubit.com`). `repository` y `bugs` se pueden agregar cuando exista una URL pública confirmada del repositorio; no son obligatorios para npm y no se completan con URLs inventadas.

El manifiesto declara la versión `1.0.0`. Para versiones siguientes, incrementar la versión antes de volver a publicar; npm no permite reemplazar una versión existente. Por ejemplo, `npm version patch` actualiza manifiesto y lockfile, y normalmente crea un commit/tag: ejecutarlo con el estado de Git preparado para ese paso.

```sh
npm publish --dry-run
# Publicación real, solo cuando se decida lanzar la versión:
npm publish
```

`publishConfig` fija el registro `https://registry.npmjs.org/` y acceso público. La cuenta debe cumplir los requisitos vigentes de autenticación/2FA de npm. El dry run revisa el empaquetado, pero no demuestra que la cuenta tenga permisos ni reserva el nombre.

Referencias: [campos de package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/), [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/), [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
