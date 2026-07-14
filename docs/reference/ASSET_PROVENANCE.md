# Asset provenance

Every non-code visual distributed from this repository must have a reviewable origin, license or
permission basis, integrity digest, privacy review, and regeneration record. An asset is not safe
merely because it looks generic or was produced by a generation tool.

## Social preview race scene

| Field                       | Record                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repository path             | `apps/web/app/opengraph-image.png`                                                                                                                                       |
| Purpose                     | Open Graph and social preview for the synthetic web prototype                                                                                                            |
| Created                     | 2026-07-14                                                                                                                                                               |
| Method                      | OpenAI image generation capability in Codex; no input or reference image                                                                                                 |
| Prompt brief                | Wide pixel-art night race with five original cars, a checkered finish, neon city lighting, no words, no logos, no people, and no real automotive branding or trade dress |
| Dimensions                  | 1731 by 909 pixels                                                                                                                                                       |
| Final size                  | 1,682,527 bytes                                                                                                                                                          |
| Final SHA-256               | `3e606b5fb7ac5889d55e53b4c3c301bb65711a16feedfed207c0a20f359040e6`                                                                                                       |
| Accessibility text          | `apps/web/app/opengraph-image.alt.txt`                                                                                                                                   |
| Third-party source material | None supplied or intentionally reproduced                                                                                                                                |
| Distribution basis          | Project-generated output intended for distribution with the Apache-2.0 repository, subject to the release legal review in `THIRD_PARTY_NOTICES.md`                       |

### Metadata sanitation

The generation service returned a 1,707,461-byte PNG with SHA-256
`fcf1a900f0d3bb08571ab6fc03511da2af5961eb8f6edcb7b991cf189ab1de6e`. It contained a signed `caBX`
C2PA provenance chunk with service certificate material and stable identifiers. No user identity,
input image, prompt, local path, account credential, or secret was observed, but the chunk was
removed instead of weakening the repository's public-data scanner.

`scripts/sanitize-png-metadata.mjs` retained the PNG signature and all `IHDR`, `IDAT`, and `IEND`
chunks byte-for-byte. The resulting file has no ancillary metadata chunks. The original metadata-
bearing file is not retained in the repository.

Reproduce the sanitation after replacing this asset:

```text
node scripts/sanitize-png-metadata.mjs apps/web/app/opengraph-image.png
pnpm run test:png-content-policy
pnpm run check:public
```

Then update both digests and sizes in this record, review the rendered image for protected content
and accidental text, and inspect the exact staged binary with the normal publication gates.
