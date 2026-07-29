import { describe, expect, it, vi } from "vitest";

import { resolvePublicSnapshotDatabaseConfig } from "./public-snapshot-database-config";
import {
  createPublicSnapshotDatabasePool,
  type PublicSnapshotDatabasePoolSignal,
} from "./public-snapshot-database-pool";

const config = resolvePublicSnapshotDatabaseConfig({
  NODE_ENV: "development",
  VIBERACING_WEB_DATABASE_HOST: "127.0.0.1",
  VIBERACING_WEB_DATABASE_NAME: "viberacing_local",
  VIBERACING_WEB_DATABASE_PASSWORD: "private-password-for-tests",
  VIBERACING_WEB_DATABASE_PORT: "54329",
  VIBERACING_WEB_DATABASE_TLS_MODE: "disable",
  VIBERACING_WEB_DATABASE_USER: "viberacing_web_login",
});

describe("public snapshot database pool", () => {
  it("wraps the driver behind the narrow query, release, and close boundary", async () => {
    const rows = [{ public: true }];
    const driverQueries: { text: string; values: unknown[] }[] = [];
    const releases: boolean[] = [];
    let ended = false;
    const driverClient = {
      query(query: { text: string; values: unknown[] }): Promise<{ rows: unknown }> {
        driverQueries.push(query);
        return Promise.resolve({ rows });
      },
      release(destroy = false): void {
        releases.push(destroy);
      },
    };
    const driverPool = {
      connect() {
        return Promise.resolve(driverClient);
      },
      end(): Promise<void> {
        ended = true;
        return Promise.resolve();
      },
      on() {
        return this;
      },
    };
    const pool = createPublicSnapshotDatabasePool(config, undefined, (receivedConfig) => {
      expect(receivedConfig).toBe(config);
      return driverPool;
    });
    const client = await pool.connect();
    const values: unknown[] = ["2026-07-13", 32];

    await expect(client.query("SELECT fixed", values)).resolves.toBe(rows);
    values.push("late-mutation");
    client.release();
    client.release(true);
    await pool.close();

    expect(driverQueries).toEqual([{ text: "SELECT fixed", values: ["2026-07-13", 32] }]);
    expect(releases).toEqual([false, true]);
    expect(ended).toBe(true);
    expect(Object.isFrozen(client)).toBe(true);
    expect(Object.isFrozen(pool)).toBe(true);
  });

  it("reports idle-driver errors only through one stable non-reflective signal", () => {
    const privateMessage = "private-driver-error-that-must-not-be-reflected";
    const signals: PublicSnapshotDatabasePoolSignal[] = [];
    let idleErrorListener: ((error: Error) => void) | undefined;
    const driverPool = {
      connect(): Promise<never> {
        return Promise.reject(new Error("not used"));
      },
      end(): Promise<void> {
        return Promise.resolve();
      },
      on(event: "error", listener: (error: Error) => void) {
        expect(event).toBe("error");
        idleErrorListener = listener;
        return this;
      },
    };

    createPublicSnapshotDatabasePool(
      config,
      (signal) => {
        signals.push(signal);
      },
      () => driverPool,
    );
    expect(idleErrorListener).toBeDefined();
    idleErrorListener?.(new Error(privateMessage));

    expect(signals).toEqual(["idle_client_error"]);
    expect(JSON.stringify(signals)).not.toContain(privateMessage);
  });

  it("contains failures in an optional monitoring sink", () => {
    let idleErrorListener: ((error: Error) => void) | undefined;
    const driverPool = {
      connect(): Promise<never> {
        return Promise.reject(new Error("not used"));
      },
      end(): Promise<void> {
        return Promise.resolve();
      },
      on(event: "error", listener: (error: Error) => void) {
        expect(event).toBe("error");
        idleErrorListener = listener;
        return this;
      },
    };
    const sink = vi.fn(() => {
      throw new Error("monitoring failure");
    });

    createPublicSnapshotDatabasePool(config, sink, () => driverPool);

    expect(() => idleErrorListener?.(new Error("driver failure"))).not.toThrow();
    expect(sink).toHaveBeenCalledWith("idle_client_error");
  });

  it("contains an asynchronously rejected monitoring sink", async () => {
    let idleErrorListener: ((error: Error) => void) | undefined;
    const driverPool = {
      connect(): Promise<never> {
        return Promise.reject(new Error("not used"));
      },
      end(): Promise<void> {
        return Promise.resolve();
      },
      on(event: "error", listener: (error: Error) => void) {
        expect(event).toBe("error");
        idleErrorListener = listener;
        return this;
      },
    };
    const sink = vi.fn(() => Promise.reject(new Error("monitoring failure")));

    createPublicSnapshotDatabasePool(config, sink, () => driverPool);
    idleErrorListener?.(new Error("driver failure"));

    await expect(Promise.resolve()).resolves.toBeUndefined();
    expect(sink).toHaveBeenCalledWith("idle_client_error");
  });
});
