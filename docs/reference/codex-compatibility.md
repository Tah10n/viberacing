# Codex compatibility matrix

## Current support

Compatibility status: no supported versions.

No Codex version and no Vibe Racing connector version is supported. The connector workspace and
version-specific compatibility fixtures do not exist yet. This empty matrix is fail-closed evidence,
not an invitation to try an arbitrary local version.

| Codex version | Stable schema digest | Compatible connector | Platforms tested | Status and evidence                                 |
| ------------- | -------------------- | -------------------- | ---------------- | --------------------------------------------------- |
| None          | Not available        | Not released         | None             | Unsupported until the full admission process passes |

## Admission requirements

A matrix row needs all of the following:

- immutable Codex release identity and canonical provenance;
- generated stable App Server schema digest with experimental API disabled;
- committed minimal schema extract and synthetic fixtures;
- exact allowlisted method/field review;
- proof that prohibited account, prompt, repository, credential, and process data cannot enter the
  connector payload or diagnostics;
- handshake, framing, nullable/missing/unknown field, malformed date, integer bound, oversized
  output, timeout, overload, stderr, and cleanup tests;
- supported-platform clean-machine results;
- compatible signed connector range, limitations, reviewer, and release notes.

The generic process and version rules are defined in the
[compatibility policy](../architecture/COMPATIBILITY_POLICY.md). A scheduled latest-version probe
can open an issue but cannot edit this matrix, release an artifact, or turn an unknown version into
a supported version.

## Planned stable surface

The implementation plan currently names `account/read` for a local auth-mode decision and
`account/usage/read` for bounded usage summary/daily buckets. These names are a design target, not a
current support claim. The first proposed row must prove both methods and every consumed field exist
on the pinned stable schema without experimental capability.

All other App Server methods and transports are denied for connector v1. In particular, Vibe Racing
does not consume thread, turn, item, approval, MCP, file, shell, login, conversation, or repository
surfaces, and it does not connect over WebSocket.
