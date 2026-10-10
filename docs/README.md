# Documentación de Underqubit Sidecar MCP

[English](en/README.md)

Underqubit Sidecar MCP publica tools MCP a partir de un archivo YAML o JSON. Cada tool valida sus argumentos, ejecuta un request HTTP o un CLI local, estructura la respuesta y comprueba que cumpla el esquema de salida.

El archivo de configuración es la integración: agregar una tool no requiere modificar TypeScript. Los cambios se aplican al reiniciar el servidor.

## Guías

| Documento | Qué explica |
| --- | --- |
| [Inicio rápido](inicio-rapido.md) | Instalación, primera ejecución, conexión desde un cliente y comandos disponibles. |
| [Configuración](configuracion.md) | Referencia de campos comunes, JSON Schema, variables, plantillas, defaults y límites. |
| [Tools HTTP](tools-http.md) | Mapeo de argumentos a una API REST mediante Axios. |
| [Tools CLI](tools-cli.md) | Ejecutables, argumentos, stdin, entorno, rutas y códigos de salida. |
| [Autenticación](autenticacion.md) | API key, Bearer, Basic, OAuth2 y credenciales para CLIs. |
| [Respuestas](respuestas.md) | Parsers JSON/texto/regex, transformaciones JSONata y respuestas MCP. |
| [Arquitectura](arquitectura.md) | Módulos, flujo de datos, estado compartido y cancelación. |
| [Desarrollo](desarrollo.md) | Entorno de trabajo, pruebas, extensiones, generación de esquemas y CI. |
| [Operación y diagnóstico](operacion-y-diagnostico.md) | Despliegue HTTP, logs, mantenimiento, errores y limitaciones. |

## Por dónde empezar

**Para usar el servidor:** seguir [Inicio rápido](inicio-rapido.md), elegir [HTTP](tools-http.md) o [CLI](tools-cli.md) y completar el [procesamiento de respuestas](respuestas.md).

**Para desarrollar:** leer [Arquitectura](arquitectura.md) y [Desarrollo](desarrollo.md). La [referencia de configuración](configuracion.md) describe el contrato que debe preservarse al cambiar el código.

**Para desplegar o investigar un fallo:** consultar [Operación y diagnóstico](operacion-y-diagnostico.md).

## Recursos del repositorio

| Recurso | Uso |
| --- | --- |
| [Skill para agentes de IA](../skills/underqubit-sidecar-mcp/SKILL.md) | Guía en inglés para usar, configurar y diagnosticar las integraciones del servidor. |
| [Ejemplo CLI en YAML](../examples/cli.yaml) | Dos tools locales, sin servicios externos ni credenciales. |
| [Ejemplo CLI en JSON](../examples/cli.json) | Una tool que recibe y devuelve un mensaje. |
| [Ejemplo HTTP](../examples/http.yaml) | Consulta de usuario con Bearer y transformación de respuesta. |
| [Ejemplo Jira Cloud](../examples/jira.json) | Cuatro tools de lectura de tickets, con autenticación y paginación. Ver [configuración de Jira](tools-http.md#ejemplo-jira-cloud). |
| [Ejemplo de autenticación](../examples/auth.yaml) | Todos los perfiles admitidos y una tool con OAuth2. |
| [Variables de ejemplo](../.env.example) | Nombres de variables usados por los ejemplos HTTP. |
| [JSON Schema de configuración](../schema/config.schema.json) | Autocompletado y validación estructural en editores. |
| [Evaluaciones](../evaluations/questions.xml) | Preguntas sobre un conjunto fijo de datos, para evaluar el uso de las tools. |

## Alcance de esta documentación

Describe el formato de configuración `version: 1` y la implementación presente en el repositorio. No presupone que el paquete esté publicado en npm: los comandos usan la compilación local en `dist/`.

Todos los comandos se ejecutan desde la raíz del proyecto salvo indicación contraria. Los bloques rotulados como **fragmento** se incorporan a una configuración completa; no son archivos ejecutables por sí solos. Las URLs `example.com` y `example.org` representan servicios a reemplazar.

La fuente de verdad de los campos es [src/config-schema.ts](../src/config-schema.ts). Las reglas que requieren lógica adicional —referencias, URLs, entorno y compilación de parsers— están en [src/config.ts](../src/config.ts).
