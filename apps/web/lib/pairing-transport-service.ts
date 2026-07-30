import "server-only";

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  validateConnectorPairingPollResultV1,
  validateConnectorPairingPollV1,
  validateConnectorPairingStartResultV1,
  validateConnectorPairingStartV1,
  type ConnectorDiscoveryManifestV1,
  type ConnectorPairingPollResultV1,
  type ConnectorPairingStartResultV1,
} from "@viberacing/contracts";

import { createBatchPairingDatabase, type BatchPairingDatabase } from "./batch-pairing-database";
import { createPairingStartAdmission, type PairingStartAdmission } from "./pairing-start-admission";
import { createPairingStartMaterial } from "./pairing-start-material";
import { createPairingStartTiming, type PairingStartTiming } from "./pairing-start-timing";
import {
  pairingChallengeBytes,
  pairingIdPattern,
  pairingPublicKeyBytes,
  verifyPairingPollPossession,
  verifyPairingStartPossession,
} from "./pairing-possession-verifier";
import {
  createConfiguredPairingPollVerifier,
  type PairingPollVerifier,
} from "./pairing-poll-verifier";
import {
  derivePairingPollRateIdentity,
  derivePairingStartRateIdentity,
  resolvePairingRatePolicy,
  type PairingRatePolicy,
} from "./pairing-rate-policy";
import {
  createConfiguredPairingUserCodeVerifier,
  type PairingUserCodeVerifier,
} from "./pairing-user-code-verifier";
import { resolvePublicOrigin } from "./public-origin";
import { createPublicRequestId } from "./public-http-problem";

export type PairingStartDecision =
  | Readonly<{ outcome: "created"; result: ConnectorPairingStartResultV1 }>
  | Readonly<{ outcome: "invalid" | "unavailable" }>;

export type PairingPollDecision =
  | Readonly<{ outcome: "ok"; result: ConnectorPairingPollResultV1 }>
  | Readonly<{ outcome: "invalid" | "unavailable" }>;

export interface PairingTransportService {
  close(): Promise<void>;
  poll(request: unknown): Promise<PairingPollDecision>;
  start(request: unknown): Promise<PairingStartDecision>;
}

export interface PairingTransportDependencies {
  readonly admission: PairingStartAdmission;
  readonly database: BatchPairingDatabase;
  readonly now: () => number;
  readonly pollVerifier: PairingPollVerifier;
  readonly publicOrigin: string;
  readonly ratePolicy: PairingRatePolicy;
  readonly timing: PairingStartTiming;
  readonly userCodeVerifier: PairingUserCodeVerifier;
}

interface PossessionRow {
  readonly installationPublicKey: Buffer;
  readonly pairingChallenge: Buffer;
  readonly pairingState: string;
  readonly verifierIndex: 0 | 1;
}

const identifierDigestPrefix = Buffer.from("viberacing-installation-id-v1\n", "utf8");

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function exactBytes(value: unknown, length: number): Buffer | undefined {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) {
    return undefined;
  }
  const copy = Buffer.from(value);
  let combined = 0;
  for (const byte of copy) {
    combined |= byte;
  }
  if (combined === 0) {
    copy.fill(0);
    return undefined;
  }
  return copy;
}

function startPersisted(value: unknown, pairingId: string): boolean {
  return (
    Array.isArray(value) &&
    value.length === 1 &&
    isRecord(value[0]) &&
    exactKeys(value[0], ["pairing_id"]) &&
    value[0].pairing_id === pairingId
  );
}

function mutationCount(value: unknown, field: string): number | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !isRecord(value[0]) ||
    !exactKeys(value[0], [field])
  ) {
    return undefined;
  }
  const count = value[0][field];
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 16
    ? count
    : undefined;
}

function rateAdmitted(value: unknown): boolean | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !isRecord(value[0]) ||
    !exactKeys(value[0], ["admitted"]) ||
    typeof value[0].admitted !== "boolean"
  ) {
    return undefined;
  }
  return value[0].admitted;
}

function possessionRow(value: unknown): PossessionRow | undefined {
  let key: Buffer | undefined;
  let challenge: Buffer | undefined;
  try {
    if (
      !Array.isArray(value) ||
      value.length !== 1 ||
      !isRecord(value[0]) ||
      !exactKeys(value[0], [
        "verifier_index",
        "installation_public_key",
        "possession_challenge",
        "manifest_digest",
        "pairing_state",
      ])
    ) {
      return undefined;
    }
    const row = value[0];
    key = exactBytes(row.installation_public_key, pairingPublicKeyBytes);
    challenge = exactBytes(row.possession_challenge, pairingChallengeBytes);
    const manifest = exactBytes(row.manifest_digest, 32);
    manifest?.fill(0);
    if (
      key === undefined ||
      challenge === undefined ||
      manifest === undefined ||
      (row.verifier_index !== 1 && row.verifier_index !== 2) ||
      typeof row.pairing_state !== "string" ||
      !["pending", "approved", "activated", "rejected", "expired"].includes(row.pairing_state)
    ) {
      return undefined;
    }
    return {
      installationPublicKey: key,
      pairingChallenge: challenge,
      pairingState: row.pairing_state,
      verifierIndex: (row.verifier_index - 1) as 0 | 1,
    };
  } catch {
    key?.fill(0);
    challenge?.fill(0);
    return undefined;
  }
}

function pollRows(value: unknown, requestId: string): ConnectorPairingPollResultV1 | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
    return undefined;
  }
  let pairingState: "activated" | "approved" | "expired" | "pending" | undefined;
  const candidateActivations: ConnectorPairingPollResultV1["candidateActivations"][number][] = [];
  const seen = new Set<string>();
  for (const input of value) {
    if (
      !isRecord(input) ||
      !exactKeys(input, [
        "pairing_state",
        "candidate_id",
        "activation_state",
        "agent_account_id",
        "device_id",
        "device_key_id",
      ]) ||
      typeof input.pairing_state !== "string" ||
      !["activated", "approved", "expired", "pending"].includes(input.pairing_state) ||
      typeof input.candidate_id !== "string" ||
      !/^cand_[A-Za-z0-9_-]{22}$/.test(input.candidate_id) ||
      seen.has(input.candidate_id) ||
      (input.activation_state !== "active" &&
        input.activation_state !== "pending" &&
        input.activation_state !== "skipped")
    ) {
      return undefined;
    }
    if (pairingState !== undefined && pairingState !== input.pairing_state) {
      return undefined;
    }
    pairingState = input.pairing_state as typeof pairingState;
    seen.add(input.candidate_id);
    if (input.activation_state === "active") {
      if (
        typeof input.agent_account_id !== "string" ||
        !/^acc_[A-Za-z0-9_-]{22}$/.test(input.agent_account_id) ||
        typeof input.device_id !== "string" ||
        !/^dev_[A-Za-z0-9_-]{22}$/.test(input.device_id) ||
        typeof input.device_key_id !== "string" ||
        !/^key_[A-Za-z0-9_-]{22}$/.test(input.device_key_id)
      ) {
        return undefined;
      }
      candidateActivations.push({
        activationState: "active",
        agentAccountId: input.agent_account_id,
        candidateId: input.candidate_id,
        deviceId: input.device_id,
        nextAction: "sync",
        serverBindingMaterial: {
          deviceKeyId: input.device_key_id,
          signatureProtocol: "viberacing-usage-sync-auth-v1",
          usageEndpoint: "/v1/usage",
        },
      });
    } else {
      if (
        input.agent_account_id !== null ||
        input.device_id !== null ||
        input.device_key_id !== null
      ) {
        return undefined;
      }
      candidateActivations.push({
        activationState: input.activation_state,
        candidateId: input.candidate_id,
        nextAction:
          input.activation_state === "skipped"
            ? "none"
            : pairingState === "expired"
              ? "reconnect_account"
              : "wait",
      });
    }
  }
  if (pairingState === undefined) {
    return undefined;
  }
  const result: ConnectorPairingPollResultV1 = {
    candidateActivations,
    pairingState,
    requestId,
    schemaVersion: 1,
  };
  const validation = validateConnectorPairingPollResultV1(result);
  return validation.ok ? validation.value : undefined;
}

function installationId(publicKey: Uint8Array): string {
  const digest = createHash("sha256").update(identifierDigestPrefix).update(publicKey).digest();
  try {
    return `ins_${digest.subarray(0, 16).toString("base64url")}`;
  } finally {
    digest.fill(0);
  }
}

function installationLabel(osFamily: string, architecture: string): string {
  const os = osFamily === "windows" ? "Windows" : osFamily === "macos" ? "macOS" : "Linux";
  return `${os} ${architecture}`;
}

function internalCandidates(
  candidates: ConnectorDiscoveryManifestV1["candidates"],
): readonly Readonly<Record<string, unknown>>[] {
  return (
    candidates as readonly {
      readonly accountFingerprintDigest?: string;
      readonly accountingRevision: number;
      readonly candidateId: string;
      readonly fingerprintKind: string;
      readonly preview: {
        readonly currentWeekTokenTotal: string;
        readonly lastUsageDate: string | null;
        readonly status: string;
      };
      readonly provider: string;
      readonly readerVersion: string;
      readonly safeDisplayLabel: string;
      readonly scopeKind: string;
      readonly syncPublicKey: string;
    }[]
  ).map((candidate) =>
    Object.freeze({
      accountingRevision: candidate.accountingRevision,
      candidateId: candidate.candidateId,
      displayLabel: candidate.safeDisplayLabel,
      fingerprintDigest: candidate.accountFingerprintDigest ?? null,
      fingerprintKind: candidate.fingerprintKind,
      preview: Object.freeze({
        currentWeekTokenTotal: candidate.preview.currentWeekTokenTotal,
        lastUsageDate: candidate.preview.lastUsageDate,
        status: candidate.preview.status,
      }),
      provider: candidate.provider,
      readerVersion: candidate.readerVersion,
      scopeKind: candidate.scopeKind,
      syncPublicKey: Buffer.from(candidate.syncPublicKey, "base64url").toString("hex"),
    }),
  );
}

function requestId(): string {
  return createPublicRequestId().value;
}

export function createPairingTransportService(
  dependencies: PairingTransportDependencies,
): PairingTransportService {
  return Object.freeze({
    async close(): Promise<void> {
      dependencies.pollVerifier.close();
      dependencies.userCodeVerifier.close();
      await dependencies.database.close();
    },
    async poll(requestInput: unknown): Promise<PairingPollDecision> {
      const validation = validateConnectorPairingPollV1(requestInput);
      if (!validation.ok) {
        return Object.freeze({ outcome: "invalid" });
      }
      const rateIdentity = derivePairingPollRateIdentity(validation.value.pollToken);
      if (!rateIdentity.accepted) {
        rateIdentity.digest.fill(0);
        return Object.freeze({ outcome: "invalid" });
      }
      const lease = dependencies.admission.tryAcquire();
      if (lease === undefined) {
        rateIdentity.digest.fill(0);
        return Object.freeze({ outcome: "unavailable" });
      }
      const startedAt = dependencies.timing.start();
      let pollCandidates: ReturnType<PairingPollVerifier["derive"]> | undefined;
      let material: PossessionRow | undefined;
      try {
        const limits = dependencies.ratePolicy.limits("poll");
        const admitted = rateAdmitted(
          await dependencies.database.admit({
            ...limits,
            clientIdentityDigest: rateIdentity.digest,
            operation: "poll",
          }),
        );
        if (admitted !== true) {
          return Object.freeze({ outcome: "unavailable" });
        }
        pollCandidates = dependencies.pollVerifier.derive(validation.value.pollToken);
        if (!pollCandidates.tokenAccepted || !pairingIdPattern.test(validation.value.pairingId)) {
          return Object.freeze({ outcome: "invalid" });
        }
        material = possessionRow(
          await dependencies.database.readPossession(
            validation.value.pairingId,
            pollCandidates.digests,
          ),
        );
        if (
          material === undefined ||
          !(await verifyPairingPollPossession(
            {
              installationPublicKey: material.installationPublicKey,
              pairingChallenge: material.pairingChallenge,
              pairingId: validation.value.pairingId,
            },
            validation.value.possessionSignature,
          ))
        ) {
          return Object.freeze({ outcome: "invalid" });
        }
        const digest = pollCandidates.digests[material.verifierIndex];
        if (material.pairingState === "approved") {
          const activated = mutationCount(
            await dependencies.database.activate(validation.value.pairingId, digest),
            "activated_count",
          );
          if (activated === undefined) {
            return Object.freeze({ outcome: "unavailable" });
          }
        }
        const result = pollRows(
          await dependencies.database.poll(validation.value.pairingId, digest),
          requestId(),
        );
        return result === undefined
          ? Object.freeze({ outcome: "unavailable" })
          : Object.freeze({ outcome: "ok", result });
      } catch {
        return Object.freeze({ outcome: "unavailable" });
      } finally {
        material?.installationPublicKey.fill(0);
        material?.pairingChallenge.fill(0);
        rateIdentity.digest.fill(0);
        pollCandidates?.clear();
        await dependencies.timing.settle(startedAt).catch(() => undefined);
        lease.release();
      }
    },
    async start(requestInput: unknown): Promise<PairingStartDecision> {
      const validation = validateConnectorPairingStartV1(requestInput);
      if (!validation.ok) {
        return Object.freeze({ outcome: "invalid" });
      }
      const rateIdentity = derivePairingStartRateIdentity(validation.value.clientRateIdentifier);
      if (!rateIdentity.accepted) {
        rateIdentity.digest.fill(0);
        return Object.freeze({ outcome: "invalid" });
      }
      const lease = dependencies.admission.tryAcquire();
      if (lease === undefined) {
        rateIdentity.digest.fill(0);
        return Object.freeze({ outcome: "unavailable" });
      }
      const startedAt = dependencies.timing.start();
      let verified: Awaited<ReturnType<typeof verifyPairingStartPossession>> | undefined;
      let material: ReturnType<typeof createPairingStartMaterial> | undefined;
      let pollCandidates: ReturnType<PairingPollVerifier["derive"]> | undefined;
      let codeCandidates: ReturnType<PairingUserCodeVerifier["derive"]> | undefined;
      try {
        const limits = dependencies.ratePolicy.limits("start");
        const admitted = rateAdmitted(
          await dependencies.database.admit({
            ...limits,
            clientIdentityDigest: rateIdentity.digest,
            operation: "start",
          }),
        );
        if (admitted !== true) {
          return Object.freeze({ outcome: "unavailable" });
        }
        verified = await verifyPairingStartPossession(validation.value, dependencies.now());
        if (verified === undefined) {
          return Object.freeze({ outcome: "invalid" });
        }
        material = createPairingStartMaterial(dependencies.now());
        pollCandidates = dependencies.pollVerifier.derive(material.pollToken);
        codeCandidates = dependencies.userCodeVerifier.derive(material.userCode);
        if (!pollCandidates.tokenAccepted || !codeCandidates.codeAccepted) {
          return Object.freeze({ outcome: "unavailable" });
        }
        const manifest = validation.value.discoveryManifest;
        const persisted = await dependencies.database.start({
          architecture: manifest.architecture,
          candidates: internalCandidates(manifest.candidates),
          connectorVersion: manifest.connectorVersion,
          expiresAt: material.expiresAt,
          installationId: installationId(verified.installationPublicKey),
          installationLabel: installationLabel(manifest.osFamily, manifest.architecture),
          installationPublicKey: verified.installationPublicKey,
          manifestDigest: verified.manifestDigest,
          osFamily: manifest.osFamily,
          pairingChallenge: material.pairingChallenge,
          pairingId: material.pairingId,
          pollVerifierDigest: pollCandidates.digests[0],
          startProofDigest: verified.startProofDigest,
          userCodeVerifierDigest: codeCandidates.digests[0],
        });
        if (!startPersisted(persisted, material.pairingId)) {
          return Object.freeze({ outcome: "unavailable" });
        }
        const result: ConnectorPairingStartResultV1 = {
          approvalUrl: new URL(
            `/connect?code=${encodeURIComponent(material.userCode)}`,
            dependencies.publicOrigin,
          ).href,
          expiresAt: material.expiresAt,
          pairingChallenge: material.pairingChallengeBase64Url,
          pairingId: material.pairingId,
          pollToken: material.pollToken,
          requestId: requestId(),
          schemaVersion: 1,
          userCode: material.userCode,
        };
        const resultValidation = validateConnectorPairingStartResultV1(result);
        return resultValidation.ok
          ? Object.freeze({ outcome: "created", result: resultValidation.value })
          : Object.freeze({ outcome: "unavailable" });
      } catch {
        return Object.freeze({ outcome: "unavailable" });
      } finally {
        rateIdentity.digest.fill(0);
        verified?.clear();
        material?.clear();
        pollCandidates?.clear();
        codeCandidates?.clear();
        await dependencies.timing.settle(startedAt).catch(() => undefined);
        lease.release();
      }
    },
  });
}

let configuredService: Promise<PairingTransportService> | undefined;

export function getPairingTransportService(): Promise<PairingTransportService> {
  configuredService ??= Promise.resolve().then(() => {
    const environment = process.env;
    const publicOrigin = resolvePublicOrigin(
      environment.VIBERACING_PUBLIC_ORIGIN,
      environment.NODE_ENV,
    ).origin;
    return createPairingTransportService({
      admission: createPairingStartAdmission(),
      database: createBatchPairingDatabase(environment),
      now: Date.now,
      pollVerifier: createConfiguredPairingPollVerifier(environment),
      publicOrigin,
      ratePolicy: resolvePairingRatePolicy(environment),
      timing: createPairingStartTiming(),
      userCodeVerifier: createConfiguredPairingUserCodeVerifier(environment),
    });
  });
  return configuredService;
}
