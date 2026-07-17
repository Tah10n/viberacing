import "server-only";

import { resolveEnrollmentConfig, type EnrollmentConfig } from "./enrollment-config";
import { createEnrollmentCookieCodec } from "./enrollment-cookie";
import { createConfiguredEnrollmentDatabase } from "./enrollment-database";
import { createEnrollmentService, type EnrollmentService } from "./enrollment-service";
import { createConfiguredPairingUserCodeVerifier } from "./pairing-user-code-verifier";

export type EnrollmentRuntimeConfig = Readonly<
  Pick<EnrollmentConfig, "publicOrigin" | "recoveryMinimumResponseMs" | "secureCookies">
>;

export interface EnrollmentRuntime {
  readonly config: EnrollmentRuntimeConfig;
  readonly service: EnrollmentService;
}

let configuredRuntime: EnrollmentRuntime | undefined;

export function getEnrollmentRuntime(): EnrollmentRuntime {
  configuredRuntime ??= (() => {
    const config = resolveEnrollmentConfig();
    let pairingCodeVerifier: ReturnType<typeof createConfiguredPairingUserCodeVerifier> | undefined;
    try {
      pairingCodeVerifier = createConfiguredPairingUserCodeVerifier();
      const cookieCodec = createEnrollmentCookieCodec(config.cookieKey);
      const database = createConfiguredEnrollmentDatabase();
      const service = createEnrollmentService({
        config,
        cookieCodec,
        database,
        derivePairingCode: pairingCodeVerifier.derive.bind(pairingCodeVerifier),
      });
      const publicConfig: EnrollmentRuntimeConfig = Object.freeze({
        publicOrigin: config.publicOrigin,
        recoveryMinimumResponseMs: config.recoveryMinimumResponseMs,
        secureCookies: config.secureCookies,
      });
      return Object.freeze({ config: publicConfig, service });
    } catch (error) {
      pairingCodeVerifier?.close();
      throw error;
    } finally {
      config.cookieKey.fill(0);
      config.recoveryPepper.fill(0);
    }
  })();
  return configuredRuntime;
}
