import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { query, transaction } from "./db";
import { ResourceOverloaded } from "./overload";

const shared = globalThis as typeof globalThis & {
  viberacingPool?: Pool;
  viberacingPublicResponse?: AsyncLocalStorage<{ overloaded: boolean }>;
};
const originalPool = shared.viberacingPool;
const originalContext = shared.viberacingPublicResponse;
afterEach(() => {
  if (originalPool === undefined) delete shared.viberacingPool;
  else shared.viberacingPool = originalPool;
  if (originalContext === undefined) delete shared.viberacingPublicResponse;
  else shared.viberacingPublicResponse = originalContext;
});

it("marks in-flight admin shutdown as unavailable and preserves its diagnostic cause", async () => {
  const cause = Object.assign(new Error("terminating connection due to administrator command"), {
    code: "57P01",
  });
  shared.viberacingPool = {
    waitingCount: 0,
    query: vi.fn().mockRejectedValue(cause),
  } as unknown as Pool;
  const context = new AsyncLocalStorage<{ overloaded: boolean }>();
  shared.viberacingPublicResponse = context;
  const response = { overloaded: false };
  await context.run(response, async () => {
    const error = await query("SELECT 1").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ResourceOverloaded);
    expect(error).toHaveProperty("cause", cause);
    expect(response.overloaded).toBe(true);
  });
});

it("keeps the original failure when rollback also loses the connection", async () => {
  const cause = Object.assign(new Error("connection lost"), { code: "57P01" });
  const release = vi.fn();
  const client = {
    query: vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValue(new Error("connection not queryable")),
    release,
  };
  shared.viberacingPool = {
    waitingCount: 0,
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;
  const error = await transaction(() => Promise.reject(cause)).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(ResourceOverloaded);
  expect(error).toHaveProperty("cause", cause);
  expect(release).toHaveBeenCalledWith(true);
});
