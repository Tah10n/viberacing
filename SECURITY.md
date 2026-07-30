# Security policy

Private vulnerability reporting status: enabled and verified.

GitHub API response returned private vulnerability reporting as enabled on 2026-07-28, and the
signed-out public advisories page exposed the exact **Report a vulnerability** action. GitHub did
not permit the repository owner to act as an outside reporter, so no synthetic advisory was created.
External-account submission and notification delivery remain unproven and must not be claimed as
publication evidence.

## Repository threat model

The canonical public [threat model](docs/security/THREAT_MODEL.md) defines assets, attacker
capabilities, trust boundaries, required mitigations, accepted limitations, and severity
calibration. The [abuse-case catalog](docs/security/ABUSE_CASES.md),
[privacy data map](docs/security/PRIVACY_DATA_MAP.md), and
[security invariants](docs/architecture/SECURITY_INVARIANTS.md) are normative companion documents.

The current repository has local pre-release runtime components but no deployed runtime product.
Controls in those documents are release and launch gates, not claims that a deployed service exists.

## Supported versions

Vibe Racing has no public runtime or connector release yet. There are currently no supported
production versions.

After the first release, this section will list supported connector and API versions explicitly.
Unsupported versions will not receive routine fixes.

## Report a vulnerability privately

Do not disclose vulnerability details in a public issue, pull request, discussion, commit message,
or social post.

Use the repository's **Report a vulnerability** action to submit a confidential report. If that
action is unavailable, do not substitute a public issue, pull request, conduct report, or personal
contact. The hosted state no longer matches this policy; maintainers must restore and reverify
private vulnerability reporting before inviting reports.

Do not send credentials, private keys, real user records, production database exports, or unrelated
personal data with a report. Use minimal synthetic evidence whenever possible.

## Useful report content

- affected component and version or commit;
- impact and realistic attacker prerequisites;
- minimal reproduction using synthetic data;
- whether exploitation is active or public;
- suggested mitigation, if known;
- a safe contact method for coordinated follow-up.

## Response process

Maintainers will aim to:

- acknowledge a complete report within three business days;
- provide an initial severity and scope assessment within seven business days;
- coordinate remediation and disclosure without exposing users prematurely;
- credit the reporter when requested and appropriate.

These are response targets, not contractual guarantees. Complex or upstream issues may require
additional time.

The checked
[capability containment and recovery rehearsal runbook](docs/operations/CAPABILITY_CONTAINMENT_RUNBOOK.md)
binds the repository's local exact-default-off decisions to protected triage and process-replacement
prerequisites. It does not enable private vulnerability reporting, operate a deployed switch, or
prove monitoring, containment, notification, disclosure, or recovery.

The checked
[profile deletion failure rehearsal runbook](docs/operations/PROFILE_DELETION_FAILURE_RUNBOOK.md)
binds the current atomic request and bounded Jobs purge to protected classification, preserved
authority lock-down, aggregate diagnosis, and one reviewed retry. It is not a private support
channel, deployed alert or retry controller, user notification path, cache/backup deletion,
stale-backup replay, or proof that a real profile was deleted.

## Scope priorities

Reports are especially valuable when they affect:

- connector supply chain, signatures, local key storage, or command execution;
- GitHub OAuth, passkeys, sessions, recovery, pairing, or device authorization;
- cross-profile, cross-AgentAccount, installation, or device authorization;
- origin bypass, request signatures, replay, atomic ingest, exact accounting, snapshots, or
  finalization;
- database privilege separation, deletion, backups, admin, or audit integrity;
- GitHub Actions, release credentials, deployment, or artifact provenance;
- disclosure of prompts, repositories, credentials, account data, or private usage information.

Community token fabrication by a computer owner for an AgentAccount they control is a documented
residual risk, not by itself a vulnerability. Cross-account mutation, double-counting one accounting
domain, prohibited-data exfiltration, or a bypass that turns Community into Verified, privilege,
reward, or access is a vulnerability.

## Research expectations

Good-faith research should avoid:

- accessing, modifying, or retaining another person's data;
- persistence, destructive actions, denial of service, social engineering, or credential theft;
- testing against production when an equivalent local or staging reproduction is possible;
- broad automated scanning that creates operational impact.

Stop when enough evidence exists to demonstrate the issue and report it privately.
