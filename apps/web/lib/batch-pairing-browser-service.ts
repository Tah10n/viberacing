import "server-only";

import { Buffer } from "node:buffer";
import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  validateConnectorPairingApprovalV1,
  type ConnectorPairingApprovalV1,
} from "@viberacing/contracts";

import type { BatchPairingDatabase, PairingSessionAuthority } from "./batch-pairing-database";
import type { EnrollmentCookieCodec } from "./enrollment-cookie";
import type { EnrollmentSession } from "./enrollment-domain";
import {
  createPasskeyLoginOptions,
  passkeyChallengeDigest,
  passkeyLoginCredentialId,
  verifyPasskeyLogin,
} from "./passkey-registration";
import type { PairingUserCodeVerifier } from "./pairing-user-code-verifier";

const pairingIdPattern = /^pair_[A-Za-z0-9_-]{22}$/;
const candidateIdPattern = /^cand_[A-Za-z0-9_-]{22}$/;
const accountIdPattern = /^acc_[A-Za-z0-9_-]{22}$/;
const controlPattern = /^ctl_[A-Za-z0-9_-]{23}$/;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const timestampPattern = /^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;
const unsafeLabelPattern = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const approvalCookieVersion = 1;
const approvalLifetimeMilliseconds = 5 * 60 * 1_000;

interface ApprovalCandidate {
  readonly accountingRevision: number;
  readonly candidateId: string;
  readonly fingerprintDigest?: Buffer;
  readonly fingerprintKind: "stable_opaque" | "unavailable";
  readonly preview: Readonly<{
    currentWeekTokenTotal: string;
    lastUsageDate: string | null;
    status:
      | "incomplete_period"
      | "reader_error"
      | "ready"
      | "unavailable"
      | "unsupported_scope"
      | "unsupported_version";
  }>;
  readonly provider: "codex";
  readonly readerVersion: string;
  readonly safeDisplayLabel: string;
  readonly scopeKind: "agent_account";
}

interface ApprovalBatch {
  readonly architecture: "aarch64" | "x86_64";
  readonly candidates: readonly ApprovalCandidate[];
  readonly connectorVersion: string;
  readonly expiresAt: string;
  readonly installationLabel: string;
  readonly installationPublicKey: Buffer;
  readonly manifestDigest: Buffer;
  readonly osFamily: "linux" | "macos" | "windows";
  readonly pairingId: string;
  clear(): void;
}

interface ExistingAccount {
  readonly accountId: string;
  readonly accountingRevision: number;
  readonly fingerprintDigest?: Buffer;
  readonly fingerprintKind: "stable_opaque" | "unavailable";
  readonly privateLabel: string;
  readonly provider: "codex";
  readonly scopeKind: "agent_account";
  readonly state: "active" | "paused";
}

export interface PairingBrowserReview {
  readonly approval: Readonly<{
    manifestDigest: string;
    pairingId: string;
    schemaVersion: 1;
  }>;
  readonly pairing: Readonly<{
    architecture: "aarch64" | "x86_64";
    candidates: readonly Readonly<{
      candidateId: string;
      fingerprintKind: "stable_opaque" | "unavailable";
      preview: ApprovalCandidate["preview"];
      provider: "codex";
      safeDisplayLabel: string;
      suggestedAgentAccountControl?: string;
    }>[];
    connectorVersion: string;
    existingAccounts: readonly Readonly<{
      accountControl: string;
      privateLabel: string;
      provider: "codex";
      state: "active" | "paused";
    }>[];
    expiresAt: string;
    installationLabel: string;
    osFamily: "linux" | "macos" | "windows";
    publicKeyFingerprint: string;
  }>;
}

export interface PairingApprovalOptions {
  readonly approvalCookie: string;
  readonly options: Awaited<ReturnType<typeof createPasskeyLoginOptions>>;
}

export interface BatchPairingBrowserService {
  beginApproval(
    sessionCookie: string,
    approvalInput: unknown,
  ): Promise<PairingApprovalOptions | undefined>;
  completeApproval(sessionCookie: string, approvalCookie: string, body: unknown): Promise<boolean>;
  review(sessionCookie: string, body: unknown): Promise<PairingBrowserReview | undefined>;
}

export interface BatchPairingBrowserDependencies {
  readonly controlKey: Uint8Array;
  readonly cookieCodec: EnrollmentCookieCodec;
  readonly database: BatchPairingDatabase;
  readonly now: () => number;
  readonly pairingCodeVerifier: PairingUserCodeVerifier;
  readonly readSession: (sessionCookie: string | undefined) => EnrollmentSession | undefined;
  readonly webauthnOrigin: string;
  readonly webauthnRpId: string;
}

interface ApprovalCookie {
  readonly approval: ConnectorPairingApprovalV1;
  readonly challenge: string;
  readonly challengeId: string;
  readonly expiresAt: number;
  readonly sessionId: string;
  readonly version: 1;
}

interface PasskeyMaterial {
  readonly backupEligible: boolean;
  readonly backupState: boolean;
  readonly cosePublicKey: Buffer;
  readonly passkeyId: string;
  readonly signCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function copyBytes(value: unknown, length: number, allowZero = false): Buffer | undefined {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) {
    return undefined;
  }
  const copy = Buffer.from(value);
  if (!allowZero && copy.every((byte) => byte === 0)) {
    copy.fill(0);
    return undefined;
  }
  return copy;
}

function exactTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    timestampPattern.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

function parseApprovalBatch(value: unknown): ApprovalBatch | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
    return undefined;
  }
  let installationKey: Buffer | undefined;
  let manifestDigest: Buffer | undefined;
  const candidates: ApprovalCandidate[] = [];
  const candidateIds = new Set<string>();
  let header:
    | Omit<ApprovalBatch, "candidates" | "clear" | "installationPublicKey" | "manifestDigest">
    | undefined;
  try {
    for (const input of value) {
      if (
        !isRecord(input) ||
        !exactKeys(input, [
          "pairing_id",
          "installation_label",
          "connector_version",
          "os_family",
          "architecture",
          "installation_public_key",
          "manifest_digest",
          "expires_at",
          "candidate_id",
          "provider_code",
          "reader_version",
          "accounting_revision",
          "fingerprint_kind",
          "fingerprint_digest",
          "safe_local_display_label",
          "preview_current_week_token_total",
          "preview_last_usage_date",
          "preview_status",
        ]) ||
        typeof input.pairing_id !== "string" ||
        !pairingIdPattern.test(input.pairing_id) ||
        typeof input.installation_label !== "string" ||
        !validPrivateLabel(input.installation_label) ||
        typeof input.connector_version !== "string" ||
        !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
          input.connector_version,
        ) ||
        (input.os_family !== "linux" &&
          input.os_family !== "macos" &&
          input.os_family !== "windows") ||
        (input.architecture !== "aarch64" && input.architecture !== "x86_64") ||
        !exactTimestamp(input.expires_at) ||
        typeof input.candidate_id !== "string" ||
        !candidateIdPattern.test(input.candidate_id) ||
        candidateIds.has(input.candidate_id) ||
        input.provider_code !== "codex" ||
        typeof input.reader_version !== "string" ||
        !/^[a-z][a-z0-9_]{2,63}$/.test(input.reader_version) ||
        typeof input.accounting_revision !== "number" ||
        !Number.isSafeInteger(input.accounting_revision) ||
        input.accounting_revision < 1
      ) {
        return undefined;
      }
      const rowKey = copyBytes(input.installation_public_key, 32);
      const rowManifest = copyBytes(input.manifest_digest, 32);
      let fingerprint: Buffer | undefined;
      if (
        rowKey === undefined ||
        rowManifest === undefined ||
        (input.fingerprint_kind !== "stable_opaque" && input.fingerprint_kind !== "unavailable") ||
        (input.fingerprint_kind === "unavailable" && input.fingerprint_digest !== null) ||
        (input.fingerprint_kind === "stable_opaque" &&
          (fingerprint = copyBytes(input.fingerprint_digest, 32)) === undefined) ||
        typeof input.safe_local_display_label !== "string" ||
        !validPrivateLabel(input.safe_local_display_label) ||
        typeof input.preview_current_week_token_total !== "string" ||
        !/^(?:0|[1-9][0-9]{0,59})$/.test(input.preview_current_week_token_total) ||
        (input.preview_last_usage_date !== null &&
          (typeof input.preview_last_usage_date !== "string" ||
            !/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(input.preview_last_usage_date))) ||
        (input.preview_status !== "ready" &&
          input.preview_status !== "incomplete_period" &&
          input.preview_status !== "reader_error" &&
          input.preview_status !== "unavailable" &&
          input.preview_status !== "unsupported_scope" &&
          input.preview_status !== "unsupported_version")
      ) {
        rowKey?.fill(0);
        rowManifest?.fill(0);
        fingerprint?.fill(0);
        return undefined;
      }
      if (header === undefined) {
        installationKey = rowKey;
        manifestDigest = rowManifest;
        header = {
          architecture: input.architecture,
          connectorVersion: input.connector_version,
          expiresAt: input.expires_at,
          installationLabel: input.installation_label,
          osFamily: input.os_family,
          pairingId: input.pairing_id,
        };
      } else {
        const consistent =
          header.pairingId === input.pairing_id &&
          header.installationLabel === input.installation_label &&
          header.connectorVersion === input.connector_version &&
          header.osFamily === input.os_family &&
          header.architecture === input.architecture &&
          header.expiresAt === input.expires_at &&
          installationKey !== undefined &&
          manifestDigest !== undefined &&
          timingSafeEqual(installationKey, rowKey) &&
          timingSafeEqual(manifestDigest, rowManifest);
        rowKey.fill(0);
        rowManifest.fill(0);
        if (!consistent) {
          fingerprint?.fill(0);
          return undefined;
        }
      }
      candidateIds.add(input.candidate_id);
      candidates.push({
        accountingRevision: input.accounting_revision,
        candidateId: input.candidate_id,
        ...(fingerprint === undefined ? {} : { fingerprintDigest: fingerprint }),
        fingerprintKind: input.fingerprint_kind,
        preview: Object.freeze({
          currentWeekTokenTotal: input.preview_current_week_token_total,
          lastUsageDate: input.preview_last_usage_date,
          status: input.preview_status,
        }),
        provider: "codex",
        readerVersion: input.reader_version,
        safeDisplayLabel: input.safe_local_display_label,
        scopeKind: "agent_account",
      });
    }
    if (header === undefined || installationKey === undefined || manifestDigest === undefined) {
      return undefined;
    }
    let cleared = false;
    return Object.freeze({
      ...header,
      candidates: Object.freeze(candidates),
      clear(): void {
        if (!cleared) {
          cleared = true;
          installationKey?.fill(0);
          manifestDigest?.fill(0);
          for (const candidate of candidates) {
            candidate.fingerprintDigest?.fill(0);
          }
        }
      },
      installationPublicKey: installationKey,
      manifestDigest,
    });
  } catch {
    installationKey?.fill(0);
    manifestDigest?.fill(0);
    for (const candidate of candidates) {
      candidate.fingerprintDigest?.fill(0);
    }
    return undefined;
  }
}

function parseAccounts(value: unknown): readonly ExistingAccount[] | undefined {
  if (!Array.isArray(value) || value.length > 128) {
    return undefined;
  }
  const result: ExistingAccount[] = [];
  const ids = new Set<string>();
  try {
    for (const input of value) {
      if (
        !isRecord(input) ||
        !exactKeys(input, [
          "agent_account_id",
          "provider_code",
          "accounting_revision",
          "scope_kind",
          "fingerprint_kind",
          "fingerprint_digest",
          "private_label",
          "account_state",
        ]) ||
        typeof input.agent_account_id !== "string" ||
        !accountIdPattern.test(input.agent_account_id) ||
        ids.has(input.agent_account_id) ||
        input.provider_code !== "codex" ||
        typeof input.accounting_revision !== "number" ||
        !Number.isSafeInteger(input.accounting_revision) ||
        input.accounting_revision < 1 ||
        input.scope_kind !== "agent_account" ||
        (input.fingerprint_kind !== "stable_opaque" && input.fingerprint_kind !== "unavailable") ||
        (input.account_state !== "active" && input.account_state !== "paused") ||
        typeof input.private_label !== "string" ||
        !validPrivateLabel(input.private_label)
      ) {
        return undefined;
      }
      const fingerprint =
        input.fingerprint_kind === "stable_opaque"
          ? copyBytes(input.fingerprint_digest, 32)
          : undefined;
      if (
        (input.fingerprint_kind === "stable_opaque" && fingerprint === undefined) ||
        (input.fingerprint_kind === "unavailable" && input.fingerprint_digest !== null)
      ) {
        fingerprint?.fill(0);
        return undefined;
      }
      ids.add(input.agent_account_id);
      result.push({
        accountId: input.agent_account_id,
        accountingRevision: input.accounting_revision,
        ...(fingerprint === undefined ? {} : { fingerprintDigest: fingerprint }),
        fingerprintKind: input.fingerprint_kind,
        privateLabel: input.private_label,
        provider: "codex",
        scopeKind: "agent_account",
        state: input.account_state,
      });
    }
    return Object.freeze(result);
  } catch {
    for (const account of result) {
      account.fingerprintDigest?.fill(0);
    }
    return undefined;
  }
}

function clearAccounts(accounts: readonly ExistingAccount[] | undefined): void {
  for (const account of accounts ?? []) {
    account.fingerprintDigest?.fill(0);
  }
}

function sessionAuthority(session: EnrollmentSession): PairingSessionAuthority | undefined {
  const secret = Buffer.from(session.sessionVerifier, "base64url");
  try {
    if (secret.length !== 32 || secret.toString("base64url") !== session.sessionVerifier) {
      return undefined;
    }
    const digest = createHash("sha256").update(secret).digest();
    return Object.freeze({
      sessionId: session.sessionId,
      sessionVerifierDigest: digest,
    });
  } finally {
    secret.fill(0);
  }
}

function clearAuthority(authority: PairingSessionAuthority | undefined): void {
  if (authority?.sessionVerifierDigest instanceof Uint8Array) {
    Buffer.from(
      authority.sessionVerifierDigest.buffer,
      authority.sessionVerifierDigest.byteOffset,
      authority.sessionVerifierDigest.byteLength,
    ).fill(0);
  }
}

function codeBody(value: unknown): string | undefined {
  return isRecord(value) &&
    exactKeys(value, ["userCode"]) &&
    typeof value.userCode === "string" &&
    /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/.test(value.userCode)
    ? value.userCode
    : undefined;
}

function pairingIdResult(value: unknown): string | undefined {
  return Array.isArray(value) &&
    value.length === 1 &&
    isRecord(value[0]) &&
    exactKeys(value[0], ["pairing_id"]) &&
    typeof value[0].pairing_id === "string" &&
    pairingIdPattern.test(value[0].pairing_id)
    ? value[0].pairing_id
    : undefined;
}

function controlFor(
  controlKey: Uint8Array,
  sessionId: string,
  pairingId: string,
  accountId: string,
): string {
  const digest = createHmac("sha256", controlKey)
    .update("viberacing-pairing-account-control-v1\n", "utf8")
    .update(sessionId, "ascii")
    .update("\n", "ascii")
    .update(pairingId, "ascii")
    .update("\n", "ascii")
    .update(accountId, "ascii")
    .digest();
  try {
    return `ctl_${digest.subarray(0, 17).toString("base64url")}`;
  } finally {
    digest.fill(0);
  }
}

function accountForControl(
  accounts: readonly ExistingAccount[],
  controlKey: Uint8Array,
  sessionId: string,
  pairingId: string,
  control: string,
): ExistingAccount | undefined {
  if (!controlPattern.test(control)) {
    return undefined;
  }
  return accounts.find(
    (account) => controlFor(controlKey, sessionId, pairingId, account.accountId) === control,
  );
}

function safeFingerprintMatch(candidate: ApprovalCandidate, account: ExistingAccount): boolean {
  return (
    candidate.accountingRevision === account.accountingRevision &&
    candidate.fingerprintKind === "stable_opaque" &&
    account.fingerprintKind === "stable_opaque" &&
    candidate.fingerprintDigest !== undefined &&
    account.fingerprintDigest !== undefined &&
    timingSafeEqual(candidate.fingerprintDigest, account.fingerprintDigest)
  );
}

function validPrivateLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    Array.from(value).length <= 64 &&
    value === value.trim() &&
    value === value.normalize("NFC") &&
    !unsafeLabelPattern.test(value)
  );
}

function readApprovalCookie(
  value: unknown,
  nowMilliseconds: number,
  sessionId: string,
): ApprovalCookie | undefined {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "approval",
      "challenge",
      "challengeId",
      "expiresAt",
      "sessionId",
      "version",
    ]) ||
    value.version !== approvalCookieVersion ||
    value.sessionId !== sessionId ||
    typeof value.challenge !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.challenge) ||
    typeof value.challengeId !== "string" ||
    !uuidV4Pattern.test(value.challengeId) ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= nowMilliseconds ||
    value.expiresAt > nowMilliseconds + approvalLifetimeMilliseconds
  ) {
    return undefined;
  }
  const approval = validateConnectorPairingApprovalV1(value.approval);
  return approval.ok
    ? {
        approval: approval.value,
        challenge: value.challenge,
        challengeId: value.challengeId,
        expiresAt: value.expiresAt,
        sessionId,
        version: 1,
      }
    : undefined;
}

function authenticationResponse(value: unknown): unknown {
  return isRecord(value) && exactKeys(value, ["response"]) ? value.response : undefined;
}

function passkeyMaterial(value: unknown): PasskeyMaterial | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !isRecord(value[0]) ||
    !exactKeys(value[0], [
      "passkey_id",
      "cose_public_key",
      "sign_count",
      "backup_eligible",
      "backup_state",
    ])
  ) {
    return undefined;
  }
  const row = value[0];
  const key =
    row.cose_public_key instanceof Uint8Array &&
    row.cose_public_key.byteLength >= 16 &&
    row.cose_public_key.byteLength <= 4096
      ? Buffer.from(row.cose_public_key)
      : undefined;
  const signCount =
    typeof row.sign_count === "string" && /^(?:0|[1-9][0-9]{0,18})$/.test(row.sign_count)
      ? Number(row.sign_count)
      : Number.NaN;
  if (
    typeof row.passkey_id !== "string" ||
    !uuidV4Pattern.test(row.passkey_id) ||
    key === undefined ||
    !Number.isSafeInteger(signCount) ||
    signCount < 0 ||
    typeof row.backup_eligible !== "boolean" ||
    typeof row.backup_state !== "boolean" ||
    (row.backup_state && !row.backup_eligible)
  ) {
    key?.fill(0);
    return undefined;
  }
  return {
    backupEligible: row.backup_eligible,
    backupState: row.backup_state,
    cosePublicKey: key,
    passkeyId: row.passkey_id,
    signCount,
  };
}

function clearPasskey(material: PasskeyMaterial | undefined): void {
  material?.cosePublicKey.fill(0);
}

export function pairingApprovalContextDigest(
  sessionId: string,
  approval: ConnectorPairingApprovalV1,
  installationPublicKey: Uint8Array,
  expiresAt: string,
  rpId: string,
  origin: string,
): Buffer {
  return createHash("sha256")
    .update(
      JSON.stringify({
        protocol: "viberacing-pairing-batch-approval-v1",
        sessionId,
        approval,
        installationPublicKey: Buffer.from(installationPublicKey).toString("base64url"),
        expiresAt,
        rpId,
        origin,
      }),
      "utf8",
    )
    .digest();
}

function publicIdentifier(prefix: "acc_" | "dev_" | "key_"): string {
  return `${prefix}${randomBytes(16).toString("base64url")}`;
}

function exactApprovalForBatch(
  approval: ConnectorPairingApprovalV1,
  batch: ApprovalBatch,
  accounts: readonly ExistingAccount[],
  controlKey: Uint8Array,
  sessionId: string,
): boolean {
  if (
    approval.pairingId !== batch.pairingId ||
    approval.manifestDigest !== batch.manifestDigest.toString("hex") ||
    approval.decisions.length !== batch.candidates.length
  ) {
    return false;
  }
  return approval.decisions.every((decision, index) => {
    const candidate = batch.candidates[index];
    if (decision.candidateId !== candidate?.candidateId) {
      return false;
    }
    if (decision.action === "skip") {
      return (
        decision.targetAgentAccountControl === undefined && decision.privateLabel === undefined
      );
    }
    if (decision.action === "create") {
      return (
        decision.targetAgentAccountControl === undefined &&
        (decision.privateLabel === undefined || validPrivateLabel(decision.privateLabel))
      );
    }
    if (decision.privateLabel !== undefined || decision.targetAgentAccountControl === undefined) {
      return false;
    }
    const target = accountForControl(
      accounts,
      controlKey,
      sessionId,
      batch.pairingId,
      decision.targetAgentAccountControl,
    );
    return (
      target?.accountingRevision === candidate.accountingRevision &&
      (candidate.fingerprintKind === "unavailable" || safeFingerprintMatch(candidate, target))
    );
  });
}

function internalDecisions(
  approval: ConnectorPairingApprovalV1,
  batch: ApprovalBatch,
  accounts: readonly ExistingAccount[],
  controlKey: Uint8Array,
  sessionId: string,
): readonly Readonly<Record<string, unknown>>[] | undefined {
  if (!exactApprovalForBatch(approval, batch, accounts, controlKey, sessionId)) {
    return undefined;
  }
  return approval.decisions.map((decision, index) => {
    const candidate = batch.candidates[index];
    if (candidate === undefined) {
      throw new Error("pairing decision unavailable");
    }
    if (decision.action === "skip") {
      return Object.freeze({
        candidateId: decision.candidateId,
        decision: "skip",
        deviceId: null,
        deviceKeyId: null,
        newAgentAccountId: null,
        privateLabel: null,
        targetAgentAccountId: null,
      });
    }
    const target =
      decision.action === "attach_existing"
        ? accountForControl(
            accounts,
            controlKey,
            sessionId,
            batch.pairingId,
            decision.targetAgentAccountControl ?? "",
          )
        : undefined;
    return Object.freeze({
      candidateId: decision.candidateId,
      decision: decision.action,
      deviceId: publicIdentifier("dev_"),
      deviceKeyId: publicIdentifier("key_"),
      newAgentAccountId: decision.action === "create" ? publicIdentifier("acc_") : null,
      privateLabel:
        decision.action === "create" ? (decision.privateLabel ?? candidate.safeDisplayLabel) : null,
      targetAgentAccountId: target?.accountId ?? null,
    });
  });
}

export function deriveBatchPairingControlKey(masterKey: Uint8Array): Buffer {
  if (masterKey.byteLength !== 32) {
    throw new Error("pairing browser service unavailable");
  }
  return Buffer.from(
    hkdfSync(
      "sha256",
      masterKey,
      Buffer.from("viberacing-pairing-browser-v1", "utf8"),
      Buffer.from("account-controls", "utf8"),
      32,
    ),
  );
}

export function createBatchPairingBrowserService(
  dependencies: BatchPairingBrowserDependencies,
): BatchPairingBrowserService {
  if (dependencies.controlKey.byteLength !== 32) {
    throw new Error("pairing browser service unavailable");
  }
  const controlKey = Buffer.from(dependencies.controlKey);

  async function loadBatch(
    authority: PairingSessionAuthority,
    pairingId: string,
  ): Promise<ApprovalBatch | undefined> {
    return parseApprovalBatch(await dependencies.database.readApproval(authority, pairingId));
  }

  async function loadAccounts(
    authority: PairingSessionAuthority,
  ): Promise<readonly ExistingAccount[] | undefined> {
    return parseAccounts(await dependencies.database.readAccounts(authority));
  }

  return Object.freeze({
    async beginApproval(
      sessionCookie: string,
      approvalInput: unknown,
    ): Promise<PairingApprovalOptions | undefined> {
      const session = dependencies.readSession(sessionCookie);
      const approvalValidation = validateConnectorPairingApprovalV1(approvalInput);
      const now = dependencies.now();
      if (!session?.passkeyRegistered || !approvalValidation.ok || !Number.isSafeInteger(now)) {
        return undefined;
      }
      const authority = sessionAuthority(session);
      let batch: ApprovalBatch | undefined;
      let accounts: readonly ExistingAccount[] | undefined;
      let challengeDigest: Buffer | undefined;
      let contextDigest: Buffer | undefined;
      try {
        if (authority === undefined) {
          return undefined;
        }
        [batch, accounts] = await Promise.all([
          loadBatch(authority, approvalValidation.value.pairingId),
          loadAccounts(authority),
        ]);
        if (
          batch === undefined ||
          accounts === undefined ||
          Date.parse(batch.expiresAt) <= now ||
          !exactApprovalForBatch(
            approvalValidation.value,
            batch,
            accounts,
            controlKey,
            session.sessionId,
          )
        ) {
          return undefined;
        }
        const options = await createPasskeyLoginOptions(dependencies.webauthnRpId);
        if (!/^[A-Za-z0-9_-]{43}$/.test(options.challenge)) {
          return undefined;
        }
        const challengeId = randomUUID();
        if (!uuidV4Pattern.test(challengeId)) {
          return undefined;
        }
        const expiresAt = Math.min(now + approvalLifetimeMilliseconds, Date.parse(batch.expiresAt));
        challengeDigest = passkeyChallengeDigest(options.challenge);
        contextDigest = pairingApprovalContextDigest(
          session.sessionId,
          approvalValidation.value,
          batch.installationPublicKey,
          batch.expiresAt,
          dependencies.webauthnRpId,
          dependencies.webauthnOrigin,
        );
        const cookie: ApprovalCookie = {
          approval: approvalValidation.value,
          challenge: options.challenge,
          challengeId,
          expiresAt,
          sessionId: session.sessionId,
          version: 1,
        };
        const approvalCookie = dependencies.cookieCodec.seal("pairing", cookie);
        const created = await dependencies.database.createApprovalChallenge(authority, {
          challengeDigest,
          challengeId,
          contextDigest,
          expiresAt: new Date(expiresAt).toISOString(),
        });
        if (
          !Array.isArray(created) ||
          created.length !== 1 ||
          !isRecord(created[0]) ||
          !exactKeys(created[0], ["challenge_id"]) ||
          created[0].challenge_id !== challengeId
        ) {
          return undefined;
        }
        return Object.freeze({ approvalCookie, options });
      } catch {
        return undefined;
      } finally {
        clearAuthority(authority);
        batch?.clear();
        clearAccounts(accounts);
        challengeDigest?.fill(0);
        contextDigest?.fill(0);
      }
    },
    async completeApproval(
      sessionCookie: string,
      approvalCookie: string,
      body: unknown,
    ): Promise<boolean> {
      const session = dependencies.readSession(sessionCookie);
      const now = dependencies.now();
      if (!session?.passkeyRegistered || !Number.isSafeInteger(now)) {
        return false;
      }
      const cookie = readApprovalCookie(
        dependencies.cookieCodec.open("pairing", approvalCookie),
        now,
        session.sessionId,
      );
      const response = authenticationResponse(body);
      if (cookie === undefined || response === undefined) {
        return false;
      }
      const authority = sessionAuthority(session);
      let batch: ApprovalBatch | undefined;
      let accounts: readonly ExistingAccount[] | undefined;
      let credentialId: Buffer | undefined;
      let material: PasskeyMaterial | undefined;
      let contextDigest: Buffer | undefined;
      try {
        if (authority === undefined) {
          return false;
        }
        [batch, accounts] = await Promise.all([
          loadBatch(authority, cookie.approval.pairingId),
          loadAccounts(authority),
        ]);
        if (batch === undefined || accounts === undefined || Date.parse(batch.expiresAt) <= now) {
          return false;
        }
        const decisions = internalDecisions(
          cookie.approval,
          batch,
          accounts,
          controlKey,
          session.sessionId,
        );
        if (decisions === undefined) {
          return false;
        }
        credentialId = passkeyLoginCredentialId(response);
        if (credentialId === undefined) {
          return false;
        }
        material = passkeyMaterial(await dependencies.database.readPasskey(credentialId));
        if (material === undefined) {
          return false;
        }
        const verified = await verifyPasskeyLogin(
          response,
          cookie.challenge,
          dependencies.webauthnOrigin,
          dependencies.webauthnRpId,
          {
            backupEligible: material.backupEligible,
            cosePublicKey: material.cosePublicKey,
            credentialId,
            signCount: material.signCount,
          },
        );
        if (verified === undefined) {
          return false;
        }
        contextDigest = pairingApprovalContextDigest(
          session.sessionId,
          cookie.approval,
          batch.installationPublicKey,
          batch.expiresAt,
          dependencies.webauthnRpId,
          dependencies.webauthnOrigin,
        );
        const result = await dependencies.database.approve({
          backupState: verified.backupState,
          challengeId: cookie.challengeId,
          contextDigest,
          decisions,
          manifestDigest: batch.manifestDigest,
          observedSignCount: verified.signCount,
          pairingId: batch.pairingId,
          sessionId: authority.sessionId,
          sessionVerifierDigest: authority.sessionVerifierDigest,
          verifiedPasskeyId: material.passkeyId,
        });
        const selected = cookie.approval.decisions.filter(
          (decision) => decision.action !== "skip",
        ).length;
        return (
          Array.isArray(result) &&
          result.length === 1 &&
          isRecord(result[0]) &&
          exactKeys(result[0], ["approved_count"]) &&
          result[0].approved_count === selected
        );
      } catch {
        return false;
      } finally {
        clearAuthority(authority);
        batch?.clear();
        clearAccounts(accounts);
        credentialId?.fill(0);
        clearPasskey(material);
        contextDigest?.fill(0);
      }
    },
    async review(sessionCookie: string, body: unknown): Promise<PairingBrowserReview | undefined> {
      const session = dependencies.readSession(sessionCookie);
      const userCode = codeBody(body);
      const now = dependencies.now();
      if (!session?.passkeyRegistered || userCode === undefined || !Number.isSafeInteger(now)) {
        return undefined;
      }
      const authority = sessionAuthority(session);
      const codeCandidates = dependencies.pairingCodeVerifier.derive(userCode);
      let batch: ApprovalBatch | undefined;
      let accounts: readonly ExistingAccount[] | undefined;
      try {
        if (authority === undefined || !codeCandidates.codeAccepted) {
          return undefined;
        }
        const pairingId = pairingIdResult(
          await dependencies.database.readPairingIdByCode(
            authority,
            codeCandidates.digests[0],
            codeCandidates.digests[1],
          ),
        );
        if (pairingId === undefined) {
          return undefined;
        }
        [batch, accounts] = await Promise.all([
          loadBatch(authority, pairingId),
          loadAccounts(authority),
        ]);
        if (batch === undefined || accounts === undefined || Date.parse(batch.expiresAt) <= now) {
          return undefined;
        }
        const loadedAccounts = accounts;
        const existingAccounts = loadedAccounts.map((account) =>
          Object.freeze({
            accountControl: controlFor(controlKey, session.sessionId, pairingId, account.accountId),
            privateLabel: account.privateLabel,
            provider: account.provider,
            state: account.state,
          }),
        );
        const candidates = batch.candidates.map((candidate) => {
          const match = loadedAccounts.find((account) => safeFingerprintMatch(candidate, account));
          return Object.freeze({
            candidateId: candidate.candidateId,
            fingerprintKind: candidate.fingerprintKind,
            preview: candidate.preview,
            provider: candidate.provider,
            safeDisplayLabel: candidate.safeDisplayLabel,
            ...(match === undefined
              ? {}
              : {
                  suggestedAgentAccountControl: controlFor(
                    controlKey,
                    session.sessionId,
                    pairingId,
                    match.accountId,
                  ),
                }),
          });
        });
        return Object.freeze({
          approval: Object.freeze({
            manifestDigest: batch.manifestDigest.toString("hex"),
            pairingId,
            schemaVersion: 1,
          }),
          pairing: Object.freeze({
            architecture: batch.architecture,
            candidates: Object.freeze(candidates),
            connectorVersion: batch.connectorVersion,
            existingAccounts: Object.freeze(existingAccounts),
            expiresAt: batch.expiresAt,
            installationLabel: batch.installationLabel,
            osFamily: batch.osFamily,
            publicKeyFingerprint: `SHA256:${createHash("sha256")
              .update(batch.installationPublicKey)
              .digest("base64url")}`,
          }),
        });
      } catch {
        return undefined;
      } finally {
        clearAuthority(authority);
        codeCandidates.clear();
        batch?.clear();
        clearAccounts(accounts);
      }
    },
  });
}
