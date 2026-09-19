import { createServer, type Socket } from "node:net";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { query } from "./db";
import { problem } from "./http";

describe.skipIf(process.env.VIBERACING_TEST_ADMISSION_DATABASE !== "synthetic-local")(
  "real PostgreSQL connection timeout",
  () => {
    it("returns 503 with Retry-After when a peer never completes the handshake", async () => {
      const sockets = new Set<Socket>();
      const server = createServer((socket) => {
        sockets.add(socket);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing fixture address");
      const pool = new Pool({
        host: "127.0.0.1",
        port: address.port,
        user: "synthetic",
        password: "synthetic",
        connectionTimeoutMillis: 50,
      });
      const shared = globalThis as typeof globalThis & { viberacingPool?: Pool };
      const original = shared.viberacingPool;
      shared.viberacingPool = pool;
      try {
        const error: unknown = await query("SELECT 1").catch((error: unknown) => error);
        const response = problem(500, "server_error", error);
        expect(response.status).toBe(503);
        expect(response.headers.get("Retry-After")).toBe("1");
      } finally {
        if (original === undefined) delete shared.viberacingPool;
        else shared.viberacingPool = original;
        for (const socket of sockets) socket.destroy();
        await pool.end();
        await new Promise<void>((resolve) =>
          server.close(() => {
            resolve();
          }),
        );
      }
    });
  },
);
