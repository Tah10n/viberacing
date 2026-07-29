import "server-only";

import { createEnrollmentAdmission } from "./enrollment-admission";
import { getEnrollmentRuntime } from "./enrollment-runtime";
import {
  createBatchPairingBrowserHttp,
  type BatchPairingBrowserHttp,
} from "./batch-pairing-browser-http";
import { resolvePairingConfig } from "./pairing-config";
import { resolvePublicOrigin } from "./public-origin";

const pairingConfig = resolvePairingConfig();
const publicOrigin = resolvePublicOrigin().origin;

export const batchPairingBrowserHttp: BatchPairingBrowserHttp = createBatchPairingBrowserHttp({
  admission: createEnrollmentAdmission(),
  enabled: pairingConfig.enabled,
  getService: () => getEnrollmentRuntime().batchPairingService,
  publicOrigin,
  secureCookies: publicOrigin.startsWith("https://"),
});
