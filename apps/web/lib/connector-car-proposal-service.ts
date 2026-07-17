import "server-only";

import {
  createConnectorCarProposalApplication,
  type ConnectorCarProposalApplication,
} from "./connector-car-proposal-application";
import { createConnectorCarProposalDatabase } from "./connector-car-proposal-database";
import { createConnectorCarProposalVerifier } from "./connector-car-proposal-verifier";
import { resolvePairingDatabaseConfig } from "./pairing-database-config";
import {
  createPairingDatabasePool,
  type PairingDatabasePoolSignalSink,
} from "./pairing-database-pool";

type Environment = Readonly<Record<string, string | undefined>>;

export interface ConnectorCarProposalService extends ConnectorCarProposalApplication {
  close(): Promise<void>;
}

export async function createConfiguredConnectorCarProposalService(
  environment: Environment = process.env,
  signalSink?: PairingDatabasePoolSignalSink,
): Promise<ConnectorCarProposalService> {
  const pool = createPairingDatabasePool(resolvePairingDatabaseConfig(environment), signalSink);
  try {
    const database = createConnectorCarProposalDatabase(pool);
    const verifier = createConnectorCarProposalVerifier({
      now: Date.now,
      readDeviceMaterial: database.readDeviceMaterial.bind(database),
    });
    const application = createConnectorCarProposalApplication({ database, verifier });
    let closed = false;
    return Object.freeze({
      async close(): Promise<void> {
        if (!closed) {
          closed = true;
          await pool.close();
        }
      },
      execute: application.execute.bind(application),
    });
  } catch (error) {
    await pool.close().catch(() => undefined);
    throw error;
  }
}

let configuredService: Promise<ConnectorCarProposalService> | undefined;

export function getConnectorCarProposalService(): Promise<ConnectorCarProposalService> {
  configuredService ??= createConfiguredConnectorCarProposalService();
  return configuredService;
}
