# Agent provider compatibility

Compatibility status: clean AgentAccount target accepted; Codex reader implemented locally but
provider activation remains blocked on final batch pairing and end-to-end evidence.

The table records only the final ADR 0076 reader/accounting path. Codex now has the closed
provider-neutral trait implementation, exact version/revision/scope mapping, privacy sentinels, and
final signed Usage Sync bytes. It remains `Recognized` until the same tree proves final batch
discovery/pairing/activation and first-sync accounting end to end.

| Provider ID   | State      | Required local surface and accounting evidence                                                                 | Current exact gap                                                                                        |
| ------------- | ---------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `codex`       | Recognized | Exact App Server `0.144.5`, reader `codex_app_server_0_144_5_v1`, revision 1, `agent_account`, explicit attach | Final batch pairing/activation and first-sync E2E absent; connector package/release evidence also absent |
| `claude_code` | Recognized | Exact documented local schema and disjoint/aggregate token semantics                                           | No checked exact local schema, account-domain rule, immutable fixture digest, reader, or final V1 E2E    |
| `opencode`    | Recognized | Exact documented read-only local store and cumulative account/day rules                                        | No checked stable schema/account boundary, immutable fixture digest, reader, or final V1 E2E             |
| `qwen_code`   | Recognized | Exact documented local usage surface and UTC/account semantics                                                 | No exact evidence for a safe usage surface, reader, accounting revision, or E2E                          |
| `cline`       | Recognized | Exact documented local usage surface and UTC/account semantics                                                 | No exact evidence for a safe usage surface, reader, accounting revision, or E2E                          |
| `aider`       | Recognized | Exact documented local usage surface and UTC/account semantics                                                 | No exact evidence for a safe usage surface, reader, accounting revision, or E2E                          |

## Admission requirements

A row becomes `Supported` only when the same commit includes:

1. exact admitted agent and local-schema versions or immutable schema digest;
2. fixed safe storage roots and link/reparse/device/size/encoding bounds;
3. a closed reader output type;
4. documented aggregate-versus-component and repeated/cumulative deduplication;
5. exact UTC-day behavior;
6. stable opaque account-domain handling or explicit attach requirement;
7. accounting scope and overlap exclusions;
8. positive, boundary, corrupt, drift, and prohibited-data sentinel fixtures;
9. discovery, pairing, first sync, repeat sync, multi-device, account/day, and weekly-rank evidence;
10. supported connector and platform versions with release evidence.

## Current support declaration

No provider is currently activated for new server-side AgentAccounts. The local Codex development
sync path can produce the final signed `UsageSyncV1` bytes only from an already active synthetic
binding; this does not bypass the recognized database state or create a working batch connection.
Other recognized providers remain unavailable product information with the precise gap.

## Update policy

Semantic accounting change creates a new immutable accounting revision. Schema drift fails closed. A
disabled or recognized row never silently falls back to another provider, guesses fields, uses
model/price conversion, parses prompt/code text, or reuses historical Codex compatibility evidence.
