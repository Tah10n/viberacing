import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  browserSyncRunningPollIntervalMs,
  browserSyncRunningTimeoutMs,
  browserSyncWaitingPollIntervalMs,
  grantRetryAfterMilliseconds,
  pollBrowserSyncStatus,
  statusRetryAfterMilliseconds,
} from "./account-controls";

const component = readFileSync(new URL("./account-controls.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/account.css", import.meta.url), "utf8");

describe("account controls", () => {
  it("uses real buttons and reports connector completion before claiming success", () => {
    expect(component).toContain("Manage account");
    expect(component).toContain("aria-expanded={open}");
    expect(component).toContain('className="button button-secondary"');
    expect(component).toContain('className="button"');
    expect(component).toContain('result.status === "succeeded"');
    expect(component).toContain("Connector did not respond");
  });

  it("keeps polling a claimed running sync beyond the connector lock wait", async () => {
    let now = 0;
    let runningReports = 0;
    const outcome = await pollBrowserSyncStatus({
      fetchStatus: () =>
        Promise.resolve(Response.json({ status: "running", resultCode: null }, { status: 200 })),
      now: () => now,
      onRunning: () => {
        runningReports += 1;
      },
      pause: () => {
        now += 60_000;
        return Promise.resolve();
      },
    });
    expect(browserSyncRunningTimeoutMs).toBeGreaterThan(60_000);
    expect(outcome).toEqual({ kind: "running_too_long" });
    expect(runningReports).toBe(1);
  });

  it("distinguishes a handler that never claimed the grant from a long running sync", async () => {
    let now = 0;
    const outcome = await pollBrowserSyncStatus({
      fetchStatus: () => Promise.resolve(new Response(null, { status: 404 })),
      now: () => now,
      onRunning: () => undefined,
      pause: () => {
        now += 30_000;
        return Promise.resolve();
      },
    });
    expect(outcome).toEqual({ kind: "not_started" });
  });

  it("bounds repeated unreadable status responses", async () => {
    let requests = 0;
    const outcome = await pollBrowserSyncStatus({
      fetchStatus: () => {
        requests += 1;
        return Promise.resolve(new Response(null, { status: 503 }));
      },
      now: () => requests * 1_000,
      onRunning: () => undefined,
      pause: () => Promise.resolve(),
    });
    expect(outcome).toEqual({ kind: "unreadable" });
    expect(requests).toBe(3);
  });

  it("backs status polling off after the connector claims the run", async () => {
    const pauses: number[] = [];
    const responses = [
      new Response(null, { status: 404 }),
      Response.json({ status: "running", resultCode: null }),
      Response.json({ status: "succeeded", resultCode: "complete" }),
    ];

    const outcome = await pollBrowserSyncStatus({
      fetchStatus: () => Promise.resolve(responses.shift() ?? new Response(null, { status: 503 })),
      now: () => 0,
      onRunning: () => undefined,
      pause: (milliseconds) => {
        pauses.push(milliseconds);
        return Promise.resolve();
      },
    });

    expect(outcome).toEqual({ kind: "terminal", status: "succeeded", resultCode: "complete" });
    expect(pauses).toEqual([
      browserSyncWaitingPollIntervalMs,
      browserSyncWaitingPollIntervalMs,
      browserSyncRunningPollIntervalMs,
    ]);
    expect(browserSyncRunningPollIntervalMs).toBeGreaterThan(browserSyncWaitingPollIntervalMs);
  });

  it("honors status Retry-After without counting rate limits as polling failures", async () => {
    let now = 0;
    const pauses: number[] = [];
    const responses = [
      new Response(null, { status: 429, headers: { "Retry-After": "17" } }),
      Response.json({ status: "running", resultCode: null }),
      Response.json({ status: "succeeded", resultCode: "complete" }),
    ];

    const outcome = await pollBrowserSyncStatus({
      fetchStatus: () => Promise.resolve(responses.shift() ?? new Response(null, { status: 503 })),
      now: () => now,
      onRunning: () => undefined,
      pause: (milliseconds) => {
        pauses.push(milliseconds);
        now += milliseconds;
        return Promise.resolve();
      },
    });

    expect(outcome).toEqual({ kind: "terminal", status: "succeeded", resultCode: "complete" });
    expect(pauses).toEqual([
      browserSyncWaitingPollIntervalMs,
      17_000,
      browserSyncRunningPollIntervalMs,
    ]);
  });

  it("bounds a persistently rate-limited waiting poller by its start deadline", async () => {
    let now = 0;
    let requests = 0;
    const pauses: number[] = [];
    const outcome = await pollBrowserSyncStatus({
      fetchStatus: () => {
        requests += 1;
        return Promise.resolve(
          new Response(null, { status: 429, headers: { "Retry-After": "60" } }),
        );
      },
      now: () => now,
      onRunning: () => undefined,
      pause: (milliseconds) => {
        pauses.push(milliseconds);
        now += milliseconds;
        return Promise.resolve();
      },
    });

    expect(outcome).toEqual({ kind: "not_started" });
    expect(requests).toBe(3);
    expect(pauses).toEqual([browserSyncWaitingPollIntervalMs, 60_000, 28_000]);
  });

  it("bounds grant retries from Retry-After", () => {
    const now = Date.parse("2026-08-23T12:00:00Z");
    expect(grantRetryAfterMilliseconds("60", now)).toBe(60_000);
    expect(grantRetryAfterMilliseconds("1", now)).toBe(1_000);
    expect(grantRetryAfterMilliseconds("999999", now)).toBe(5 * 60_000);
    expect(grantRetryAfterMilliseconds("invalid", now)).toBe(60_000);
    expect(grantRetryAfterMilliseconds("Sun, 23 Aug 2026 12:00:30 GMT", now)).toBe(30_000);
    expect(statusRetryAfterMilliseconds("60", now)).toBe(60_000);
    expect(statusRetryAfterMilliseconds("999999", now)).toBe(60_000);
    expect(statusRetryAfterMilliseconds("invalid", now)).toBe(5_000);
    expect(component).toContain("setGrantRetryAt");
    expect(component).toContain("grantRetryTimer.current = window.setTimeout");
  });

  it("removes the old divider and lays out both controls together", () => {
    expect(styles).toContain(".account-control-buttons");
    expect(styles).not.toMatch(/\.account-management\s*\{[^}]*border-top/s);
  });
});
