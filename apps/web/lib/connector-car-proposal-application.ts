import "server-only";

import { Buffer } from "node:buffer";
import crypto from "node:crypto";

import type { ConnectorCarProposalDatabase } from "./connector-car-proposal-database";
import {
  ConnectorCarProposalVerificationError,
  type ConnectorCarProposalVerifier,
} from "./connector-car-proposal-verifier";

const requestKeys = new Set([
  "deviceId",
  "deviceNonce",
  "deviceSignature",
  "deviceTimestamp",
  "rawBody",
]);
const requestIdPattern = /^req_[A-Za-z0-9_-]{22}$/;

export type ConnectorCarProposalDecision =
  | Readonly<{ outcome: "accepted"; requestId: string }>
  | Readonly<{
      outcome: "rejected";
      problem: "invalid_request" | "temporarily_unavailable" | "unauthorized" | "validation_failed";
      requestId: string;
    }>;

export interface ConnectorCarProposalApplicationOptions {
  readonly database: ConnectorCarProposalDatabase;
  readonly randomBytes?: (size: number) => Uint8Array;
  readonly verifier: ConnectorCarProposalVerifier;
}

export interface ConnectorCarProposalApplication {
  execute(input: unknown, requestId: string): Promise<ConnectorCarProposalDecision>;
}

export class ConnectorCarProposalApplicationConfigurationError extends Error {
  constructor() {
    super("Connector car proposal application configuration is invalid.");
    this.name = "ConnectorCarProposalApplicationConfigurationError";
  }
}

function isPlainRecord(value: unknown): value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: object): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === requestKeys.size &&
    keys.every((key) => typeof key === "string" && requestKeys.has(key))
  );
}

function ownDataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor && descriptor.enumerable
    ? (descriptor.value as unknown)
    : undefined;
}

function readRequestId(value: unknown): string | undefined {
  return typeof value === "string" && requestIdPattern.test(value) ? value : undefined;
}

function createUuidV4(randomBytes: (size: number) => Uint8Array): string | undefined {
  let entropy: Buffer | undefined;
  try {
    const raw = randomBytes(16);
    if (!(raw instanceof Uint8Array) || raw.byteLength !== 16) {
      return undefined;
    }
    entropy = Buffer.from(raw);
    entropy[6] = ((entropy[6] ?? 0) & 0x0f) | 0x40;
    entropy[8] = ((entropy[8] ?? 0) & 0x3f) | 0x80;
    const hex = entropy.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return undefined;
  } finally {
    entropy?.fill(0);
  }
}

function reject(
  requestId: string,
  problem: Extract<ConnectorCarProposalDecision, { outcome: "rejected" }>["problem"],
): ConnectorCarProposalDecision {
  return Object.freeze({ outcome: "rejected", problem, requestId });
}

export function createConnectorCarProposalApplication(
  options: ConnectorCarProposalApplicationOptions,
): ConnectorCarProposalApplication {
  const randomBytes = options.randomBytes ?? crypto.randomBytes;
  return Object.freeze({
    async execute(input: unknown, requestId: string): Promise<ConnectorCarProposalDecision> {
      if (readRequestId(requestId) === undefined) {
        throw new ConnectorCarProposalApplicationConfigurationError();
      }
      if (!isPlainRecord(input) || !hasExactKeys(input)) {
        return reject(requestId, "invalid_request");
      }
      let verified;
      try {
        verified = await options.verifier.verify(
          Object.freeze({
            deviceId: ownDataValue(input, "deviceId"),
            deviceNonce: ownDataValue(input, "deviceNonce"),
            deviceSignature: ownDataValue(input, "deviceSignature"),
            deviceTimestamp: ownDataValue(input, "deviceTimestamp"),
            rawBody: ownDataValue(input, "rawBody"),
          }),
        );
      } catch (error) {
        if (error instanceof ConnectorCarProposalVerificationError) {
          if (error.code === "device_rejected") {
            return reject(requestId, "unauthorized");
          }
          if (error.code === "invalid_body") {
            return reject(requestId, "validation_failed");
          }
          if (error.code === "invalid_request") {
            return reject(requestId, "invalid_request");
          }
        }
        return reject(requestId, "temporarily_unavailable");
      }

      const proposalId = createUuidV4(randomBytes);
      if (proposalId === undefined) {
        verified.nonceDigest.fill(0);
        return reject(requestId, "temporarily_unavailable");
      }
      try {
        const proposed = await options.database.propose(
          Object.freeze({
            deviceId: verified.deviceId,
            deviceKeyId: verified.deviceKeyId,
            nonceDigest: verified.nonceDigest,
            observedAt: verified.observedAt,
            proposalId,
            recipe: verified.recipe,
          }),
        );
        return proposed
          ? Object.freeze({ outcome: "accepted", requestId })
          : reject(requestId, "temporarily_unavailable");
      } catch {
        return reject(requestId, "temporarily_unavailable");
      } finally {
        verified.nonceDigest.fill(0);
      }
    },
  });
}
