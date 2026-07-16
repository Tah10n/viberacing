import "server-only";

import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

export const pairingStartMinimumSettlementMs = 250;

export class PairingStartTimingError extends Error {
  constructor() {
    super("Pairing start timing is unavailable.");
    this.name = "PairingStartTimingError";
  }
}

export interface PairingStartTiming {
  settle(startedAt: unknown): Promise<void>;
  start(): number;
}

export function createPairingStartTiming(): PairingStartTiming {
  return Object.freeze({
    async settle(startedAt: unknown): Promise<void> {
      const current = performance.now();
      if (
        typeof startedAt !== "number" ||
        !Number.isFinite(startedAt) ||
        !Number.isFinite(current) ||
        current < startedAt
      ) {
        throw new PairingStartTimingError();
      }
      const remaining = pairingStartMinimumSettlementMs - (current - startedAt);
      if (remaining > 0) {
        await delay(remaining);
      }
    },
    start(): number {
      const startedAt = performance.now();
      if (!Number.isFinite(startedAt)) {
        throw new PairingStartTimingError();
      }
      return startedAt;
    },
  });
}
