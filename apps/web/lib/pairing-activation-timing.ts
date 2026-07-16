import "server-only";

import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

export const pairingActivationMinimumSettlementMs = 250;

export class PairingActivationTimingError extends Error {
  constructor() {
    super("Pairing activation timing is unavailable.");
    this.name = "PairingActivationTimingError";
  }
}

export interface PairingActivationTiming {
  settle(startedAt: unknown): Promise<void>;
  start(): number;
}

export function createPairingActivationTiming(): PairingActivationTiming {
  return Object.freeze({
    async settle(startedAt: unknown): Promise<void> {
      const current = performance.now();
      if (
        typeof startedAt !== "number" ||
        !Number.isFinite(startedAt) ||
        !Number.isFinite(current) ||
        current < startedAt
      ) {
        throw new PairingActivationTimingError();
      }
      const remaining = pairingActivationMinimumSettlementMs - (current - startedAt);
      if (remaining > 0) {
        await delay(remaining);
      }
    },
    start(): number {
      const startedAt = performance.now();
      if (!Number.isFinite(startedAt)) {
        throw new PairingActivationTimingError();
      }
      return startedAt;
    },
  });
}
