# Third-party notices

This pre-release repository contains project source under [Apache License 2.0](LICENSE) and uses
third-party development tools under their own licenses. The lockfiles are authoritative for exact
dependency versions; this summary is not a substitute for the license text distributed by each
dependency.

## Direct runtime packages

| Component                                      | Purpose                   | Declared license |
| ---------------------------------------------- | ------------------------- | ---------------- |
| [next](https://github.com/vercel/next.js)      | Web application framework | MIT              |
| [React](https://github.com/facebook/react)     | User-interface runtime    | MIT              |
| [react-dom](https://github.com/facebook/react) | Browser rendering runtime | MIT              |

## Direct development tools

| Component                                                                   | Purpose                                  | Declared license |
| --------------------------------------------------------------------------- | ---------------------------------------- | ---------------- |
| [@eslint/js](https://github.com/eslint/eslint)                              | Core JavaScript lint rules               | MIT              |
| [@next/eslint-plugin-next](https://github.com/vercel/next.js)               | Next.js correctness and Web Vitals rules | MIT              |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped)           | Node.js type declarations                | MIT              |
| [@types/react](https://github.com/DefinitelyTyped/DefinitelyTyped)          | React type declarations                  | MIT              |
| [@types/react-dom](https://github.com/DefinitelyTyped/DefinitelyTyped)      | React DOM type declarations              | MIT              |
| [@vitest/coverage-v8](https://github.com/vitest-dev/vitest)                 | V8-backed test coverage                  | MIT              |
| [axe-core](https://github.com/dequelabs/axe-core)                           | Automated accessibility checks           | MPL-2.0          |
| [cspell](https://cspell.org/)                                               | Offline spelling policy checks           | MIT              |
| [ESLint](https://github.com/eslint/eslint)                                  | Static code analysis                     | MIT              |
| [eslint-plugin-react-hooks](https://github.com/facebook/react)              | Rules of Hooks checks                    | MIT              |
| [jsdom](https://github.com/jsdom/jsdom)                                     | Test-only browser DOM                    | MIT              |
| [markdownlint-cli2](https://github.com/DavidAnson/markdownlint-cli2)        | Markdown policy checks                   | MIT              |
| [Prettier](https://prettier.io/)                                            | Repository formatting                    | MIT              |
| [TypeScript](https://github.com/microsoft/TypeScript)                       | Static type checking                     | Apache-2.0       |
| [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint) | Type-aware TypeScript lint rules         | MIT              |
| [Vitest](https://github.com/vitest-dev/vitest)                              | Unit and component test runner           | MIT              |
| [YAML](https://eemeli.org/yaml/)                                            | Safe parsing of repository YAML policy   | ISC              |

The root Rust workspace currently has no third-party crates. `compose.yaml` references an official
PostgreSQL image for disposable local development; the image is pulled separately and is not
redistributed in this source tree.

The machine-readable [dependency inventory](docs/reference/dependency-inventory.json) records every
locked npm package, every future non-workspace Cargo package, and reviewed external CI/container
artifact. It is deterministically compared with lockfiles and installed package manifests. The
CSpell graph includes an English common-misspellings dictionary declared under CC BY-SA 4.0 and an
argument parser declared under Python-2.0; both are development-only inputs and are not
redistributed as part of the planned product. The web graph also contains MPL-2.0 Lightning CSS
build/runtime variants and the development-only axe-core checker, CC-BY-4.0 browser compatibility
data, CC0 metadata, and other permissive declarations recorded exactly in the inventory. The unused
optional `sharp`/libvips graph is explicitly removed from Next.js resolution and must be reviewed
before image optimization is enabled. The local type-only sentinel is not a Sharp implementation,
and production imports of the absent runtime are forbidden.

## Release obligation

Before distributing an application, container, connector, generated asset, or installer, the release
process must:

1. Generate a complete dependency and asset inventory from the immutable release source.
2. Review licenses for source, binary distribution, notices, attribution, modification, patent, and
   network-use obligations.
3. Include required license texts and notices in the artifact or an adjacent durable bundle.
4. Produce an SBOM and verify it matches the built artifact.
5. Block copyleft, proprietary, unknown, or incompatible material until an explicit legal and
   architectural decision is recorded.

No third-party source visual assets, fonts, or audio are currently distributed. The repository does
contain one project-generated social preview image. Its creation method, source-material statement,
sanitation history, checksum, accessibility text, and release-review status are recorded in
[asset provenance](docs/reference/ASSET_PROVENANCE.md).
