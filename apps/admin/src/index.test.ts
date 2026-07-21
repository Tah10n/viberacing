import { describe, expect, it } from "vitest";

import * as admin from "./index.js";

describe("Admin package exports", () => {
  it("exports only the reviewed application, configuration, pool, and store boundaries", () => {
    expect(Object.keys(admin).sort()).toEqual([
      "AdminDatabaseConfigurationError",
      "AdminInviteIssuanceError",
      "AdminInviteStoreError",
      "adminDatabaseConcurrencyLimit",
      "adminDatabaseConnectionTimeoutMs",
      "adminDatabaseQueryTimeoutMs",
      "adminDatabaseStatementTimeoutMs",
      "adminInviteLifetimeDays",
      "adminInviteReasonCode",
      "createAdminDatabasePool",
      "createAdminInviteIssuer",
      "createAdminInviteStore",
      "resolveAdminDatabaseConfig",
    ]);
  });
});
