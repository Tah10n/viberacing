import { describe, expect, it } from "vitest";

import * as admin from "./index.js";

describe("Admin package exports", () => {
  it("exports only the reviewed Access, application, configuration, pool, and store boundaries", () => {
    expect(Object.keys(admin).sort()).toEqual([
      "AdminAccessConfigurationError",
      "AdminAccessVerificationError",
      "AdminDatabaseConfigurationError",
      "AdminInviteIssuanceError",
      "AdminInviteStoreError",
      "adminAccessClockSkewSeconds",
      "adminAccessMaximumTokenLifetimeSeconds",
      "adminDatabaseConcurrencyLimit",
      "adminDatabaseConnectionTimeoutMs",
      "adminDatabaseQueryTimeoutMs",
      "adminDatabaseStatementTimeoutMs",
      "adminInviteLifetimeDays",
      "adminInviteReasonCode",
      "createAdminAccessVerifier",
      "createAdminDatabasePool",
      "createAdminInviteIssuer",
      "createAdminInviteStore",
      "resolveAdminAccessConfig",
      "resolveAdminDatabaseConfig",
    ]);
  });
});
