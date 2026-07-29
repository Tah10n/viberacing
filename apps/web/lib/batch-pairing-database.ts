import "server-only";

import { Buffer } from "node:buffer";

import { Pool } from "pg";

import { resolvePairingDatabaseConfig } from "./pairing-database-config";

const runtimeBoundaryQuery = `SELECT
  CURRENT_USER = 'viberacing_web' AS role_ok,
  (
    SESSION_USER <> CURRENT_USER
    AND pg_catalog.pg_has_role(SESSION_USER, 'viberacing_web', 'SET')
    AND NOT pg_catalog.has_database_privilege(
      SESSION_USER,
      pg_catalog.current_database(),
      'CREATE'
    )
    AND NOT pg_catalog.has_database_privilege(
      SESSION_USER,
      pg_catalog.current_database(),
      'TEMPORARY'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS granted_role
      WHERE granted_role.rolname <> SESSION_USER
        AND granted_role.rolname <> 'viberacing_web'
        AND pg_catalog.pg_has_role(SESSION_USER, granted_role.oid, 'MEMBER')
    )
  ) AS login_scope_ok,
  pg_catalog.current_setting('search_path') = 'pg_catalog,pg_temp' AS search_path_ok,
  pg_catalog.current_setting('default_transaction_read_only') = 'off' AS read_write_ok`;

const admitQuery = `SELECT viberacing_api.admit_pairing_transport_request(
  $1::text,
  $2::bytea,
  $3::integer,
  $4::integer,
  $5::integer
) AS admitted`;

const startQuery = `SELECT viberacing_api.start_pairing_batch(
  $1::text,
  $2::text,
  $3::bytea,
  $4::text,
  $5::text,
  $6::text,
  $7::text,
  $8::bytea,
  $9::bytea,
  $10::bytea,
  $11::bytea,
  $12::bytea,
  $13::timestamptz,
  $14::jsonb
) AS pairing_id`;

const readApprovalQuery = `SELECT
  approval.pairing_id,
  approval.installation_label,
  approval.connector_version,
  approval.os_family,
  approval.architecture,
  approval.installation_public_key,
  approval.manifest_digest,
  pg_catalog.to_char(
    approval.expires_at AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS expires_at,
  approval.candidate_id,
  approval.provider_code,
  approval.reader_version,
  approval.accounting_revision,
  approval.fingerprint_kind,
  approval.fingerprint_digest,
  approval.safe_local_display_label,
  approval.preview_current_week_token_total,
  approval.preview_last_usage_date::text,
  approval.preview_status
FROM viberacing_api.read_pairing_batch_for_approval(
  $1::uuid,
  $2::bytea,
  $3::text
) AS approval`;

const readPairingByCodeQuery = `SELECT viberacing_api.read_pairing_batch_by_code(
  $1::uuid,
  $2::bytea,
  $3::bytea,
  $4::bytea
) AS pairing_id`;

const readAccountsQuery = `SELECT
  account.agent_account_id,
  account.provider_code,
  account.accounting_revision,
  account.scope_kind,
  account.fingerprint_kind,
  account.fingerprint_digest,
  account.private_label,
  account.account_state
FROM viberacing_api.read_agent_accounts_for_pairing($1::uuid, $2::bytea) AS account`;

const createChallengeQuery = `SELECT viberacing_api.create_auth_challenge(
  $1::uuid,
  $2::bytea,
  $3::uuid,
  'pairing_batch_approval'::text,
  $4::bytea,
  $5::bytea,
  $6::timestamptz
) AS challenge_id`;

const readPasskeyQuery = `SELECT
  material.passkey_id::text AS passkey_id,
  material.cose_public_key,
  material.sign_count::text AS sign_count,
  material.backup_eligible,
  material.backup_state
FROM viberacing_api.read_passkey_verification_material($1::bytea) AS material`;

const approveQuery = `SELECT viberacing_api.approve_pairing_batch(
  $1::uuid,
  $2::bytea,
  $3::text,
  $4::bytea,
  $5::bytea,
  $6::uuid,
  $7::uuid,
  $8::bigint,
  $9::boolean,
  $10::jsonb
) AS approved_count`;

const possessionQuery = `SELECT
  candidate.verifier_index,
  material.installation_public_key,
  material.possession_challenge,
  material.manifest_digest,
  material.pairing_state
FROM (
  VALUES (1, $2::bytea), (2, $3::bytea)
) AS candidate(verifier_index, poll_verifier_digest)
CROSS JOIN LATERAL viberacing_api.read_pairing_possession_material(
  $1::text,
  candidate.poll_verifier_digest
) AS material
ORDER BY candidate.verifier_index
LIMIT 1`;

const activateQuery = `SELECT viberacing_api.activate_pairing_batch(
  $1::text,
  $2::bytea
) AS activated_count`;

const pollQuery = `SELECT
  status.pairing_state,
  status.candidate_id,
  status.activation_state,
  status.agent_account_id,
  status.device_id,
  status.device_key_id
FROM viberacing_api.poll_pairing_batch($1::text, $2::bytea) AS status`;

interface QueryClient {
  query(query: { readonly text: string; readonly values: readonly unknown[] }): Promise<{
    readonly rows: unknown;
  }>;
  release(destroy?: boolean): void;
}

interface QueryPool {
  connect(): Promise<QueryClient>;
  end(): Promise<void>;
  on(event: "error", listener: (error: Error) => void): this;
}

export interface PairingSessionAuthority {
  readonly sessionId: string;
  readonly sessionVerifierDigest: Uint8Array;
}

export interface PairingStartPersistence {
  readonly architecture: string;
  readonly candidates: readonly Readonly<Record<string, unknown>>[];
  readonly connectorVersion: string;
  readonly expiresAt: string;
  readonly installationId: string;
  readonly installationLabel: string;
  readonly installationPublicKey: Uint8Array;
  readonly manifestDigest: Uint8Array;
  readonly osFamily: string;
  readonly pairingChallenge: Uint8Array;
  readonly pairingId: string;
  readonly pollVerifierDigest: Uint8Array;
  readonly startProofDigest: Uint8Array;
  readonly userCodeVerifierDigest: Uint8Array;
}

export interface PairingRateAdmission {
  readonly bucketLimit: number;
  readonly clientIdentityDigest: Uint8Array;
  readonly globalLimit: number;
  readonly operation: "poll" | "start";
  readonly windowSeconds: number;
}

export interface PairingApprovalPersistence extends PairingSessionAuthority {
  readonly backupState: boolean;
  readonly challengeId: string;
  readonly contextDigest: Uint8Array;
  readonly decisions: readonly Readonly<Record<string, unknown>>[];
  readonly manifestDigest: Uint8Array;
  readonly observedSignCount: number;
  readonly pairingId: string;
  readonly verifiedPasskeyId: string;
}

export interface BatchPairingDatabase {
  activate(pairingId: string, pollVerifierDigest: Uint8Array): Promise<unknown>;
  admit(input: PairingRateAdmission): Promise<unknown>;
  approve(input: PairingApprovalPersistence): Promise<unknown>;
  close(): Promise<void>;
  createApprovalChallenge(
    authority: PairingSessionAuthority,
    input: Readonly<{
      challengeDigest: Uint8Array;
      challengeId: string;
      contextDigest: Uint8Array;
      expiresAt: string;
    }>,
  ): Promise<unknown>;
  poll(pairingId: string, pollVerifierDigest: Uint8Array): Promise<unknown>;
  readAccounts(authority: PairingSessionAuthority): Promise<unknown>;
  readApproval(authority: PairingSessionAuthority, pairingId: string): Promise<unknown>;
  readPairingIdByCode(
    authority: PairingSessionAuthority,
    primaryDigest: Uint8Array,
    previousDigest: Uint8Array,
  ): Promise<unknown>;
  readPasskey(credentialId: Uint8Array): Promise<unknown>;
  readPossession(
    pairingId: string,
    pollVerifierDigests: readonly [Uint8Array, Uint8Array],
  ): Promise<unknown>;
  start(input: PairingStartPersistence): Promise<unknown>;
}

function exactRuntimeBoundary(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 1) {
    return false;
  }
  const row: unknown = value[0];
  return (
    row !== null &&
    typeof row === "object" &&
    !Array.isArray(row) &&
    Object.getPrototypeOf(row) === Object.prototype &&
    Reflect.ownKeys(row).length === 4 &&
    (row as Record<string, unknown>).role_ok === true &&
    (row as Record<string, unknown>).login_scope_ok === true &&
    (row as Record<string, unknown>).search_path_ok === true &&
    (row as Record<string, unknown>).read_write_ok === true
  );
}

function copyBytes(value: Uint8Array): Buffer {
  return Buffer.from(value);
}

export function createBatchPairingDatabase(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  poolFactory: (config: ReturnType<typeof resolvePairingDatabaseConfig>) => QueryPool = (config) =>
    new Pool(config),
): BatchPairingDatabase {
  const pool = poolFactory(resolvePairingDatabaseConfig(environment));
  let idleFailure = false;
  pool.on("error", () => {
    idleFailure = true;
  });

  async function execute(text: string, values: readonly unknown[]): Promise<unknown> {
    if (idleFailure) {
      throw new Error("pairing database unavailable");
    }
    const client = await pool.connect();
    let destroy = false;
    try {
      const boundary = await client.query({ text: runtimeBoundaryQuery, values: [] });
      if (!exactRuntimeBoundary(boundary.rows)) {
        throw new Error("pairing database unavailable");
      }
      return (await client.query({ text, values })).rows;
    } catch {
      destroy = true;
      throw new Error("pairing database unavailable");
    } finally {
      client.release(destroy);
    }
  }

  return Object.freeze({
    activate(pairingId: string, pollVerifierDigest: Uint8Array): Promise<unknown> {
      const digest = copyBytes(pollVerifierDigest);
      return execute(activateQuery, [pairingId, digest]).finally(() => {
        digest.fill(0);
      });
    },
    admit(input: PairingRateAdmission): Promise<unknown> {
      const digest = copyBytes(input.clientIdentityDigest);
      return execute(admitQuery, [
        input.operation,
        digest,
        input.globalLimit,
        input.bucketLimit,
        input.windowSeconds,
      ]).finally(() => {
        digest.fill(0);
      });
    },
    approve(input: PairingApprovalPersistence): Promise<unknown> {
      const session = copyBytes(input.sessionVerifierDigest);
      const manifest = copyBytes(input.manifestDigest);
      const context = copyBytes(input.contextDigest);
      return execute(approveQuery, [
        input.sessionId,
        session,
        input.pairingId,
        manifest,
        context,
        input.challengeId,
        input.verifiedPasskeyId,
        input.observedSignCount,
        input.backupState,
        JSON.stringify(input.decisions),
      ]).finally(() => {
        session.fill(0);
        manifest.fill(0);
        context.fill(0);
      });
    },
    async close(): Promise<void> {
      await pool.end();
    },
    createApprovalChallenge(
      authority: PairingSessionAuthority,
      input: Readonly<{
        challengeDigest: Uint8Array;
        challengeId: string;
        contextDigest: Uint8Array;
        expiresAt: string;
      }>,
    ): Promise<unknown> {
      const session = copyBytes(authority.sessionVerifierDigest);
      const challenge = copyBytes(input.challengeDigest);
      const context = copyBytes(input.contextDigest);
      return execute(createChallengeQuery, [
        authority.sessionId,
        session,
        input.challengeId,
        challenge,
        context,
        input.expiresAt,
      ]).finally(() => {
        session.fill(0);
        challenge.fill(0);
        context.fill(0);
      });
    },
    poll(pairingId: string, pollVerifierDigest: Uint8Array): Promise<unknown> {
      const digest = copyBytes(pollVerifierDigest);
      return execute(pollQuery, [pairingId, digest]).finally(() => {
        digest.fill(0);
      });
    },
    readAccounts(authority: PairingSessionAuthority): Promise<unknown> {
      const session = copyBytes(authority.sessionVerifierDigest);
      return execute(readAccountsQuery, [authority.sessionId, session]).finally(() => {
        session.fill(0);
      });
    },
    readApproval(authority: PairingSessionAuthority, pairingId: string): Promise<unknown> {
      const session = copyBytes(authority.sessionVerifierDigest);
      return execute(readApprovalQuery, [authority.sessionId, session, pairingId]).finally(() => {
        session.fill(0);
      });
    },
    readPairingIdByCode(
      authority: PairingSessionAuthority,
      primaryDigest: Uint8Array,
      previousDigest: Uint8Array,
    ): Promise<unknown> {
      const session = copyBytes(authority.sessionVerifierDigest);
      const primary = copyBytes(primaryDigest);
      const previous = copyBytes(previousDigest);
      return execute(readPairingByCodeQuery, [
        authority.sessionId,
        session,
        primary,
        previous,
      ]).finally(() => {
        session.fill(0);
        primary.fill(0);
        previous.fill(0);
      });
    },
    readPasskey(credentialId: Uint8Array): Promise<unknown> {
      const credential = copyBytes(credentialId);
      return execute(readPasskeyQuery, [credential]).finally(() => {
        credential.fill(0);
      });
    },
    readPossession(
      pairingId: string,
      pollVerifierDigests: readonly [Uint8Array, Uint8Array],
    ): Promise<unknown> {
      const primary = copyBytes(pollVerifierDigests[0]);
      const previous = copyBytes(pollVerifierDigests[1]);
      return execute(possessionQuery, [pairingId, primary, previous]).finally(() => {
        primary.fill(0);
        previous.fill(0);
      });
    },
    start(input: PairingStartPersistence): Promise<unknown> {
      const installationKey = copyBytes(input.installationPublicKey);
      const manifest = copyBytes(input.manifestDigest);
      const proof = copyBytes(input.startProofDigest);
      const poll = copyBytes(input.pollVerifierDigest);
      const code = copyBytes(input.userCodeVerifierDigest);
      const challenge = copyBytes(input.pairingChallenge);
      return execute(startQuery, [
        input.pairingId,
        input.installationId,
        installationKey,
        input.installationLabel,
        input.connectorVersion,
        input.osFamily,
        input.architecture,
        manifest,
        proof,
        poll,
        code,
        challenge,
        input.expiresAt,
        JSON.stringify(input.candidates),
      ]).finally(() => {
        installationKey.fill(0);
        manifest.fill(0);
        proof.fill(0);
        poll.fill(0);
        code.fill(0);
        challenge.fill(0);
      });
    },
  });
}
