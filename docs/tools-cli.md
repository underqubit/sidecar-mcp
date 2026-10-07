# Tools CLI: adaptar un ejecutable local

[English](en/tools-cli.md)

[Volver al índice](README.md) · [Configuración común](configuracion.md)

Una tool CLI inicia un proceso, envía argumentos y stdin, captura stdout y procesa su resultado. Funciona con programas que ya existan; cuando el CLI admite salida JSON, usarla suele simplificar el mapeo.

## Referencia de `execution`

| Campo | Tipo / default | Uso |
| --- | --- | --- |
| `type` | Literal `cli` | Selecciona el adaptador. |
| `command` | String obligatorio | Ejecutable fijo o desde entorno; nunca desde input. |
| `args` | Lista de strings, `[]` | Cada elemento se resuelve como un argumento individual. |
| `cwd` | Directorio del archivo de configuración | Directorio de trabajo fijo o desde entorno. |
| `env` | Mapa de strings, `{}` | Variables explícitas del proceso hijo. |
| `stdin` | Valor JSON, omitido | String literal o serialización JSON de otro valor. |
| `successExitCodes` | `[0]` | Lista no vacía de enteros entre 0 y 255. |
| `timeoutMs` | Hereda del servidor | Deadline de la tool. |
| `maxOutputBytes` | Hereda del servidor | Límite de stdin, captura y resultado. |

## Ejemplo completo ejecutable

Guardar como `local.yaml` en la raíz del proyecto. Utiliza el script de ejemplo que ya existe en `examples/echo.mjs`.

```yaml
version: 1
tools:
  - name: local_message
    description: Recibe un mensaje y lo devuelve mediante un CLI local de ejemplo.
    inputSchema:
      type: object
      properties:
        message: { type: string, maxLength: 1024 }
      required: [message]
      additionalProperties: false
    outputSchema:
      type: object
      properties:
        message: { type: string }
      required: [message]
      additionalProperties: false
    annotations:
      readOnlyHint: true
      destructiveHint: false
      idempotentHint: true
      openWorldHint: false
    execution:
      type: cli
      command: node
      args: [examples/echo.mjs]
      cwd: .
      stdin:
        message: '${input.message}'
    response:
      parser: { type: json }
```

```sh
node dist/cli.js validate --config local.yaml
node dist/cli.js serve --config local.yaml
```

Desde un cliente MCP, invocar `local_message` con `{"message":"hola"}` devuelve `{"message":"hola"}`. Para probar sin crear un archivo nuevo, usar [examples/cli.yaml](../examples/cli.yaml) o [examples/cli.json](../examples/cli.json).

## Argumentos y shell

Se usa `spawn(command, args, {shell: false})`. Un string como `"hello world"` es un solo argumento y no debe contener comillas adicionales para proteger espacios.

**Fragmento** para un CLI existente:

```yaml
execution:
  type: cli
  command: service-cli
  args: [users, get, '${input.id}', --output, json]
```

No poner toda la línea en `command: 'service-cli users get ...'`: se intentaría encontrar un ejecutable con ese nombre completo. No hay expansión automática de `~`, globbing, pipes, redirecciones, `$HOME` ni sustitución `$(...)`.

Una referencia numérica o booleana en `args` se convierte a string. Los objetos y arrays no se expanden en múltiples argumentos. Si el programa necesita JSON estructurado, usar stdin o un contrato de argumentos apropiado.

Para scripts se puede declarar un intérprete y la ruta como argumento: `command: node`, `args: [script.mjs]`. La configuración es de confianza: configurar explícitamente un intérprete que ejecute código conserva los permisos y capacidades de ese intérprete.

## Directorios y búsqueda del ejecutable

| Valor | Resolución |
| --- | --- |
| `command: node` | Búsqueda en PATH. |
| `command: ./bin/tool` | Relativo al directorio del archivo de configuración. |
| Ruta absoluta en `command` | Se conserva como absoluta en la plataforma correspondiente. |
| `cwd` omitido | Directorio del archivo de configuración. |
| `cwd: ../workspace` | Relativo al archivo de configuración. |
| Ruta dentro de `args` | La interpreta el CLI desde su `cwd`. |

Por eso mover un YAML de `examples/` a la raíz puede requerir ajustar rutas. El nombre del archivo pasado a `--config` se resuelve desde el directorio donde se inicia Node.

En Windows, declarar ejecutables compatibles con `spawn` sin shell o el intérprete correspondiente. La implementación no ofrece un modo `shell: true` para scripts `.cmd`/`.bat`.

## Entorno y credenciales

Solo se heredan del servidor estas variables, cuando existen: `PATH`, `SystemRoot`, `WINDIR`, `TMPDIR`, `TEMP`, `TMP` y `LANG`. `execution.env` se agrega después y puede reemplazarlas.

**Fragmento**:

```yaml
env:
  SERVICE_TOKEN: '${env.SERVICE_TOKEN}'
  HOME: '${env.HOME}'
  SERVICE_PROFILE: production
```

`HOME` no se hereda por defecto. Si el CLI consulta credenciales o configuración en el home del usuario, declararlo explícitamente. Las variables de entorno del servidor usadas por plantillas se capturan al iniciar; las variables básicas heredadas se consultan al crear el proceso.

El adaptador CLI no usa `execution.auth`: delega la autenticación al propio programa mediante entorno o stdin. Consultar [Autenticación](autenticacion.md).

## Stdin, stdout y stderr

Si `stdin` es un string, se envía tal cual, sin agregar un salto de línea. Para incluir uno, usar un string YAML con `\n` o un bloque literal. Si es objeto, array, número, booleano o `null`, se serializa como JSON. Si se omite, stdin se cierra sin datos.

El proceso debe terminar para producir un resultado MCP. No es una terminal interactiva ni una sesión con TTY.

Stdout completo se interpreta como UTF-8 y alimenta el parser. Si el programa escribe banners o logs antes de un JSON, el parser JSON fallará; configurar su modo silencioso/JSON o usar un parser adecuado. Stderr se drena y se cuenta para el límite de captura, pero se descarta: no se agrega al resultado ni a los logs.

Un código de salida fuera de `successExitCodes`, o la terminación por señal, produce error antes del parseo. Si se aceptan códigos no cero, también debe existir un parser/esquema válido para la salida correspondiente.

## Cancelación y límites

Un timeout, cancelación MCP, cierre del servidor o exceso de salida solicita SIGTERM. En POSIX se señala al grupo de procesos creado para la tool y se escala a SIGKILL después de 250 ms si hace falta. En Windows se termina el proceso directo; no se garantiza finalizar descendientes independientes. Un proceso que se desacopla de su grupo en POSIX tampoco se convierte en un recurso aislado por el servidor.

El límite suma los bytes recibidos por stdout y stderr. Stdin tiene su propia comprobación con el mismo valor configurado. El resultado JSON final vuelve a comprobarse. No se devuelve una captura parcial como resultado correcto.

Para estructurar salida textual, continuar con [Respuestas](respuestas.md).
