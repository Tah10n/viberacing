// @vitest-environment node

import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { createConfiguredPairingTransportService } from "./pairing-transport-service";

describe("pairing transport service", () => {
  it("constructs one shared local boundary and closes without connecting", async () => {
    const service = await createConfiguredPairingTransportService({
      NODE_ENV: "test",
      VIBERACING_WEB_DATABASE_HOST: "127.0.0.1",
      VIBERACING_WEB_DATABASE_NAME: "viberacing_local",
      VIBERACING_WEB_DATABASE_PASSWORD: "private-pairing-database-password",
      VIBERACING_WEB_DATABASE_PORT: "54329",
      VIBERACING_WEB_DATABASE_TLS_MODE: "disable",
      VIBERACING_WEB_DATABASE_USER: "viberacing_web_login",
      VIBERACING_WEB_PAIRING_CODE_PRIMARY_KEY_BASE64URL: Buffer.alloc(32, 0x55).toString(
        "base64url",
      ),
      VIBERACING_WEB_PAIRING_POLL_BUCKET_LIMIT: "120",
      VIBERACING_WEB_PAIRING_POLL_GLOBAL_LIMIT: "1200",
      VIBERACING_WEB_PAIRING_POLL_PRIMARY_KEY_BASE64URL: Buffer.alloc(32, 0x44).toString(
        "base64url",
      ),
      VIBERACING_WEB_PAIRING_POLL_WINDOW_SECONDS: "60",
      VIBERACING_WEB_PAIRING_START_BUCKET_LIMIT: "12",
      VIBERACING_WEB_PAIRING_START_GLOBAL_LIMIT: "120",
      VIBERACING_WEB_PAIRING_START_WINDOW_SECONDS: "60",
    });

    expect(Object.isFrozen(service)).toBe(true);
    await expect(service.close()).resolves.toBeUndefined();
    await expect(service.close()).resolves.toBeUndefined();
  });
});
