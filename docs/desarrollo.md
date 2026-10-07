# Guía para desarrolladores

[Volver al índice](README.md) · [Arquitectura](arquitectura.md)

## Preparar el entorno

```sh
npm ci
npm run check
```

Se requiere Node.js 24 o superior. El proyecto usa npm con lockfile, TypeScript estricto, módulos ESM y resolución `NodeNext`. Los imports internos escritos en TypeScript llevan extensión `.js`, correspondiente a los archivos compilados.

`dist/` es generado; no editarlo directamente. El worker se carga mediante una URL relativa a `response.js`, por lo que una distribución debe incluir `dist/response-worker.js` y sus dependencias.

## Estructura

```text
src/                    Código del servidor y worker
examples/               Configuraciones utilizables y CLI de ejemplo
schema/                 JSON Schema generado para configuración
scripts/                Generador del esquema
tests/                  Pruebas sin listeners TCP
tests/network/          Pruebas con sockets HTTP locales
tests/fixtures/         CLIs y configuraciones deterministas
evaluations/            Preguntas de evaluación del uso de tools
docs/                   Documentación de usuario y desarrollo
.github/workflows/      Verificación en GitHub Actions
```

El mapa de responsabilidades de cada módulo está en [Arquitectura](arquitectura.md).

## Comandos de desarrollo

| Script | Qué ejecuta |
| --- | --- |
| `npm run build` | Compila `src/` con `tsconfig.build.json` a `dist/`, con declaraciones y source maps. |
| `npm run typecheck` | Compila y comprueba tipos de fuentes, tests y configuración Vitest sin emitir esos tests. |
| `npm start -- serve --config examples/cli.yaml` | Ejecuta el build existente. |
| `npm run dev -- serve --config examples/cli.yaml` | Compila y ejecuta con `--enable-source-maps`. No tiene watch. |
| `npm test` | Compila y ejecuta `tests/*.test.ts`. |
| `npm run test:network` | Compila y ejecuta `tests/network/*.test.ts`. |
| `npm run check` | Build, typecheck y suite sin TCP. |
| `npm run schema` | Compila y regenera `schema/config.schema.json` desde Zod. |

Para un cliente MCP stdio, iniciar `node dist/cli.js` directamente. Los scripts npm son útiles en terminal, pero sus mensajes pueden contaminar stdout si se usan como comando de protocolo.

No hay scripts de lint, formateo o cobertura configurados actualmente. No asumir que forman parte de `check`.

## Pruebas

Las pruebas importan `dist/` para verificar la misma compilación que se entrega al usuario. Antes de ejecutar Vitest directamente después de cambios, generar un nuevo build.

```sh
npm run build
node_modules/.bin/vitest run tests/config.test.ts tests/mcp.test.ts
```

| Suite | Cobertura principal |
| --- | --- |
| [config.test.ts](../tests/config.test.ts) | YAML/JSON, defaults, referencias, esquemas, variables, regex/JSONata inválidos y plantillas. |
| [cli.test.ts](../tests/cli.test.ts) | Argumentos literales, stdin, entorno, códigos de salida, límites, cancelación y procesos. |
| [http.test.ts](../tests/http.test.ts) | Axios con Nock: URL, query, headers, body, errores y autenticaciones. |
| [response.test.ts](../tests/response.test.ts) | Parsers, grupos regex, JSONata, timeout, bytes y cancelación de workers. |
| [mcp.test.ts](../tests/mcp.test.ts) | Cliente real stdio y Streamable HTTP en memoria, schemas publicados, guards y tamaño de requests. |
| [evaluation.test.ts](../tests/evaluation.test.ts) | Respuestas verificadas a través de tools MCP sobre datos fijos. |
| [http.network.test.ts](../tests/network/http.network.test.ts) | API y endpoint OAuth locales con sockets reales. |
| [mcp.network.test.ts](../tests/network/mcp.network.test.ts) | Listener HTTP real, clientes independientes, Host/Origin, rutas y límites. |

La suite sin TCP todavía necesita permiso para ejecutar procesos locales y workers. La suite de red necesita poder abrir puertos en loopback; `listen EPERM` indica una restricción del entorno. No convertir ese fallo en una prueba exitosa ni asumir que la suite en memoria sustituye toda la integración de sockets.

Ninguna de estas suites requiere credenciales reales ni llama APIs públicas. Para nuevos casos, usar fixtures y endpoints interceptados/locales. Las pruebas deben verificar comportamiento observable, especialmente fallos y efectos de cancelación.

## Agregar una tool sin cambiar código

1. Crear o editar una configuración con schemas, `execution` y `response`.
2. Reutilizar un perfil de auth cuando corresponda.
3. Validar con `node dist/cli.js validate --config <archivo>`.
4. Probar discovery e invocación desde un cliente MCP.
5. Reiniciar para aplicar cambios.

Solo hace falta desarrollar TypeScript si el comportamiento requerido no existe en los adaptadores, parsers o autenticaciones disponibles.

## Cambiar el formato de configuración

1. Modificar [config-schema.ts](../src/config-schema.ts), preservando uniones discriminadas y tipos inferidos.
2. Incorporar comprobaciones semánticas en `prepareConfig` cuando Zod no alcance: perfiles, referencias, URLs o restricciones de plantilla.
3. Aplicar el campo en el módulo que lo consume; validar un campo no significa que se resuelva o ejecute automáticamente.
4. Agregar casos de aceptación/rechazo y pruebas del comportamiento.
5. Ejecutar `npm run schema` y actualizar [Configuración](configuracion.md) y los ejemplos afectados.

El JSON Schema generado describe forma y defaults. Algunas reglas —por ejemplo, la existencia de una variable de entorno— solo se comprueban al cargar. No editar el artefacto generado como fuente principal.

Si se introduce un cambio incompatible, revisar explícitamente `version` del formato y la estrategia de migración. Actualmente solo se acepta `version: 1` y no hay migraciones automáticas.

## Extender ejecutores, autenticación o respuestas

| Cambio | Puntos a modificar | Comportamiento que debe preservarse |
| --- | --- | --- |
| Nuevo ejecutor | Unión `executionSchema`, tipos, adaptador y despacho del runtime | Entrada validada, cancelación, límite de bytes, `RawResponse` y errores seguros. |
| Nuevo perfil auth | Unión `authSchema`, `AuthManager` y validación de configuración | Secretos desde entorno, mensajes sin credenciales y cancelación. |
| Nuevo parser | Unión de parsers, prevalidación y procesamiento de respuestas | Misma semántica en validate/serve, límites y validación final. |
| Cambio de transporte | `mcp.ts`, ciclo de vida y tests de cliente | Registro de tools compartido, guards HTTP y cierre de recursos. |

Un nuevo ejecutor debe devolver `{text, metadata}` y no formar respuestas MCP por su cuenta. Mantener en el runtime la lógica común de validación de salida, logs y traducción de errores.

La ruta directa y la ruta worker de respuestas deben permanecer coherentes. Si un parser puede bloquear con entradas adversas, considerar el mismo aislamiento terminable que regex/JSONata. `resourceLimits` de un worker no convierte todo el proceso en un sandbox.

## Errores y logging

Usar `SidecarError(stage, message)` para fallos esperados con mensajes aptos para el cliente. No copiar `error.message` de Axios, cuerpos de autenticación o stderr del CLI sin revisar su contenido. `safeError` reemplaza errores desconocidos con un mensaje genérico.

El logger recibe un `LogEvent` y por defecto escribe una línea JSON en stderr. Se puede inyectar un logger en el constructor de `Runtime`, como hacen las pruebas. No agregar `console.log` a rutas ejecutadas durante MCP stdio.

Una validación rechazada por el SDK antes de entrar al runtime puede no generar un `LogEvent` de tool. Los diagnósticos de CLI/SDK tampoco usan necesariamente el formato JSON del runtime.

## Evaluaciones de uso de tools

[questions.xml](../evaluations/questions.xml) contiene diez preguntas independientes sobre un dataset operativo fijo. La configuración [evaluation.yaml](../tests/fixtures/evaluation.yaml) publica una tool para listar proyectos y otra para consultar métricas de cada proyecto.

```sh
node dist/cli.js serve --config tests/fixtures/evaluation.yaml
```

La prueba automática verifica las respuestas esperadas usando llamadas MCP y cálculos sobre sus resultados. No mide la capacidad de un modelo para elegir tools. Para evaluar un agente, conectarlo a esa configuración y comparar sus respuestas con el XML mediante el entorno de evaluación que se utilice. El repositorio no contiene un runner de modelos externo ni requiere claves de un proveedor para sus pruebas.

## CI y verificación de cambios

[ci.yml](../.github/workflows/ci.yml) configura GitHub Actions en Ubuntu y Node 24 para ejecutar:

1. Instalación reproducible con `npm ci`.
2. `npm run check`.
3. `npm run test:network`.
4. Regeneración del esquema y comprobación de diferencias con Git.

El workflow se ejecutará cuando el repositorio esté en GitHub y Actions esté habilitado; que el archivo exista no significa que una ejecución remota ya haya pasado.

Antes de entregar un cambio, correr las suites afectadas, comprobar el esquema generado si cambió Zod y actualizar las guías correspondientes. Para cambios solo documentales, validar enlaces y ejemplos suele ser más útil que repetir toda la suite funcional.

## Distribución

El manifiesto declara un binario `underqubit-sidecar-mcp` apuntando a `dist/cli.js`, pero el paquete tiene `private: true`; no hay una publicación npm configurada. El uso documentado es desde el checkout compilado.

Para una instalación de servicio, construir con dependencias de desarrollo y conservar en ejecución Node, dependencias de producción, `dist/`, configuración y los ejecutables/scripts referenciados. No alcanza con copiar `dist/cli.js` aislado.
