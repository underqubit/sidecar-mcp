# Sitio HTML de documentación

[English](en/documentation-site.md) · [Volver al índice](README.md)

La documentación HTML se genera desde los Markdown de `docs/` y `docs/en/`. Las dos versiones tienen navegación lateral, índice de secciones, enlaces permanentes y un selector que abre la traducción de la misma guía. El diseño se adapta a móviles y permite imprimir las páginas.

## Generar y abrir el sitio

Desde un checkout completo, con Node.js 24 o superior:

```sh
npm ci
npm run docs:build
```

Abrir `docs/html/index.html` en el navegador y elegir Español o English. También se puede servir `docs/html` desde cualquier servidor estático. Los enlaces entre guías son relativos, por lo que funcionan tanto en un dominio propio como bajo el prefijo de un proyecto de GitHub Pages.

El generador borra y reconstruye únicamente `docs/html`. El HTML generado se incluye en el repositorio para consultarlo directamente; no editarlo a mano. Después de modificar Markdown, regenerarlo antes del commit. GitHub Actions siempre vuelve a generarlo desde las fuentes antes de publicar.

Para generar HTML no hace falta compilar el servidor MCP. La verificación adicional `npm run docs:check-schema` sí compila el proyecto para probar los esquemas documentados con el validador real. El workflow ejecuta esta verificación antes de generar y desplegar. `marked` es una dependencia de desarrollo que convierte Markdown, tablas y bloques de código a HTML. Las etiquetas HTML literales se escapan. El proceso valida enlaces locales, imágenes y anclas; termina con error si encuentra un destino inválido.

## Editar contenido y navegación

1. Editar la guía en español y su equivalente en `docs/en/`.
2. Si se agrega una guía, registrar ambas rutas en `docs/site/pages.json`. El orden define la navegación. Todas las guías de ambos directorios deben estar registradas.
3. Ejecutar `npm run docs:build` y revisar ambas versiones, también con una ventana estrecha.

El título y el índice de cada página se extraen de los encabezados Markdown. Los enlaces entre guías se convierten a `.html`, conservando las anclas. Los bloques de código tienen un botón de copia cuando el navegador permite acceso al portapapeles.

Los enlaces a código fuente y ejemplos apuntan al checkout al generar localmente. En GitHub Actions se usa automáticamente el repositorio y commit de la ejecución. Para generar un sitio fuera de Actions con enlaces a un repositorio público:

```sh
DOCS_REPOSITORY_URL=https://github.com/OWNER/REPOSITORY \
DOCS_SOURCE_REF=main npm run docs:build
```

No se copian archivos del repositorio al sitio. Si una referencia apunta a un archivo local ausente del checkout —por ejemplo, una integración no versionada— se conserva su texto sin un enlace de descarga.

## Identidad visual

Los estilos adaptan el skill `underqubit-proposals` de `underqubit-skills`: navy `#0B243F`, verde `#4DBE94`, títulos Lato y tablas con cabecera navy. El logo se extrajo de su `assets/portada.pdf`; las fuentes Lato Regular y Bold se copiaron del skill, con su licencia SIL OFL. La procedencia está registrada en `docs/site/assets/PROVENANCE.txt`.

Los assets se mantienen en `docs/site/assets/` y se copian a `docs/html/assets/`. La generación no depende de tener instalado el skill. Fuentes, logo y estilos se sirven localmente, sin Google Fonts.

Los diagramas Mermaid se renderizan con la versión fija `11.12.1` desde jsDelivr y requieren conexión. Si no carga el renderizador, queda visible el código original del diagrama. El resto del sitio funciona sin conexión; el portapapeles depende de las capacidades y permisos del navegador.

## Despliegue con GitHub Pages

En el repositorio de GitHub, configurar una vez **Settings → Pages → Build and deployment → Source → GitHub Actions**. Esta configuración requiere acceso administrativo al repositorio. No hace falta agregar un token personal: el workflow usa `GITHUB_TOKEN` y el entorno `github-pages`.

El workflow `.github/workflows/docs.yml`:

- Genera y verifica el sitio en pull requests que cambien `docs/**`, el generador, el verificador de esquemas, `src/config.ts`, `src/config-schema.ts`, las dependencias o el propio workflow, sin desplegar.
- Publica en GitHub Pages al recibir esos cambios en `main`.
- Permite ejecución manual con **Actions → Documentation → Run workflow** desde `main`.
- Sube exclusivamente `docs/html` como artefacto, con permisos de escritura en Pages limitados al job de despliegue.
- Expone la URL final en el entorno `github-pages` de la ejecución.

La CI del servidor continúa funcionando en `.github/workflows/ci.yml`. El despliegue documental depende de su propia generación y validación, no de la suite del servidor. Las reglas de protección del entorno `github-pages`, si existen, también aplican. El workflow queda listo en el repositorio; el sitio se publica cuando esos cambios se suben a GitHub y Pages está habilitado.

Si falla `Configure Pages`, revisar la configuración anterior y la disponibilidad de Pages para el repositorio. Si falla la generación, el log indica la guía o el enlace a corregir. Si se cambia la rama principal, actualizar el filtro y las condiciones `refs/heads/main` del workflow.

Referencia: [workflows personalizados para GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
