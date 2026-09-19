import { describe, expect, it, vi } from "vitest";
import {
  ConcurrencyLimit,
  RejectionBackoff,
  ResourceOverloaded,
  isResourceOverloaded,
} from "./overload";

describe("bounded local safeguards", () => {
  it("recognizes overloads from another Next bundle constructor", () => {
    class OtherBundleOverload extends Error {
      readonly code = "VIBERACING_OVERLOADED";
    }
    const error = new OtherBundleOverload();
    expect(error instanceof ResourceOverloaded).toBe(false);
    expect(isResourceOverloaded(error)).toBe(true);
    expect(isResourceOverloaded(new Error("unrelated"))).toBe(false);
  });
  it("bounds waiters and their time, then reuses freed capacity", async () => {
    vi.useFakeTimers();
    try {
      const limit = new ConcurrencyLimit(1, 1, 100);
      let release: (() => void) | undefined;
      const first = limit.run(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const waiting = expect(limit.run(() => Promise.resolve())).rejects.toBeInstanceOf(
        ResourceOverloaded,
      );
      await expect(limit.run(() => Promise.resolve())).rejects.toBeInstanceOf(ResourceOverloaded);
      await vi.advanceTimersByTimeAsync(100);
      await waiting;
      release?.();
      await first;
      await expect(limit.run(() => Promise.resolve(1))).resolves.toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects without queuing and recovers after work finishes or throws", async () => {
    const limit = new ConcurrencyLimit(1);
    let finish!: () => void;
    const first = limit.run(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await expect(limit.run(() => Promise.resolve())).rejects.toBeInstanceOf(ResourceOverloaded);
    expect(limit.size).toBe(1);
    finish();
    await first;
    await expect(limit.run(() => Promise.reject(new Error("synthetic")))).rejects.toThrow(
      "synthetic",
    );
    expect(limit.size).toBe(0);
    await expect(limit.run(() => Promise.resolve(42))).resolves.toBe(42);
  });
  it("caps keys, does not extend rejected traffic retention, and expires at the boundary", () => {
    const backoff = new RejectionBackoff(2, 1000);
    backoff.add("A", 100);
    backoff.add("B", 100);
    backoff.add("C", 100);
    expect(backoff.size).toBe(2);
    expect(backoff.has("C", 100)).toBe(false);
    backoff.add("A", 1099);
    expect(backoff.has("A", 1099)).toBe(true);
    expect(backoff.has("A", 1100)).toBe(false);
    backoff.add("C", 1100);
    expect(backoff.size).toBe(1);
    expect(new RejectionBackoff().size).toBe(0);
    backoff.add("window", 1900, 2000);
    expect(backoff.has("window", 1999)).toBe(true);
    expect(backoff.has("window", 2000)).toBe(false);
  });
});
