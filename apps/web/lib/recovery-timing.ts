import "server-only";

import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

export interface RecoveryTiming {
  settle(startedAt: unknown): Promise<void>;
  start(): number;
}

export function createRecoveryTiming(minimumSettlementMs: number): RecoveryTiming {
  if (
    !Number.isSafeInteger(minimumSettlementMs) ||
    minimumSettlementMs < 100 ||
    minimumSettlementMs > 5_000
  ) {
    throw new Error("Recovery timing is unavailable.");
  }
  return Object.freeze({
    async settle(startedAt: unknown): Promise<void> {
      const current = performance.now();
      if (
        typeof startedAt !== "number" ||
        !Number.isFinite(startedAt) ||
        !Number.isFinite(current) ||
        current < startedAt
      ) {
        throw new Error("Recovery timing is unavailable.");
      }
      const remaining = minimumSettlementMs - (current - startedAt);
      if (remaining > 0) {
        await delay(remaining);
      }
    },
    start(): number {
      const startedAt = performance.now();
      if (!Number.isFinite(startedAt)) {
        throw new Error("Recovery timing is unavailable.");
      }
      return startedAt;
    },
  });
}
