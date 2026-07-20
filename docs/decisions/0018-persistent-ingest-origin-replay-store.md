# ADR 0018: Persistent Ingest origin replay store

- Status: Accepted (database through synthetic HTTP/PostgreSQL integration; deployment pending)
- Date: 2026-07-15
- Decision owners: Ingest, Database, Jobs, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

ADR 0015 verifies a short-lived, body-bound edge HMAC before parsing a Community sync request, but
its one-time nonce consumer was only an injected seam. ADR 0017 supplies the protected verification
keys, not durable replay state. An in-memory set would reopen accepted nonces after a process
restart or across replicas, while inserting a row only after later device work would permit
concurrent duplicates to pass the origin boundary.

The replay store is distinct from the 15-minute source-bound device nonce in revision 0007. An
origin nonce proves that the configured edge handled one exact request; a device nonce proves that a
registered source-bound key signed one request. Neither check substitutes for the other, and neither
makes Community usage verified by OpenAI.

## Decision

Add revision 0012 with one private forced-RLS table, `origin_nonces`. Its complete stored tuple is:

- the closed `edge_` origin key ID;
- the verifier's 32-byte SHA-256 digest over the versioned domain, key ID, and raw nonce; and
- the exact millisecond replay expiry.

The raw nonce, HMAC proof, HMAC key, body, request headers, device, source, profile, IP address, and
free-form metadata are not stored. The primary key is `(origin_key_id, nonce_digest)` so a digest is
independent across a reviewed rotation key ID. An expiry-first index supports deterministic bounded
cleanup. Runtime roles receive no direct table privilege.

The three-parameter Ingest-only `consume_origin_nonce` function accepts only the closed key grammar,
exactly 32 digest bytes, and a millisecond expiry that is still in the future and no more than 65
seconds beyond the database clock. It atomically inserts a new tuple or replaces the exact tuple
only when its stored expiry is already past. An unexpired conflict returns `false`; malformed input
and database failure remain generic failures. Five-second database lock and statement deadlines
bound contention.

After a successful insert or expired-row replacement, the function checks the database clock again.
If the supplied expiry elapsed while the call waited for a conflicting lock, it deletes the exact
row written by that call and returns `false`. A delayed request therefore cannot become newly valid
after its proof lifetime ends. Concurrent contenders for one expired tuple serialize to exactly one
`true` and one `false` result.

Revision 0012 recreates the existing Jobs-only `cleanup_expired_ingest_state(integer)` function with
one additional `deleted_origin_nonces` result column. Existing named reads of
`deleted_nonces`/`deleted_snapshots` remain valid. Under the same private maintenance mutex, each
call independently deletes at most the requested 1-to-1000 batch from origin nonces, device nonces,
and raw snapshots. It uses a five-second lock deadline and a 30-second statement deadline. Expiry
makes a replay tuple unusable; physical deletion still requires the Jobs procedure to be scheduled.

The local Ingest database adapter adds exactly one fixed three-parameter call. It reconstructs only
an exact plain input with a safe millisecond timestamp, closed key ID, and lowercase 32-byte digest;
copies the digest; converts the expiry to canonical UTC; accepts only one exact boolean row; probes
the existing least-privileged runtime boundary first; and destroys the client on any invalid result
or dependency failure. ADR 0019 now supplies both origin-nonce consumption and minimal device lookup
from this same adapter object to one verifier composition. It still exposes no general query.

This decision does not add an HTTP listener, Cloudflare signer, secret-manager binding, trusted
forwarding policy, direct-origin denial, public response, request log, scheduler, live credential,
live TLS/database connection, connector, or deployment.

## Security and privacy consequences

Persistent atomic consumption closes the local storage portion of TB-06 and materially reduces
VR-ABUSE-ORIGIN-BYPASS across restarts and multiple Ingest processes. Keeping origin and device
nonces separate preserves defense in depth and key/source binding. Forced RLS, procedure-only
grants, per-checkout role probes, fixed SQL, and server clocks limit a compromised Ingest login to
one short-lived replay capability plus its already reviewed device lookup and submission calls.

The new row is Security data. It contains no user identifier or raw proof material, is unusable at
expiry, and is eligible for bounded deletion immediately then. Without a production Jobs schedule,
an expired row can remain physically present; real-user ingestion stays blocked until purge timing,
monitoring, backup handling, and restore behavior are demonstrated. Cleanup counts are transient
process values and are not logged or retained by the local runner.

Affected invariants are VR-ORIGIN-001, VR-INGEST-002, VR-DATA-001, and VR-ABUSE-001. Primary
attacker stories are VR-ABUSE-ORIGIN-BYPASS, VR-ABUSE-DATABASE-ROLE, and
VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Keep an in-memory set:** rejected because restarts and multiple replicas would create separate
  acceptance windows and unbounded process-local behavior.
- **Reuse `device_nonces`:** rejected because origin and device proofs have different principals,
  keys, lifetimes, failure order, and least-privilege consumers.
- **Store the raw origin nonce or proof:** rejected because the versioned domain-separated digest is
  sufficient for equality and minimizes retained security material.
- **Delete an expired row and insert in two statements:** rejected because concurrent callers could
  both observe absence or expose a gap. One conflict-aware statement preserves atomicity.
- **Treat every conflict as permanent:** rejected because a bounded tuple must be reusable after its
  expiry without allowing the table to grow per retry forever.
- **Perform lazy unbounded cleanup in the consume call:** rejected because request latency and lock
  scope would become attacker-controlled. Consumption touches only one tuple; Jobs owns bounded
  expiry cleanup.
- **Add the HTTP wrapper in the same slice:** rejected because raw socket framing, proxy trust,
  admission, public errors, and live composition require separate evidence.

## Migration and rollback

Revision 0012 is checksum-ledgered, forward-only, transactional, and serialized by the migration
advisory lock. It creates one table/function and replaces the cleanup function atomically. A failed
migration leaves the prior schema and grants intact.

Before a shared environment exists, rollback means discarding the disposable database and rebuilding
through revision 0011. After deployment, do not edit or reverse the recorded migration. First deny
the Ingest route and drain the maximum proof window, then use a reviewed forward migration if the
capability must be removed or changed. Never fall back to process-local replay acceptance.

## Verification

Acceptance evidence recorded for this decision included:

- first consume, exact replay, key-ID separation, expired-tuple reuse, malformed key/digest/time,
  millisecond precision, and bounded-lifetime PostgreSQL scenarios;
- an observed ordered lock-wait race in which two Ingest contenders target one locked expired tuple
  and produce exactly one accepted consume and one non-exception replay rejection;
- a second observed lock-wait race that holds the tuple beyond the supplied proof expiry, returns
  `false`, and proves the post-wait row is removed;
- forced RLS, no direct runtime table access, exact Ingest/Jobs/Web/Admin function matrices, and
  five-second lock/statement configuration checks;
- bounded origin/device/snapshot cleanup, idempotency, live-row preservation, and an observed
  two-worker cleanup race;
- 23 immutable migration checks and the real isolated PostgreSQL suite with 25 observed lock-wait
  races, 12 relation denials, and 34 cross-capability checks; and
- strict Ingest pool/input/result/failure tests and Jobs three-count mapping tests, bringing the
  current suites to 426 and 120 tests respectively at 100% statement, branch, function, and line
  coverage; and
- one opt-in signed loopback scenario proving a fresh origin nonce reaches persistence while an
  exact repeated HTTP proof returns generic unauthorized without a second snapshot; the same
  scenario holds four independent fresh consumes behind one owner lock, rejects a fifth HTTP request
  without a fifth consume, and proves the first four persist after release.

Focused tests use synthetic tuples and mock application pools; the full-path scenario uses a
disposable synthetic Ingest login and real PostgreSQL. It does not prove deployment credentials or
TLS, Cloudflare signing, direct-origin denial, production scheduling, physical purge latency, backup
expiry, distributed control, representative load, deployment, real-user behavior, or capacity.

## References

- [Community sync verification kernel](0015-bounded-community-sync-verification-kernel.md)
- [Bounded Ingest PostgreSQL adapter](0016-bounded-ingest-postgresql-adapter.md)
- [Protected origin key configuration](0017-protected-ingest-origin-key-configuration.md)
- [Ingest workspace](../../apps/ingest/README.md)
- [Database foundation](../../database/README.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Data flow](../architecture/DATA_FLOW.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
