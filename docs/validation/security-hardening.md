# Security hardening validation — 2026-09-19

Base: `e5e5000db9fef6257e7a831a85e93f7d1aceb68a` (`origin/main` when the branch was created).
Candidate: the head of the accompanying Draft PR, reported explicitly in its description. No
production deployment, merge, release, package publication, WAF/DNS change, or paid service change
was performed.

## Evidence and scope

The original admission regression failed against real PostgreSQL; the patched regression passes.
Public metadata/render work was measured on the original production build before changing it. A
downstream SQL timeout was independently reproduced as HTTP 500 and retested as HTTP 503 with
`Retry-After` after the bounded response fix. The fix also preserves the 50,000-URL sitemap
contract. Percent-encoded route aliases were checked but did not resolve to equivalent expensive
pages; no additional pathname normalization was added on that hypothesis.

The architecture remains one web process, one PostgreSQL database, and the unchanged connector.
There is no inter-request data cache. The public response buffer adds bounded memory and delays
streaming until the response is complete; it is necessary for correct overload HTTP status after
Next.js starts rendering. See [operating limits and procedures](../SECURITY_OPERATIONS.md).

## Measurement setup

Dedicated loopback production builds on ports 3021 (base), 3022 and 3023 (candidate), sharing only a
synthetic PostgreSQL 17.10 container on port 55439. Node 24.20.0, pnpm 11.7.0, macOS Apple M3 Max,
48 GiB host RAM; Docker reports 16 CPUs and 20,939,317,248 bytes available. 2,000 generated users,
two agents, 1,048,000 daily aggregate rows (2026-01-01 through 2026-09-19), exact
total 519375528000. No production rows, credentials, provider requests, or production dump were
used.

Each HTTP case has one warm-up plus 20 sequential measured requests, identical periods and seed. The
shared database was warm; separate synthetic addresses keep the benchmark within client quotas.
`pg_stat_statements.track=all` includes nested trigger statements and transaction commands. Numbers
are one bounded local run, not a capacity guarantee or statistical confidence interval.

| Route / scenario                                | Before p50 / p95 ms | After p50 / p95 ms | SQL calls before / after (20 requests) | HTTP       |
| ----------------------------------------------- | ------------------: | -----------------: | -------------------------------------: | ---------- |
| `/`                                             |       16.30 / 18.86 |      19.41 / 22.81 |                               20 / 180 | 200: 20/20 |
| `/?period=year`                                 |     104.99 / 108.48 |    108.55 / 112.02 |                               20 / 180 | 200: 20/20 |
| `/?period=custom&from=2026-02-01&to=2026-09-19` |      97.96 / 100.92 |    102.99 / 105.83 |                               20 / 180 | 200: 20/20 |
| `/?page=2`                                      |       15.33 / 16.84 |      19.36 / 20.73 |                               40 / 200 | 200: 20/20 |
| `/?page=99999`                                  |       38.53 / 40.43 |        7.57 / 9.20 |                               40 / 180 | 404: 20/20 |
| `/u/synthetic-1`                                |       10.17 / 12.04 |      13.84 / 15.10 |                               40 / 200 | 200: 20/20 |
| `/u/synthetic-absent`                           |         5.93 / 6.60 |        7.85 / 8.78 |                               40 / 180 | 404: 20/20 |
| `/sitemap.xml`                                  |       13.00 / 14.01 |      15.86 / 16.63 |                               20 / 180 | 200: 20/20 |

Admission adds eight instrumented PostgreSQL calls per admitted HTTP request (including transaction
and trigger work). Page 2 now runs one ranking aggregate plus one cheap user-count query instead of
two ranking aggregates; impossible offsets run only the count. A missing profile runs one visibility
lookup instead of two. Ordinary successful reads have modest admission overhead; this is not a claim
that every path became faster.

EXPLAIN ANALYZE BUFFERS was collected from both versions of the exact SQL templates. The annual plan
retains parallel aggregation of daily rows and applies the hidden-user anti-join to the grouped
users before WindowAgg. An initial per-row visibility join was rejected after measurement showed
extra work. Example direct-statement execution times (ms; independent of HTTP samples):

| Statement   | Before |  After |
| ----------- | -----: | -----: |
| week        |   8.61 |   7.33 |
| year        | 124.23 | 105.68 |
| custom      |  95.99 |  97.36 |
| page2       |   8.33 |   8.45 |
| page99999   |  32.61 |   0.17 |
| synthetic-1 |   5.59 |   5.46 |

The direct custom-range plan uses an exclusive upper date of September 19; the HTTP custom range
includes September 19. Both versions use the same bounds within each comparison. Plans for existing
and missing profiles were also saved; the candidate's missing-profile preflight avoids executing the
heavy profile statement. The reproducible measurement script emits complete JSON plans locally.

## Bounded load and resource effects

| Item                           |            Base |              Candidate |
| ------------------------------ | --------------: | ---------------------: |
| 40 requests, concurrency 8     |     {'200': 40} | {'200': 20, '503': 20} |
| p50 / p95 ms (all responses)   | 138.85 / 209.28 |          3.55 / 131.94 |
| Observed completed responses/s |           40.81 |                  58.17 |
| RSS initial / peak sampled KiB | 120304 / 211072 |        118016 / 285360 |
| Limiter rows initial / final   |           5 / 5 |                 5 / 15 |
| Read after a 250 ms pause      |             200 |                    200 |

Half the candidate burst is deliberately rejected before expensive work. Its low all-response p50
and larger completed-response rate include those 503s and are **not successful-read throughput
improvements**. Sampled RSS increased in this run; it includes V8 allocation/GC and cannot isolate
buffer cost. Buffers are capped at 2 MiB per public response and 32 MiB per sitemap, four public
operations at once; concatenation can temporarily copy a buffer. These are explicit bounds, not a
claim that the chosen limits fit every deployment's memory budget.

Candidate aggregate logs reported PostgreSQL pool waitingCount 0 in the observed run. Baseline pool
waiting telemetry was absent, so no measured before/after wait reduction is claimed. The gate is
configured for ten active DB operations, at most 32 waiting operations and a 1-second waiting
deadline; focused tests verify bounded queue size and expiry; shared state spans Next module bundles
in one process. Storage tests allocate 200,000 buckets, reject the next new key, delete exactly the
bounded 70,000-row cleanup batch, and admit again. Local backoff tests cover overflow, expiry,
restart and fixed-window boundaries. Shared PostgreSQL remains authoritative across instances.

## Completed checks

- `corepack pnpm verify`: passed; web 433 passed, 5 opt-in cases skipped in the ordinary run;
  connector tests/build and all repository gates passed. The opt-in real PostgreSQL/handshake suite
  separately passed all 5 cases. Initial sandbox-only ECONNREFUSED assertions required rerunning
  with local TCP access; those permission failures were not classified as product regressions.
- `corepack pnpm audit --prod --audit-level moderate`: no known vulnerabilities.
- `corepack pnpm test:e2e`: 19 passed against the final production build, including desktop/mobile,
  keyboard/touch, accessibility, OAuth, pairing, Browser Sync and two-user privacy checks.
- `corepack pnpm local:test`: complete real API/PostgreSQL scenario passed, including current-year
  history, multi-machine dedup, exact integers, downward corrections, replay, ownership, disconnect,
  revocation, deletion and schema compatibility. Every successful fixture sync compares persisted
  review signals against final deduplicated daily user totals. A high-total fixture flags without
  clipping, replay does not append/refresh a signal, and downward correction clears it.
- Two-instance bounded HTTP scenario: rejected client A cannot spend the shared admission budget;
  client B succeeds; spoofed forwarding headers are overwritten by the local proxy fixture; missing
  and malformed trusted addresses use bounded fallback keys and a NAT group shares one identity.
  HTML/RSC/prefetch all respect admission; invalid/absent pages retain their real statuses. Valid
  authorized sync and OAuth remain available during concurrent public reads.
- Moderation: idempotent hide/restore, gap-free ranks, unchanged totals, profile/metadata/sitemap
  behavior across two instances, private owner dashboard, no ordinary-session/device moderation
  endpoint, and hidden-owner account deletion all passed.
- Resource HTTP scenarios: 431 oversized header; 408 slow header/body; 503 downstream SQL lock
  timeout with Retry-After; isolated PostgreSQL stop gives 503 and restart recovers to 200.
- Fresh 001–017 installation, populated 015–016–017 upgrade and repeated migration passed. Published
  migrations/checksums 001–015 are unchanged. Docker image was built and started as uid 1000; ready
  returned 200 with schema 017. `git diff --check` passed.

The local edge fixture runs real HTTP proxies that strip client forwarding fields. Each listener
represents a fixed edge-observed identity/NAT group; all physical sockets remain on loopback. This
proves the application contract under that fixture, not Railway's actual production IP
configuration. The load script stops after 120 seconds or its fixed request budget; it permits only
explicit test origins. It is intentionally outside mandatory CI performance gates.

## Synthetic recovery drill

`pg_dump -Fc` and `pg_restore --exit-on-error` into a new isolated database took 0.59 s and 2.04 s.
Compared all migration ledger rows/checksums, 2,000 users, 1,048,000 daily rows, exact aggregate
total, foreign-key validity, orphan count (zero), limiter bucket count and its capacity counter.
Everything matched; rerunning migrations on the restored database was idempotent. The temporary dump
was removed. This is a local synthetic drill, not proof of production backup schedule or recovery
time.

## Production evidence and unapplied actions

Safe read-only observations on 2026-09-19:

| Item                                                                    | Status                             | Evidence / remaining work                                                                                                     |
| ----------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Existing public health, readiness and ordinary homepage                 | Confirmed                          | HTTP 200; readiness still reports schema 015                                                                                  |
| Existing response headers                                               | Confirmed                          | Private/no-store homepage, nonce CSP, HSTS, nosniff, DENY, no-referrer, permissions policy and cross-origin isolation headers |
| Latest GitHub production deployment record                              | Confirmed record                   | Successful record for base SHA `e5e5000db9fef6257e7a831a85e93f7d1aceb68a`; this does not attest every live Railway replica    |
| Candidate hardening deployed                                            | Requires application               | This Draft PR has not been merged or deployed                                                                                 |
| Complete domain inventory, live replica count, runtime SHA per instance | Not checked                        | Requires read-only Railway project/service settings and deployment access                                                     |
| Production IP trust variables and edge overwrite chain                  | Not checked                        | Requires Railway runtime configuration and a safe controlled edge check; secret values must not be printed                    |
| Database public TCP exposure/private network settings                   | Not checked                        | Requires Railway database networking settings                                                                                 |
| WAF/attack controls and alert delivery                                  | Not checked / requires application | Runbook and thresholds are prepared; no rule was enabled and no test notification received                                    |
| Backup schedule, retention, last success, available restore point       | Not checked                        | Requires Railway volume/database backup settings; local drill is separate evidence                                            |

Railway CLI/project settings were not available through the inspected tooling. A browser screenshot
attempt was rejected by automatic approval review because it would capture an unrelated Google
session; no bypass or production mutation followed. The remaining settings require scoped read-only
Railway access. Do not describe production as protected by this candidate.

## Reproduction

Use only a disposable local PostgreSQL container with the fixed loopback endpoint, migrations
001–017, and `pg_stat_statements` enabled with track=all. Build base and candidate separately, use
identical synthetic environment settings, and run the standard test commands above. The measurement
seed option creates aggregate-only synthetic users; the complete API fixture is tested separately by
local:test.

```sh
VIBERACING_TEST_ADMISSION_DATABASE=synthetic-local node scripts/measure-security-hardening.mjs http://127.0.0.1:3021 /tmp/before.json --seed
VIBERACING_TEST_ADMISSION_DATABASE=synthetic-local node scripts/measure-security-hardening.mjs http://127.0.0.1:3022 /tmp/after.json
# Requires DATABASE_URL pointing to the disposable database and VIBERACING_DATABASE_SSL=false:
VIBERACING_TEST_ADMISSION_DATABASE=synthetic-local node scripts/test-security-hardening.mjs http://127.0.0.1:3022 http://127.0.0.1:3023
```

The scripts are opt-in diagnostic fixtures, not production load tools. Their exact origin/database
checks deliberately reject other targets. Raw measurement JSON and full plans are generated locally;
only synthetic aggregate findings are included in this report.
