# Operación y diagnóstico

[English](en/operations-and-troubleshooting.md) · [Volver al índice](README.md)

## Elegir cómo ejecutar el servidor

| Modalidad | Uso | Quién administra el proceso |
| --- | --- | --- |
| Stdio | Integración local con un cliente MCP | Normalmente el cliente inicia y detiene Node. |
| Streamable HTTP | Proceso compartido por clientes de una red o detrás de un proxy | El operador o supervisor del servicio. |

Cada proceso sirve un transporte. Para servir ambos simultáneamente, iniciar procesos separados; cada uno tendrá su propia caché OAuth y podrá ejecutar sus propios CLIs.

La configuración se considera administrada por un operador de confianza. Los comandos se ejecutan con permisos del usuario del servidor, y los clientes HTTP admitidos acceden al mismo catálogo de tools. No hay permisos por tool, usuarios propios, rate limiting ni cuotas de concurrencia incorporadas.

## Preparar una ejecución de servicio

1. Instalar Node 24 y los CLIs requeridos en el host del servidor.
2. Instalar dependencias y compilar con `npm ci` y `npm run build`.
3. Ubicar configuración, scripts y secretos donde el usuario del proceso pueda leerlos.
4. Ejecutar `validate` con el mismo entorno que tendrá el servicio.
5. Iniciar Node mediante el supervisor elegido y configurar reinicio/logs allí.

Ejemplo de comando, con rutas a reemplazar:

```sh
node --env-file=/ruta/sidecar/.env /ruta/sidecar/dist/cli.js serve \
  --config /ruta/sidecar/config.yaml --transport http
```

No se requiere que el directorio de trabajo del supervisor sea el del proyecto si se usan rutas absolutas. Las rutas CLI relativas se resuelven según el archivo de configuración y su `cwd`, como se explica en [Tools CLI](tools-cli.md).

El repositorio no instala un servicio del sistema ni contiene un despliegue Docker/Kubernetes preconfigurado. El servidor tampoco recarga automáticamente código o configuración.

## HTTP, proxy y controles de acceso

Valores predeterminados: escucha en `127.0.0.1:3000`, ruta `/mcp`, hosts locales permitidos y ningún Origin explícito permitido.

Para publicar detrás de un proxy:

- Mantener loopback si proxy y backend están en el mismo host. En otra topología, configurar el bind y restringir por red el acceso directo al backend.
- Terminar TLS y autenticar clientes en el proxy. El servidor MCP no valida tokens entrantes.
- Configurar `allowedHosts` con los hostnames que el backend realmente recibirá. Se verifica el Host del request; no se infiere autorización desde `X-Forwarded-Host`.
- Si los clientes envían Origin, declarar valores completos como `https://console.example.com`. Scheme y puerto importan. No usar comodines.
- Preservar método, body y headers MCP. El protocolo puede utilizar streaming; configurar el proxy según el transporte del cliente, sin asumir que todo intercambio es una respuesta REST simple.
- Ajustar timeout y límite de body del proxy para que sean coherentes con los del servidor.

`allowedHosts` protege la selección del host y `allowedOrigins` restringe orígenes presentes, pero no autentican al cliente. Un Origin ausente se acepta; uno presente pero vacío, `null` o no incluido produce 403. La lista de Origins no habilita automáticamente CORS ni respuestas a preflight de navegador.

El servidor tiene un límite configurable de body entrante (`maxRequestBytes`). El listener Node usa 30 segundos para recepción del request y 10 segundos para headers; esos valores del listener no son el deadline de ejecución de la tool y no tienen campos de configuración propios.

No existe una ruta `/health` implementada. Para comprobar disponibilidad funcional, conectar un cliente MCP y listar tools; para comprobar una integración, invocar una tool adecuada de solo lectura.

## Cambios y apagado

Modificar YAML/JSON, credenciales o esquemas requiere reiniciar. Validar primero y después reiniciar mediante el cliente/supervisor. Cambiar `outputSchema` puede romper consumidores que esperan el contrato anterior; actualizar nombre o versión de la integración según las necesidades del sistema que lo usa.

SIGINT y SIGTERM cancelan trabajo activo y cierran recursos. En modo stdio, terminar stdin también inicia el cierre. En HTTP, el cierre termina llamadas, handler, conexiones y listener; no es un drenaje que deje completar indefinidamente todos los trabajos.

En POSIX se intenta finalizar el grupo de procesos de cada CLI cancelado, con escalamiento a SIGKILL. Revisar las limitaciones de descendientes en [Tools CLI](tools-cli.md).

## Logs

El runtime emite líneas JSON por stderr, por ejemplo:

```json
{"tool":"users_get","durationMs":123,"ok":true}
```

```json
{"tool":"users_get","durationMs":30001,"ok":false,"stage":"execution"}
```

No se registran argumentos, bodies, stdout/stderr del CLI ni valores de credenciales. La salida del servicio upstream sí puede contener datos sensibles y formar parte del resultado exitoso; limitarla mediante la transformación y el esquema.

Stderr también puede contener mensajes de arranque, validación y del SDK en texto plano. Un recolector no debe asumir que todas las líneas son JSON. La duración corresponde a cada llamada que llega al runtime; no todos los rechazos del protocolo generan un log de tool.

Para guardar diagnósticos en una terminal POSIX:

```sh
node dist/cli.js serve --config examples/cli.yaml 2>sidecar.log
```

En stdio no mezclar stderr con stdout mediante `2>&1`, porque stdout transporta MCP. No hay rotación de logs ni endpoint de métricas incorporados; gestionarlos externamente si se necesitan.

## Diagnóstico por etapa

| Etapa / síntoma | Qué revisar |
| --- | --- |
| `[config]` al iniciar | Extensión, YAML/JSON válido, campos desconocidos, versión 1, tools no vacías y nombres únicos. |
| Variable de entorno requerida | Variable ausente/vacía, entorno del cliente/supervisor, posición de `--env-file`; también perfiles no utilizados. |
| JSON Schema inválido/no soportado | Raíz objeto, tipos correctos, referencias internas y restricciones del validador AJV estricto. |
| Regex/JSONata inválido | Sintaxis, grupos nombrados, flags y presupuesto de compilación del worker. |
| `[input]` o error de validación del SDK | Argumentos requeridos, tipos reales, límites y `additionalProperties`; los defaults del schema no rellenan datos. |
| `[parameters]` | Referencia inexistente, objeto donde se esperaba escalar, ruta `.`/`..`, stdin excesivo. |
| `[auth]` | Endpoint OAuth, credenciales, scopes, método Basic/body y contrato de respuesta Bearer. |
| HTTP 401/403 dentro de error de tool | Credenciales o autorización del servicio remoto. Un Bearer estático no se renueva solo. |
| HTTP 301/302 dentro de error de tool | Se necesita la URL final del servicio; no se siguen redirecciones. |
| Falló el request HTTP | Conectividad, DNS/TLS, deadline y límite de bytes. No se usan proxies salientes del entorno. |
| No se pudo iniciar ejecutable | PATH, ruta, permisos, directorio de trabajo e intérprete disponible. |
| Código de salida de CLI no aceptado | Ejecutar el CLI directamente con el mismo cwd/entorno para ver su diagnóstico. El servidor no devuelve stderr. |
| `[parse]` | Body/stdout vacío, JSON malformado, logs mezclados o regex sin coincidencia en modo `first`. |
| `[transform]` | Campos inexistentes, conversiones inválidas, ausencia de resultado, timeout o recursos del worker. |
| `[output]` | Objeto final incompatible, array raíz sin envolver o exceso de bytes después de transformar. |

Los mensajes genéricos evitan exponer detalles del servicio o credenciales. Reproducir el request/CLI con herramientas propias puede ser necesario para diagnosticar el upstream; no copiar automáticamente su salida completa a logs compartidos.

## Diagnóstico de transporte

| Síntoma | Interpretación y acción |
| --- | --- |
| Proceso stdio sin texto en pantalla | Puede estar funcionando normalmente y esperando un cliente MCP. |
| `Cannot find module .../dist/cli.js` o worker faltante | Compilar y conservar el directorio `dist/` completo. |
| `node` o CLI no encontrado desde una app gráfica | Revisar PATH del proceso o utilizar ruta absoluta al ejecutable. |
| HTTP 403 del endpoint MCP | Revisar Host/Origin y proxy antes de investigar auth del servicio remoto. |
| HTTP 404 del endpoint MCP | Usar una ruta publicada por el modo: `/mcp` y/o `/mcp/<grupo>`. No existen rutas por nombre de tool. |
| HTTP 413 | El body entrante supera `server.http.maxRequestBytes` o el límite del proxy. |
| HTTP 400/405 o fallo de negociación | Usar cliente Streamable HTTP y mensajes MCP válidos; no invocar como endpoint REST. |
| Puerto ocupado | Detener el proceso anterior o cambiar `server.http.port`. |
| `listen EPERM` en pruebas TCP | El entorno prohíbe abrir sockets. Ejecutar la suite en una terminal/CI donde esté permitido. |

La suite en memoria verifica protocolo y guards sin abrir un puerto, pero no reemplaza a `npm run test:network`, que la CI ejecuta en cada cambio.

## Límites funcionales actuales

La importación de OpenAPI está disponible mediante [scripts de generación](importar-openapi.md). No hay recarga en caliente, configuración TypeScript ejecutable, módulos Zod externos, workflows de múltiples requests, paginación automática, parsers CSV/XML, carga binaria/multipart, login OAuth por usuario, autorización por tool ni autenticación entrante propia.

Las tools dinámicas son dinámicas **por configuración al iniciar**. Elegir manualmente sus contratos y transformaciones es parte de integrar una API o CLI existente.

Ver [Desarrollo](desarrollo.md) para agregar capacidades y [Configuración](configuracion.md) para los límites ya disponibles.

## Operar varios grupos

Ver [Grupos de tools](grupos-de-tools.md) para `unified`, `separate` y `both`. Iniciar un proceso y usar los endpoints impresos por stderr. Todas las rutas comparten guards HTTP principales, puerto y ciclo de vida; las conexiones separadas no aportan control de acceso ni aislamiento de fallos. Configurar la autorización entrante en un proxy confiable para cada ruta publicada, incluyendo `/mcp` si publica el catálogo completo.

La configuración se valida de forma completa al iniciar. Un archivo hijo o una variable requerida faltante impide iniciar todos los grupos. Reiniciar para aplicar cambios; no hay recarga en caliente. Los logs de llamadas incluyen `group` y el nombre original de la tool. Operaciones duplicadas en un cliente suelen indicar conexiones simultáneas al endpoint unificado y al de su grupo.
