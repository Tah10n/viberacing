import "server-only";

import { resolveEnrollmentConfig, type EnrollmentConfig } from "./enrollment-config";
import { createEnrollmentCookieCodec } from "./enrollment-cookie";
import { createConfiguredEnrollmentDatabase } from "./enrollment-database";
import { createEnrollmentService, type EnrollmentService } from "./enrollment-service";

export type EnrollmentRuntimeConfig = Readonly<
  Pick<EnrollmentConfig, "publicOrigin" | "secureCookies">
>;

export interface EnrollmentRuntime {
  readonly config: EnrollmentRuntimeConfig;
  readonly service: EnrollmentService;
}

let configuredRuntime: EnrollmentRuntime | undefined;

export function getEnrollmentRuntime(): EnrollmentRuntime {
  configuredRuntime ??= (() => {
    const config = resolveEnrollmentConfig();
    try {
      const cookieCodec = createEnrollmentCookieCodec(config.cookieKey);
      const database = createConfiguredEnrollmentDatabase();
      const service = createEnrollmentService({ config, cookieCodec, database });
      const publicConfig: EnrollmentRuntimeConfig = Object.freeze({
        publicOrigin: config.publicOrigin,
        secureCookies: config.secureCookies,
      });
      return Object.freeze({ config: publicConfig, service });
    } finally {
      config.cookieKey.fill(0);
    }
  })();
  return configuredRuntime;
}
