import "server-only";

import {
  createBatchPairingBrowserService,
  deriveBatchPairingControlKey,
  type BatchPairingBrowserService,
} from "./batch-pairing-browser-service";
import { createBatchPairingDatabase, type BatchPairingDatabase } from "./batch-pairing-database";
import { createCarProposalService, type CarProposalService } from "./car-proposal-service";
import { resolveEnrollmentConfig, type EnrollmentConfig } from "./enrollment-config";
import { createEnrollmentCookieCodec } from "./enrollment-cookie";
import { createConfiguredEnrollmentDatabase } from "./enrollment-database";
import { createEnrollmentService, type EnrollmentService } from "./enrollment-service";
import { createConfiguredPairingUserCodeVerifier } from "./pairing-user-code-verifier";

export type EnrollmentRuntimeConfig = Readonly<
  Pick<EnrollmentConfig, "publicOrigin" | "recoveryMinimumResponseMs" | "secureCookies">
>;

export interface EnrollmentRuntime {
  readonly batchPairingService: BatchPairingBrowserService;
  readonly carProposalService: CarProposalService;
  readonly config: EnrollmentRuntimeConfig;
  readonly service: EnrollmentService;
}

let configuredRuntime: EnrollmentRuntime | undefined;

export function getEnrollmentRuntime(): EnrollmentRuntime {
  configuredRuntime ??= (() => {
    const config = resolveEnrollmentConfig();
    let pairingCodeVerifier: ReturnType<typeof createConfiguredPairingUserCodeVerifier> | undefined;
    let pairingDatabase: BatchPairingDatabase | undefined;
    let pairingControlKey: Buffer | undefined;
    try {
      pairingCodeVerifier = createConfiguredPairingUserCodeVerifier();
      const cookieCodec = createEnrollmentCookieCodec(config.cookieKey);
      const database = createConfiguredEnrollmentDatabase();
      const service = createEnrollmentService({
        config,
        cookieCodec,
        database,
      });
      const carProposalService = createCarProposalService({
        cookieCodec,
        database,
        readSession: (sessionCookie) => service.readSession(sessionCookie),
      });
      pairingDatabase = createBatchPairingDatabase();
      pairingControlKey = deriveBatchPairingControlKey(config.cookieKey);
      const batchPairingService = createBatchPairingBrowserService({
        controlKey: pairingControlKey,
        cookieCodec,
        database: pairingDatabase,
        now: Date.now,
        pairingCodeVerifier,
        readSession: (sessionCookie) => service.readSession(sessionCookie),
        webauthnOrigin: config.webauthnOrigin,
        webauthnRpId: config.webauthnRpId,
      });
      const publicConfig: EnrollmentRuntimeConfig = Object.freeze({
        publicOrigin: config.publicOrigin,
        recoveryMinimumResponseMs: config.recoveryMinimumResponseMs,
        secureCookies: config.secureCookies,
      });
      return Object.freeze({
        batchPairingService,
        carProposalService,
        config: publicConfig,
        service,
      });
    } catch (error) {
      pairingCodeVerifier?.close();
      void pairingDatabase?.close().catch(() => undefined);
      throw error;
    } finally {
      pairingControlKey?.fill(0);
      config.cookieKey.fill(0);
      config.recoveryPepper.fill(0);
    }
  })();
  return configuredRuntime;
}
