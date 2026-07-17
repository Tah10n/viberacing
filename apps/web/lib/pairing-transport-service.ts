import "server-only";

import {
  createPairingActivationApplication,
  type PairingActivationDecision,
} from "./pairing-activation-application";
import { createPairingActivationDatabase } from "./pairing-activation-database";
import { resolvePairingDatabaseConfig } from "./pairing-database-config";
import {
  createPairingDatabasePool,
  type PairingDatabasePoolSignalSink,
} from "./pairing-database-pool";
import { createPairingActivationTiming } from "./pairing-activation-timing";
import { resolvePairingRatePolicy } from "./pairing-rate-policy";
import { createPairingStartAdmission } from "./pairing-start-admission";
import {
  createPairingStartApplication,
  type PairingStartDecision,
} from "./pairing-start-application";
import { createPairingStartDatabase } from "./pairing-start-database";
import { createPairingStartTiming } from "./pairing-start-timing";
import { createConfiguredPairingPollVerifier } from "./pairing-poll-verifier";
import { createConfiguredPairingUserCodeVerifier } from "./pairing-user-code-verifier";

type Environment = Readonly<Record<string, string | undefined>>;

export interface PairingTransportService {
  close(): Promise<void>;
  poll(request: unknown): Promise<PairingActivationDecision>;
  start(request: unknown): Promise<PairingStartDecision>;
}

export async function createConfiguredPairingTransportService(
  environment: Environment = process.env,
  signalSink?: PairingDatabasePoolSignalSink,
): Promise<PairingTransportService> {
  const pollVerifier = createConfiguredPairingPollVerifier(environment);
  let codeVerifier: ReturnType<typeof createConfiguredPairingUserCodeVerifier> | undefined;
  let pool: ReturnType<typeof createPairingDatabasePool> | undefined;
  try {
    codeVerifier = createConfiguredPairingUserCodeVerifier(environment);
    pool = createPairingDatabasePool(resolvePairingDatabaseConfig(environment), signalSink);
    const admission = createPairingStartAdmission();
    const ratePolicy = resolvePairingRatePolicy(environment);
    const start = createPairingStartApplication({
      admission,
      database: createPairingStartDatabase(pool),
      pollVerifier,
      ratePolicy,
      timing: createPairingStartTiming(),
      userCodeVerifier: codeVerifier,
    });
    const poll = createPairingActivationApplication({
      admission,
      database: createPairingActivationDatabase(pool),
      pollVerifier,
      ratePolicy,
      timing: createPairingActivationTiming(),
    });
    let closed = false;
    return Object.freeze({
      async close(): Promise<void> {
        if (!closed) {
          closed = true;
          pollVerifier.close();
          codeVerifier?.close();
          await pool?.close();
        }
      },
      poll: poll.execute.bind(poll),
      start: start.execute.bind(start),
    });
  } catch (error) {
    pollVerifier.close();
    codeVerifier?.close();
    await pool?.close().catch(() => undefined);
    throw error;
  }
}

let configuredService: Promise<PairingTransportService> | undefined;

export function getPairingTransportService(): Promise<PairingTransportService> {
  configuredService ??= createConfiguredPairingTransportService();
  return configuredService;
}
