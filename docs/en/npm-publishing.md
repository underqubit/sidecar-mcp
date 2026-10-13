# License and npm publishing

[Español](../publicacion-npm.md) · [Back to index](README.md)

The project is distributed under the [Apache License 2.0](../../LICENSE). The manifest declares `license: Apache-2.0` and is configured to publish `underqubit-sidecar-mcp` as a public package. Preparing the repository does not mean a version is already available on the registry.

## Use a published version

Requires Node.js 24 or later. Once the specified version has been published:

```sh
npx -y underqubit-sidecar-mcp@1.0.0 serve \
  --config /absolute/path/config.yaml --transport stdio
```

You can also install it locally:

```sh
npm install underqubit-sidecar-mcp@1.0.0
npx underqubit-sidecar-mcp validate --config ./config.yaml
```

Configuration belongs to the user; the package does not create or load `.env` automatically. To load it with a local installation:

```sh
node --env-file=.env node_modules/underqubit-sidecar-mcp/dist/cli.js \
  serve --config ./config.yaml --transport stdio
```

Examples live in `node_modules/underqubit-sidecar-mcp/examples`. If you copy a CLI configuration elsewhere, also copy its referenced scripts or adjust their paths. Compositions retain the relative path behavior documented in [Tool groups](tool-groups.md).

The package includes the import scripts, ready to run without building:

```sh
node node_modules/underqubit-sidecar-mcp/scripts/openapi-to-config.mjs \
  --input ./api.yaml --output ./tools.json
```

This is a CLI package: it does not declare a public JavaScript API through `main` or `exports`.

## Published contents

`package.json.files` allows only compiled code and its maps/declarations, TypeScript sources for those maps, license, READMEs, documentation, schema, skill, selected examples, and OpenAPI scripts. npm automatically includes `package.json`, README, and LICENSE.

The package excludes `.env`, `node_modules`, tests, caches, and `.tgz` files. The Jira example (`examples/jira.json`) and its diagnostic script (`scripts/diagnose-jira.mjs`) are not published either: they are available only in the repository. Some guides link to files that exist only in the checkout.

- `prepack` cleans `dist`, builds, regenerates the schema, and makes the CLI executable. It runs when using `npm pack` or publishing from the checkout.
- `prepublishOnly` runs `npm run check` before publishing from the checkout.
- There are no `install`, `postinstall`, or `prepare` hooks: consumers receive compiled JavaScript and do not need TypeScript or development dependencies.

Development and packaging tasks run from the complete checkout, not the installed `node_modules` directory.

## Verify the package

From the repository:

```sh
npm ci
npm run check
npm run test:network
npm run check:package
npm pack --dry-run
```

`check:package` builds a real tarball in a temporary directory, checks its contents, and installs it as a dependency of a consumer project. It uses production versions from the lockfile for reproducibility. It verifies the binary through `npm exec`, an MCP stdio client, tools from two groups, the worker, and the OpenAPI converter. It removes the temporary directory afterward. Nothing is published.

If dependencies are already in the npm cache, use `npm run check:package -- --offline`. The normal check may download dependencies. `test:network` requires permission to bind localhost ports; the package check uses stdio and needs no inbound ports.

CI also runs `check:package`. To retain a tarball for manual review, run `npm pack`; Git ignores `.tgz` files.

## Publish a version

Before publishing, confirm the name is available or belongs to the publishing account:

```sh
npm view underqubit-sidecar-mcp name version maintainers
npm login
npm whoami
```

DNS or connection failures do not establish availability. An existing name requires publication permissions. If choosing a scoped name, update `name` and synchronize `package-lock.json`; the CLI command can remain `underqubit-sidecar-mcp`.

The manifest declares `homepage` and `author` with the Underqubit website (`https://underqubit.com`). Add `repository` and `bugs` once a confirmed public repository URL exists; npm does not require them, and they are not filled with invented URLs.

The manifest declares version `1.0.0`. Increment the version for subsequent releases; npm does not allow replacing an existing version. For example, `npm version patch` updates the manifest and lockfile and normally creates a commit/tag: run it with Git in the intended state for that step.

```sh
npm publish --dry-run
# Actual publication, only when you decide to release:
npm publish
```

`publishConfig` pins the registry to `https://registry.npmjs.org/` and access to public. The account must satisfy npm's current authentication/2FA requirements. A dry run checks packaging but does not establish account permissions or reserve the name.

References: [package.json fields](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/), [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/), [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
