# ADR 0074: Release-driven protected service deployment

- Status: Accepted (checked local workflow; hosted configuration and execution pending)
- Date: 2026-07-26
- Decision owners: Release, Security, Operations, Web, Ingest, Jobs, and Edge
- Supersedes: None
- Superseded by: None

## Context

The repository has separate production-shaped images and Railway configuration for Web, Ingest, Jobs
scheduler, and the one-shot migration runner, plus one dependency-free Cloudflare Worker. The
remaining manual deployment sequence is easy to drift: a branch push can independently replace
services, migrations require a temporary startup latch, and Usage Sync must change on Ingest before
the Edge Worker.

GitHub Releases are the requested operator boundary. A release event is privileged and must not
reuse pull-request CI credentials or turn an arbitrary tag into production source. This decision is
only about deploying the service source already present in the repository. It does not publish,
sign, attest, package, or declare support for the candidate connector.

## Decision

Add one separate `Deploy stable release` workflow with these closed rules:

- only a published, non-prerelease `vMAJOR.MINOR.PATCH` tag triggers automatically;
- manual dispatch accepts the same exact tag format only from `main`, providing a reviewed redeploy
  entry point;
- the checked-out tag must resolve to the current checkout and be reachable from `origin/main`;
- the first job is secretless and reruns the release, Edge/Ingest compatibility, migration, Web
  PostgreSQL, and Ingest PostgreSQL gates;
- the second job waits for that result and attaches only the protected `production` GitHub
  Environment;
- deployments serialize without cancellation and use only the exact Railway project token and
  Cloudflare API token supplied by that environment;
- actions use full commit SHAs, Railway CLI uses one version-and-digest-pinned container, and
  Wrangler uses one exact version;
- Railway services deploy in the order Migration, Web, Ingest, and Jobs scheduler; the Cloudflare
  Worker deploys last;
- the migration latch is set only for the one-shot migration deployment and is reset in an `always`
  cleanup after the enable step was attempted;
- `VIBERACING_USAGE_SYNC_ENABLED` is validated as an exact boolean and applied to Ingest before the
  matching Worker replacement; and
- a final HTTPS Web smoke requires status `200`, CSP, HSTS, and `nosniff`.

The workflow contains no database, application, OAuth, WebAuthn, origin-HMAC, or other runtime
secret. Railway service variables and Cloudflare Worker secrets remain in their respective
platforms. GitHub receives only the two least-privileged deployment credentials and three non-secret
environment variables.

## Alternatives considered

- **Railway GitHub branch autodeploy:** rejected because it is push-driven, cannot express the
  cross-service migration/Edge order, and would bypass the stable-release boundary.
- **One deployment job without re-verification:** rejected because the privileged job would trust a
  tag without current repository evidence.
- **Deploy Edge and Ingest independently:** rejected because mixed enablement must fail closed and
  requires a defined replacement order.
- **Automatically roll back every service on failure:** rejected because forward-only database
  migrations and external side effects cannot be safely reversed by replaying a previous source
  revision.
- **Build or publish the connector in this workflow:** rejected because connector artifacts require
  separate build-once, signing, SBOM, provenance, clean-machine, and support evidence.

## Security and privacy consequences

Pull-request code remains secretless. Protected-environment approval occurs only after a complete
secretless verification job. The manual path cannot select an unreviewed workflow branch, and the
tag ancestry check rejects source outside protected `main`. Exact action, image, and tool pins are
covered by configuration and license-policy regression tests.

The workflow passes deployment credentials only to their exact steps and does not print protected
configuration. No participant data flows through GitHub Actions. Platform logs remain operational
data and still require platform-side retention and access controls.

## Migration and rollback

A migration failure closes the latch and stops later deployments. Operators must follow the
forward-recovery runbook; the workflow does not retry migrations automatically or apply reverse SQL.

Manual dispatch is intended to redeploy the same stable tag and repeats all verification plus
protected-environment approval. It is not an automatic old-version rollback: an older migration
catalog can reject a newer database ledger, and no workflow may skip that fail-closed result.
Rolling service source back therefore requires a separate reviewed mixed-version/forward-recovery
decision. If Edge deployment fails after Ingest replacement, the route remains closed when the
selected flag is `false`; when it is `true`, the previously deployed Edge state remains and must be
assessed before a manual redeploy.

## Verification

Required repository evidence includes:

- configuration checker acceptance of the exact workflow;
- negative mutations for event, tag condition, environment, verification dependency, secrets,
  action/tool pins, migration cleanup, service order, and coordinated Edge flag;
- strict non-secret environment-input tests;
- license inventory discovery across every workflow, including command-invoked container images and
  the selected Wrangler version; and
- the normal repository development gate before handoff.

This is a checked deployment declaration only. Until a maintainer configures the GitHub Environment,
Railway project, Cloudflare Worker, protected credentials, and records a successful hosted run, it
proves no deployment, migration, external TLS path, secret delivery, monitoring, or rollback.

## References

- [GitHub release deployment setup](../getting-started/GITHUB_RELEASE_DEPLOYMENT.md)
- [Pull-request CI trust model](../architecture/CI_TRUST_MODEL.md)
- [Railway data-plane staging](../getting-started/RAILWAY_DATA_PLANE_STAGING.md)
- [Staging migration and forward-recovery runbook](../operations/MIGRATION_RUNBOOK.md)
- [Release policy](../../RELEASE.md)
- [Dependency policy](../security/DEPENDENCY_POLICY.md)
