// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createConfiguredConnectorCarProposalService } from "./connector-car-proposal-service";

describe("connector car proposal service", () => {
  it("constructs one lazy Web/Auth boundary and closes idempotently without connecting", async () => {
    const service = await createConfiguredConnectorCarProposalService({
      NODE_ENV: "test",
      VIBERACING_WEB_DATABASE_HOST: "127.0.0.1",
      VIBERACING_WEB_DATABASE_NAME: "viberacing_local",
      VIBERACING_WEB_DATABASE_PASSWORD: "synthetic-proposal-database-password",
      VIBERACING_WEB_DATABASE_PORT: "54329",
      VIBERACING_WEB_DATABASE_TLS_MODE: "disable",
      VIBERACING_WEB_DATABASE_USER: "viberacing_web_login",
    });

    expect(Object.isFrozen(service)).toBe(true);
    await expect(service.close()).resolves.toBeUndefined();
    await expect(service.close()).resolves.toBeUndefined();
  });
});
