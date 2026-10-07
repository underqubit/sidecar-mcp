# Autenticación y variables de entorno

[Volver al índice](README.md)

Hay dos direcciones de autenticación: **servidor MCP hacia servicios externos** y **cliente hacia el endpoint MCP**. Los perfiles de `auth` resuelven la primera. El acceso entrante HTTP se delega a una red privada o proxy; no lo protege declarar un perfil de API.

## Declarar y seleccionar perfiles

**Fragmento** de configuración:

```yaml
auth:
  backend:
    type: bearer
    token: '${env.API_TOKEN}'
```

Una tool HTTP selecciona ese perfil mediante `execution.auth: backend`. El nombre es literal. Las tools pueden compartirlo. Si se omite `execution.auth` o se selecciona un perfil `type: none`, no se agregan credenciales; los headers que la configuración declare explícitamente se mantienen.

Los secretos requieren una referencia completa `${env.VARIABLE}`, con nombre convencional de variable. No se admiten secretos literales, interpolación parcial ni argumentos `${input...}` en esos campos. La configuración y las referencias no se anuncian al modelo como parámetros MCP.

## Tipos disponibles

Los siguientes son **fragmentos** del mapa `auth`:

```yaml
auth:
  public_api:
    type: none

  key_in_header:
    type: apiKey
    in: header
    name: X-API-Key
    value: '${env.API_KEY}'

  key_in_query:
    type: apiKey
    in: query
    name: api_key
    value: '${env.API_KEY}'

  fixed_token:
    type: bearer
    token: '${env.API_TOKEN}'

  username_password:
    type: basic
    username: '${env.API_USERNAME}'
    password: '${env.API_PASSWORD}'

  service_oauth:
    type: oauth2
    tokenUrl: '${env.OAUTH_TOKEN_URL}'
    clientId: '${env.OAUTH_CLIENT_ID}'
    clientSecret: '${env.OAUTH_CLIENT_SECRET}'
    scopes: [users.read]
    tokenAuthMethod: basic
    timeoutMs: 10000
```

| Tipo | Comportamiento |
| --- | --- |
| `apiKey` | Inserta el secreto en el header o parámetro query de nombre fijo. |
| `bearer` | Escribe `Authorization: Bearer <token>`. El valor del entorno debe contener solo el token. |
| `basic` | Construye `Authorization: Basic ...` con usuario y contraseña. |
| `oauth2` | Obtiene un access token por client credentials y lo envía como Bearer. |
| `none` | No modifica la autenticación del request. |

Auth reemplaza el header/query del mismo nombre que existiera antes. El adaptador HTTP configura posteriormente Content-Type cuando envía un body; no usar ese header como ubicación de una API key. No hay una lista de múltiples perfiles por tool.

## OAuth2 client credentials

Se realiza un POST form URL-encoded a `tokenUrl` con `grant_type=client_credentials`. `scopes` es una lista de strings literales; se une con espacios en `scope`. Si está vacía, se omite ese campo.

| Campo | Obligatorio / default |
| --- | --- |
| `tokenUrl` | Obligatorio; HTTP/HTTPS, sin usuario/contraseña embebidos ni fragmento. Fijo o desde entorno. |
| `clientId` | Obligatorio, referencia a entorno. |
| `clientSecret` | Obligatorio, referencia a entorno. |
| `scopes` | `[]`. |
| `tokenAuthMethod` | `basic`; alternativa `body`. |
| `timeoutMs` | `10000`. |

Con `basic`, las credenciales se codifican para el header Basic del endpoint OAuth. Con `body`, se envían como `client_id` y `client_secret` en el formulario.

La respuesta debe ser un objeto JSON con `access_token` string no vacío y `token_type` igual a Bearer, sin distinguir mayúsculas. Un `expires_in` numérico, finito y positivo habilita caché. Si falta o es inválido, el token se usa para los consumidores de esa obtención, pero no se conserva para futuras llamadas.

La caché vive en memoria, por perfil y proceso. La vigencia efectiva resta al TTL el menor valor entre 30 segundos y el 10 % del TTL. No existe un timer de renovación: una llamada posterior solicita otro token cuando el anterior deja de estar vigente.

Las llamadas concurrentes al mismo perfil comparten una obtención pendiente. Cancelar un consumidor no cancela los demás; cuando no quedan consumidores, se aborta la obtención. Al cerrar el runtime se cancelan requests pendientes y se elimina la caché.

El endpoint OAuth admite solo estados 2xx, no sigue redirects y limita request/respuesta a 64 KiB. No hay refresh tokens, persistencia, login interactivo, almacenamiento por usuario ni retry automático de una operación después de un 401 del servicio.

## Credenciales de CLI

La autenticación la implementa el CLI existente. Usar `execution.env` o `execution.stdin` según su contrato. **Fragmento**:

```yaml
execution:
  type: cli
  command: service-cli
  args: [account, show, --json]
  env:
    SERVICE_TOKEN: '${env.SERVICE_TOKEN}'
    HOME: '${env.HOME}'
```

Si el programa lee un objeto JSON por stdin, el body podría ser `stdin: {token: '${env.SERVICE_TOKEN}'}`. Esto solo funciona si el CLI documenta ese protocolo. No se inyecta automáticamente un formato de login.

## Cargar y rotar secretos

El proceso puede recibir variables de su supervisor, del cliente stdio o de Node con `--env-file`. No existe carga automática de `.env` ni resolución contra un gestor de secretos externo.

```sh
node --env-file=.env dist/cli.js validate --config examples/auth.yaml
node --env-file=.env dist/cli.js serve --config examples/auth.yaml
```

[examples/auth.yaml](../examples/auth.yaml) incluye todos los perfiles, por lo que requiere todas sus variables, incluso si una tool solo usa OAuth. [.env.example](../.env.example) contiene nombres y valores de muestra, no credenciales operativas.

Para rotar credenciales, actualizar el entorno del proceso y reiniciarlo. No basta con editar un archivo `.env` mientras el servidor está en ejecución.

Los mensajes de error evitan imprimir bodies de auth y secretos. Las respuestas exitosas provienen de la API o CLI: no existe un filtro universal que quite credenciales si el propio servicio las devuelve. Seleccionar únicamente los campos necesarios en la transformación y el esquema de salida.

## Autenticación entrante a MCP

`allowedHosts` y `allowedOrigins` verifican el destino y origen de requests; no identifican ni autorizan personas. No se valida un Bearer entrante, no existe un login propio y no se implementa descubrimiento OAuth entrante.

Si se publica HTTP, el proxy debe autenticar clientes y restringir el acceso directo al backend. Los clientes admitidos comparten la configuración y credenciales de servicio del proceso. Ver [Operación y diagnóstico](operacion-y-diagnostico.md).
