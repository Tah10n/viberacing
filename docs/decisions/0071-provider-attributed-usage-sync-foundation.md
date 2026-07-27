# ADR 0071: Provider-attributed UsageSyncV1 foundation

- Status: Superseded
- Date: 2026-07-26
- Decision owners: Contracts, Edge, Ingest, Database, Security, Privacy, and Compatibility
- Supersedes: None
- Superseded by: ADR 0075

## Context

ADRs 0068 and 0069 select a provider-neutral token leaderboard and thin-client direction, but they
are planning records and intentionally leave subsystem contracts to focused ADRs. The implemented
Community write path is still Codex-specific: `ConnectorSyncV1` names Codex fields, the source table
has no provider attribution, and the Ingest lookup returns only device, source, and public-key
material.

Changing the existing route in place would either break the checked Codex connector or require one
ambiguous union contract that the current schema subset and OpenAPI generator cannot express
faithfully. Declaring providers without bounded readers would also create a support claim the
repository cannot prove.

The shortest safe vertical slice is therefore an additive provider-neutral request accepted for the
one provider whose reader and compatibility evidence already exist. It must preserve the existing
Codex route and remain independently disabled until deployment enables it.

## Decision

Add `UsageSyncV1` as a closed request contract on exact `POST /v1/community/usage`. Its writable
fields are:

- `schemaVersion`, fixed to `1`;
- one opaque `sourceId`, one `syncId`, and one canonical millisecond `observedAt`;
- bounded semver `clientVersion` and `agentVersion` strings; and
- one through 31 unique `dailyEntries`, each containing only `reportedDate` and the JavaScript-safe
  integer `dailyTokenTotal`.

The request has no provider, accounting revision, profile, rank, model, component-token, prompt,
session, repository, or trust field. Unknown fields fail closed, so a client-supplied provider is
rejected by construction.

The physical `codex_sources` table remains in place during this expand-only slice. Revision 0041
adds two non-null immutable columns:

- `provider = codex`; and
- `accounting_revision = codex_daily_usage_buckets_v1`.

Those exact defaults backfill every existing source and preserve the existing Codex pairing
procedure. They are the only admitted values in this slice because Codex is the only implemented
bounded reader. A later provider may be added only with its reviewed reader, source-creation
authority, accounting fixture matrix, and forward migration. Renaming the table now would change
many mature foreign-key and procedure surfaces without adding user-visible capability, so the
logical AgentSource generalization is represented by the immutable columns first.

The device-verification capability returns the source's provider and accounting revision together
with the existing exact binding. The application verifier:

1. verifies the body-bound origin proof before parsing;
2. validates the contract selected by the exact request target;
3. verifies the same source-bound Ed25519 request;
4. accepts only the reviewed provider/revision pair reached through that device; and
5. returns a frozen database allowlist containing the derived attribution.

A new Ingest-only `submit_usage_sync` procedure independently rechecks the supplied derived
provider/revision against the immutable source reached through the exact device binding, then maps
the provider-neutral field names into the unchanged, fully revalidating Community submission
procedure. In this Codex-only compatibility slice, `clientVersion` maps to the retained
`connector_version` snapshot column, `agentVersion` maps to `codex_version`, and
`reportedDate`/`dailyTokenTotal` map to the existing date/token storage. No public score or
historical season is rewritten.

The new route uses the existing device/origin header names and algorithms, but the exact new path is
included in both canonical messages. A separate checked authentication policy prevents path
confusion. The Cloudflare Worker and Ingest HTTP server admit the route only when
`VIBERACING_USAGE_SYNC_ENABLED` is the exact string `true`; every other, missing, inherited,
non-string, or unreadable value leaves it unavailable. The Ingest server resolves the decision
before registering the route, so disabled requests cannot reach body parsing, admission, device
lookup, or storage. The Worker checks it before reading the request body or protected origin
configuration.

`POST /v1/community/sync` and `ConnectorSyncV1` remain unchanged and accepted. Both routes share the
same four-request no-queue admission ceiling and database pool rather than multiplying capacity.

## Security and privacy consequences

Provider and accounting revision are Account/Operational attribution selected by server-owned source
state, never client claims. They remain private and are deleted with the source/profile. The new
request adds no provider-shaped components or sensitive local content; only the already allowed
opaque identifiers, versions, date, and daily total cross the boundary.

The device signature proves only which registered device submitted self-reported totals. It does not
prove honest local execution, provider account ownership, normalized compute, or Verified-tier
usage. Community labeling and the existing replay, lifecycle, deadline, quarantine, role, and
retention controls remain unchanged.

The source default intentionally creates only Codex-attributed sources through the legacy pairing
flow. It must not be widened as a shortcut for another provider. Provider/revision mutations fail
even for the owner so a compromised or buggy application cannot relabel accumulated history.

## Alternatives considered

- **Replace `ConnectorSyncV1` on the existing URL:** rejected because it would break the checked
  connector or make OpenAPI hide the compatibility contract.
- **Accept both bodies through one permissive schema:** rejected because optional field mixtures
  would admit states that neither contract owns.
- **Declare every provider from ADR 0068 now:** rejected because no corresponding bounded reader
  evidence exists yet.
- **Rename `codex_sources` immediately:** rejected because an additive attribution column supplies
  the required invariant with a much smaller migration and rollback surface.
- **Trust a provider or accounting revision in the request:** rejected because a device could
  relabel one source without profile authority.
- **Create a new generic storage pipeline:** rejected because the existing monotonic, replay-safe,
  season-aware procedure already implements the required daily-total semantics for the only enabled
  provider.

## Migration and rollback

Revision 0041 is forward-only. It backfills the two exact values, extends the existing source-update
trigger, replaces the device lookup with the additive result, and adds one narrow wrapper procedure
and grant. It adds no table, public field, score mutation, or cleanup job.

Rollback first leaves `VIBERACING_USAGE_SYNC_ENABLED` absent or not equal to `true` at both Edge and
Ingest. Existing `ConnectorSyncV1` traffic continues. After a shared migration, repair through a
reviewed forward migration; do not remove the columns, edit the recorded SQL, or reinterpret stored
source attribution.

## Verification

Completion evidence for this slice includes:

- schema/generated-type/OpenAPI drift checks and rejection of provider, unknown fields, duplicate
  dates, unsafe integers, and malformed versions;
- exact-path origin/device message tests and disabled-before-body/config route tests at Edge and
  Ingest;
- verifier tests for derived attribution, wrong source, malformed lookup rows, and unsupported
  provider/revision;
- adapter tests proving the provider-neutral-to-database allowlist and the distinct fixed query;
- PostgreSQL tests proving existing-source backfill, immutable attribution, exact lookup output,
  successful wrapper submission, wrong-attribution rejection, and the Ingest-only grant matrix;
- the existing `ConnectorSyncV1` unit and disposable PostgreSQL integrations unchanged; and
- focused, root, and release repository gates.

These are local synthetic results. They prove no additional provider reader, new-provider source
creation, thin client, real account, Cloudflare/Railway route, protected deployment values,
production login/TLS, monitoring, representative capacity, or deployment.

## References

- [Multi-agent token accounting direction](0068-multi-agent-token-leaderboard-and-mcp.md)
- [Thin client and onboarding direction](0069-thin-client-and-low-friction-onboarding.md)
- [Bounded Community sync verifier](0015-bounded-community-sync-verification-kernel.md)
- [Cloudflare origin signer](0070-dependency-free-cloudflare-ingest-origin-signer.md)
- [Contract boundary](../../contracts/README.md)
- [Database capability boundary](../../database/README.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
