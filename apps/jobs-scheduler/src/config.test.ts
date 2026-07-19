import { afterEach, describe, expect, it, vi } from "vitest";

import {
  JobsSchedulerConfigurationError,
  jobsSchedulerPollIntervalMs,
  resolveJobsSchedulerConfig,
} from "./config.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveJobsSchedulerConfig", () => {
  it("accepts only the exact enable latch and returns a frozen fixed interval", () => {
    const reads: PropertyKey[] = [];
    const environment = new Proxy(
      { VIBERACING_JOBS_SCHEDULER_ENABLED: "true" },
      {
        get(target, key, receiver) {
          reads.push(key);
          return Reflect.get(target, key, receiver) as unknown;
        },
      },
    );

    const config = resolveJobsSchedulerConfig(environment);

    expect(config).toEqual({ enabled: true, pollIntervalMs: jobsSchedulerPollIntervalMs });
    expect(Object.isFrozen(config)).toBe(true);
    expect(reads).toEqual(["VIBERACING_JOBS_SCHEDULER_ENABLED"]);
  });

  it.each([undefined, "", "false", "TRUE", "1"])("rejects the non-enabled value %#", (value) => {
    expect(() => resolveJobsSchedulerConfig({ VIBERACING_JOBS_SCHEDULER_ENABLED: value })).toThrow(
      expect.objectContaining({
        code: "disabled",
        message: "Jobs scheduler configuration failed closed.",
      }),
    );
  });

  it("contains a hostile environment getter", () => {
    const environment = new Proxy(Object.freeze({}), {
      get() {
        throw new Error("private-environment-value");
      },
    });

    expect(() => resolveJobsSchedulerConfig(environment)).toThrow(JobsSchedulerConfigurationError);
  });

  it("uses process environment only when no explicit record is supplied", () => {
    vi.stubEnv("VIBERACING_JOBS_SCHEDULER_ENABLED", "true");

    expect(resolveJobsSchedulerConfig()).toEqual({
      enabled: true,
      pollIntervalMs: 60_000,
    });
  });
});
