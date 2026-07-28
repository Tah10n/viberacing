# Agent provider compatibility

Compatibility status: clean AgentAccount target accepted; no final provider reader is supported yet.

The table records only the final ADR 0076 reader/accounting path. The old Codex `0.144.5` App Server
candidate proves a historical local parser, not the final discovery, AgentAccount, privacy-sentinel,
multi-device, or end-to-end compatibility contract.

| Provider ID   | State      | Required local surface and accounting evidence                          | Current exact gap                                                                                                    |
| ------------- | ---------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `codex`       | Recognized | Stable bounded usage surface, UTC day, cumulative total, account domain | Final built-in discovery reader, AgentAccount domain/scope, privacy sentinel, batch pairing, and final V1 E2E absent |
| `claude_code` | Recognized | Exact documented local schema and disjoint/aggregate token semantics    | No checked exact local schema, account-domain rule, immutable fixture digest, reader, or final V1 E2E                |
| `opencode`    | Recognized | Exact documented read-only local store and cumulative account/day rules | No checked stable schema/account boundary, immutable fixture digest, reader, or final V1 E2E                         |
| `qwen_code`   | Recognized | Exact documented local usage surface and UTC/account semantics          | No exact evidence for a safe usage surface, reader, accounting revision, or E2E                                      |
| `cline`       | Recognized | Exact documented local usage surface and UTC/account semantics          | No exact evidence for a safe usage surface, reader, accounting revision, or E2E                                      |
| `aider`       | Recognized | Exact documented local usage surface and UTC/account semantics          | No exact evidence for a safe usage surface, reader, accounting revision, or E2E                                      |

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

No provider is currently supported by the final clean AgentAccount path. The connector must not emit
a final `UsageSyncV1` request from any row above until its state changes through reviewed code and
evidence. Recognized providers may appear only as unavailable product information with the precise
gap; they cannot be selected as working accounts.

## Update policy

Semantic accounting change creates a new immutable accounting revision. Schema drift fails closed. A
disabled or recognized row never silently falls back to another provider, guesses fields, uses
model/price conversion, parses prompt/code text, or reuses historical Codex compatibility evidence.
