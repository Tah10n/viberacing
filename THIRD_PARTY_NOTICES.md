# Third-party notices

This pre-release repository contains project source under [Apache License 2.0](LICENSE) and uses
third-party development tools under their own licenses. The lockfiles are authoritative for exact
dependency versions; this summary is not a substitute for the license text distributed by each
dependency.

## Direct development tools

| Component                                                            | Purpose                                | Declared license |
| -------------------------------------------------------------------- | -------------------------------------- | ---------------- |
| [markdownlint-cli2](https://github.com/DavidAnson/markdownlint-cli2) | Markdown policy checks                 | MIT              |
| [Prettier](https://prettier.io/)                                     | Repository formatting                  | MIT              |
| [YAML](https://eemeli.org/yaml/)                                     | Safe parsing of repository YAML policy | ISC              |

The root Rust workspace currently has no third-party crates. `compose.yaml` references an official
PostgreSQL image for disposable local development; the image is pulled separately and is not
redistributed in this source tree.

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

No third-party visual assets, fonts, audio, or generated image outputs are currently distributed.
