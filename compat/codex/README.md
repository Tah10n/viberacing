# Codex compatibility evidence

Each version directory contains a reviewed, public-safe extract of one exact stable Codex App Server
schema plus synthetic protocol fixtures. A directory is evidence for parser development; it does not
make that Codex version supported.

`manifest.json` records immutable upstream release provenance, the full generated stable-bundle
digest, checked-in extract digests, fixture digests, and the evidence still missing. The repository
checker ties any manifest marked `supported` to the public compatibility matrix. Candidate manifests
must remain outside that matrix.

Generate a stable bundle with the exact reviewed Codex release and without `--experimental`:

```text
codex app-server generate-json-schema --out <output-directory>
```

Never commit generated account values, local configuration, local paths, credentials, or the full
unreviewed schema bundle. Only the minimal account-related extracts belong here.
