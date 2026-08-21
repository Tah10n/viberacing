import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { browserSyncRunningTimeoutMs, pollBrowserSyncStatus } from "./account-controls";

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

  it("removes the old divider and lays out both controls together", () => {
    expect(styles).toContain(".account-control-buttons");
    expect(styles).not.toMatch(/\.account-management\s*\{[^}]*border-top/s);
  });
});
