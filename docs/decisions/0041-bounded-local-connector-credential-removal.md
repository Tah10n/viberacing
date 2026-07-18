# ADR 0041: Bounded local connector credential removal

- Status: Accepted (local command implemented; released-platform evidence pending)
- Date: 2026-07-18
- Decision owners: Connector, Security, Privacy, Product, and Operations
- Supersedes: None
- Superseded by: None

## Context

ADR 0030 stores one versioned connector credential under a domain-separated account derived from the
canonical service origin and device label. The local connector could create, resume, and use that
record but had no bounded way to remove it. Generic credential-manager instructions would be
platform-specific, could target the wrong entry, and would expose internal account naming.

Deleting the local record is not the same as revoking the registered server device. A copied key or
another process that retained it can continue exercising the source-bound device authority until the
user revokes that device in the authenticated account. The command must not imply otherwise or
quietly gain browser, session, database, pairing, sync, proposal, or administrative authority.

## Decision

Add one exact local-only command:

```text
viberacing-connector forget-local --origin <https-origin> --label <device-label>
```

The command reuses the closed canonical-origin and bounded-label validation from `connect`, derives
the same opaque credential-store account, and calls only the native credential API's delete
operation. It does not load or decode the record, construct a signing capability, inspect its state,
start Codex, contact Vibe Racing, follow a redirect, or read browser or database state.

Deletion is idempotent: an absent native entry and a successfully deleted entry produce the same
success result. Other credential-store failures remain the existing generic secure-storage error.
Success emits exactly one non-reflective line:

```text
No credential remains in this local store. This did not revoke server device authority; review your Vibe Racing account.
```

The command is named `forget-local`, not `disconnect` or `revoke`, because it has no server-side
effect. The authenticated account's existing immediate device-revoke control remains the only
implemented user path that removes submission and proposal authority. The proposal-only Agent Skill
is explicitly forbidden from invoking this destructive local command. Deletion happens before the
success line is written; an output failure can therefore make the result locally ambiguous, but an
exact retry is safe because deletion is idempotent.

## Security and privacy consequences

Removing the exact native entry shortens local retention of the private key, anonymous pairing
client ID, and pending or active binding. The command receives only values already present in its
argument vector and adds no field, log, diagnostic, file, browser storage, network destination, or
server record. It intentionally reveals neither whether an entry existed nor its state or
identifiers.

The user can lose the only local copy of an active key, and local deletion cannot erase copies made
by malware, operating-system backup, or another process. Server authority therefore remains until
separate authenticated revoke. Deleting a pending record can leave an authority-free pending server
transaction until its existing expiry cleanup; deleting an active record can leave a registered but
unusable local device. Reconnecting before account reconciliation creates a new key rather than
recovering the deleted one.

Affected invariants are VR-PUBLIC-001, VR-DEVICE-001, and VR-DEVICE-002. Primary attacker stories
are VR-ABUSE-DEVICE-KEY-THEFT, VR-ABUSE-DEVICE-ESCALATION, and VR-ABUSE-CONNECTOR-LOCAL. Trust
boundary TB-04 remains local; the command does not cross TB-05.

## Alternatives considered

- **Call the command `disconnect` or `revoke`:** rejected because either name would overstate a
  server-side security effect that does not occur.
- **Load the record and print its device ID before deletion:** rejected because deletion needs no
  key material and output must not expose a persistent identifier.
- **Automatically call the account revoke route:** rejected because the connector has no browser
  session or profile-administration authority and device credentials cannot revoke devices.
- **Delete every Vibe Racing credential:** rejected because the action must remain scoped to one
  exact canonical origin and label.
- **Treat a missing entry as an error:** rejected because that would disclose local store state and
  make safe cleanup scripts unnecessarily non-idempotent.
- **Document manual OS credential-manager deletion only:** rejected because platform-specific UI or
  account naming is easier to misuse and cannot share the connector's exact input validation.

## Migration and rollback

There is no database, contract, dependency, or credential-record migration. The command removes the
existing native entry in place and cannot restore it. Rolling back the binary removes the command
but does not recreate any credential already deleted; the user must reconcile server device state
and run `connect` again if a new local credential is desired.

A future rotation design must compose new-key activation and old-device revocation explicitly. It
must not reinterpret this local deletion as proof of server revocation.

## Verification

Repository evidence covers:

- exact command parsing and rejection of missing, duplicate, or extra arguments;
- canonical origin and label validation inherited from the existing closed parser;
- a delete-only fake proving that success performs exactly one deletion without load or save;
- identical, identifier-free success output and no output on credential-store failure;
- output-failure evidence showing that deletion has already completed and an exact retry is safe;
- native adapter handling that maps both successful deletion and `NoEntry` to success while keeping
  every other backend error generic; and
- Agent Skill drift checks that forbid invoking `forget-local` through proposal authority.

Tests use an injected store and do not touch a real Windows Credential Manager, macOS Keychain, or
Linux Secret Service entry. There is no clean-machine runtime result, server revoke composition,
rotation, installer/uninstaller integration, released binary, or deployment evidence.

## References

- [Bounded connector pairing transport and native key custody](0030-bounded-connector-pairing-transport.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Connector boundary](../../crates/connector/README.md)
