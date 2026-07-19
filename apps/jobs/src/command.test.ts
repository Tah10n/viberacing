import { describe, expect, it, vi } from "vitest";

import {
  JobsCommandError,
  parseJobsCommand,
  runJobsCli,
  type JobsCliDependencies,
} from "./command.js";
import type { ConfiguredCommunityMaintenanceRunner } from "./community-maintenance.js";

const privateDetail = "private command detail must not leak";

function createRunner(): {
  close: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  runner: ConfiguredCommunityMaintenanceRunner;
} {
  const execute = vi.fn(() =>
    Promise.resolve({
      kind: "refresh_community_season" as const,
      profileCount: 1,
    }),
  );
  const close = vi.fn(() => Promise.resolve());
  return { close, execute, runner: { close, execute } };
}

function outputDependencies(
  overrides: Partial<JobsCliDependencies> = {},
): JobsCliDependencies & { errors: string[]; output: string[] } {
  const errors: string[] = [];
  const output: string[] = [];
  return {
    errors,
    output,
    stderr: (message) => errors.push(message),
    stdout: (message) => output.push(message),
    ...overrides,
  };
}

describe("Jobs command", () => {
  it.each([
    [["cleanup-aged-revoked-devices"], { batchSize: 1_000, kind: "cleanup_aged_revoked_devices" }],
    [
      ["cleanup-aged-revoked-passkeys"],
      { batchSize: 1_000, kind: "cleanup_aged_revoked_passkeys" },
    ],
    [["cleanup-expired-auth-state"], { batchSize: 1_000, kind: "cleanup_expired_auth_state" }],
    [["cleanup-expired-audit-events"], { batchSize: 1_000, kind: "cleanup_expired_audit_events" }],
    [
      ["cleanup-expired-car-recipe-proposals"],
      { batchSize: 1_000, kind: "cleanup_expired_car_recipe_proposals" },
    ],
    [["cleanup-expired-invites"], { batchSize: 1_000, kind: "cleanup_expired_invites" }],
    [["cleanup-expired-ingest-state"], { batchSize: 1_000, kind: "cleanup_expired_ingest_state" }],
    [
      ["cleanup-expired-pairing-state"],
      { batchSize: 1_000, kind: "cleanup_expired_pairing_state" },
    ],
    [["cleanup-expired-sessions"], { batchSize: 1_000, kind: "cleanup_expired_sessions" }],
    [
      ["cleanup-terminal-deletion-jobs"],
      { batchSize: 1_000, kind: "cleanup_terminal_deletion_jobs" },
    ],
    [["purge-profile-deletions"], { batchSize: 10, kind: "purge_profile_deletions" }],
    [
      ["redact-aged-pairing-approval-provenance"],
      { batchSize: 1_000, kind: "redact_aged_pairing_approval_provenance" },
    ],
    [
      ["refresh-community-season", "2026-07-13"],
      { kind: "refresh_community_season", seasonStart: "2026-07-13" },
    ],
    [
      ["finalize-community-season", "2099-12-28"],
      { kind: "finalize_community_season", seasonStart: "2099-12-28" },
    ],
  ] as const)("parses one closed command", (argumentsValue, expected) => {
    const result = parseJobsCommand([...argumentsValue]);
    expect(result).toEqual(expected);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    null,
    {},
    [],
    ["cleanup-aged-revoked-devices", "unexpected"],
    ["cleanup-aged-revoked-passkeys", "unexpected"],
    ["cleanup-expired-auth-state", "unexpected"],
    ["cleanup-expired-audit-events", "unexpected"],
    ["cleanup-expired-car-recipe-proposals", "unexpected"],
    ["cleanup-expired-invites", "unexpected"],
    ["cleanup-expired-ingest-state", "unexpected"],
    ["cleanup-expired-pairing-state", "unexpected"],
    ["cleanup-expired-sessions", "unexpected"],
    ["cleanup-terminal-deletion-jobs", "unexpected"],
    ["purge-profile-deletions", "unexpected"],
    ["redact-aged-pairing-approval-provenance", "unexpected"],
    ["refresh-community-season", "2026-07-13", "unexpected"],
    ["refresh-community-season"],
    ["refresh-community-season", "2026-07-14"],
    ["refresh-community-season", "2026-02-30"],
    ["refresh-community-season", "1999-12-20"],
    ["finalize-community-season", "2100-01-04"],
    ["unknown", "2026-07-13"],
    [1],
  ])("rejects invalid CLI arguments", (argumentsValue) => {
    expect(() => parseJobsCommand(argumentsValue)).toThrow(
      expect.objectContaining({
        code: "invalid_arguments",
        message: "Jobs command arguments are invalid.",
        name: "JobsCommandError",
      }),
    );
  });

  it("rejects sparse, accessor-backed, extended, and trapped arrays", () => {
    const sparse = new Array(1);
    let getterCalls = 0;
    const accessor: unknown[] = [];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "cleanup-expired-ingest-state";
      },
    });
    accessor.length = 1;
    const extended = ["cleanup-expired-ingest-state"];
    Object.defineProperty(extended, "extra", { enumerable: true, value: true });
    const trapped = new Proxy(["cleanup-expired-ingest-state"], {
      ownKeys() {
        throw new Error(privateDetail);
      },
    });

    for (const argumentsValue of [sparse, accessor, extended, trapped]) {
      expect(() => parseJobsCommand(argumentsValue)).toThrow(JobsCommandError);
    }
    expect(getterCalls).toBe(0);
  });

  it("executes, closes, and emits only a stable completion message", async () => {
    const fixture = createRunner();
    const environment = Object.freeze({ NODE_ENV: "test" });
    const dependencies = outputDependencies({
      environment,
      runnerFactory: (receivedEnvironment) => {
        expect(receivedEnvironment).toBe(environment);
        return fixture.runner;
      },
    });

    await expect(
      runJobsCli(["refresh-community-season", "2026-07-13"], dependencies),
    ).resolves.toBe(0);
    expect(fixture.execute).toHaveBeenCalledWith({
      kind: "refresh_community_season",
      seasonStart: "2026-07-13",
    });
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(dependencies.output).toEqual(["Vibe Racing Jobs command completed.\n"]);
    expect(dependencies.errors).toEqual([]);
  });

  it("rejects arguments before reading configuration or creating a runner", async () => {
    const runnerFactory = vi.fn(() => createRunner().runner);
    const dependencies = outputDependencies({ runnerFactory });

    await expect(runJobsCli(["unknown"], dependencies)).resolves.toBe(1);
    expect(runnerFactory).not.toHaveBeenCalled();
    expect(dependencies.errors).toEqual(["Vibe Racing Jobs command failed.\n"]);
    expect(dependencies.errors.join("")).not.toContain(privateDetail);
  });

  it("uses the default configured factory but fails closed before a connection", async () => {
    const dependencies = outputDependencies({ environment: {} });
    await expect(
      runJobsCli(["refresh-community-season", "2026-07-13"], dependencies),
    ).resolves.toBe(1);
    expect(dependencies.errors).toEqual(["Vibe Racing Jobs command failed.\n"]);
  });

  it("uses process.env when no explicit environment is supplied", async () => {
    const fixture = createRunner();
    const runnerFactory = vi.fn(() => fixture.runner);
    const dependencies = outputDependencies({ runnerFactory });

    await runJobsCli(["cleanup-expired-ingest-state"], dependencies);
    expect(runnerFactory).toHaveBeenCalledWith(process.env);
  });

  it.each(["factory", "execute", "close"] as const)(
    "contains a private %s failure and still closes an acquired runner",
    async (failurePoint) => {
      const fixture = createRunner();
      if (failurePoint === "execute") {
        fixture.execute.mockRejectedValueOnce(new Error(privateDetail));
      }
      if (failurePoint === "close") {
        fixture.close.mockRejectedValueOnce(new Error(privateDetail));
      }
      const dependencies = outputDependencies({
        runnerFactory: () => {
          if (failurePoint === "factory") {
            throw new Error(privateDetail);
          }
          return fixture.runner;
        },
      });

      await expect(
        runJobsCli(["refresh-community-season", "2026-07-13"], dependencies),
      ).resolves.toBe(1);
      expect(dependencies.output).toEqual([]);
      expect(dependencies.errors).toEqual(["Vibe Racing Jobs command failed.\n"]);
      expect(dependencies.errors.join("")).not.toContain(privateDetail);
      expect(fixture.close).toHaveBeenCalledTimes(failurePoint === "factory" ? 0 : 1);
    },
  );

  it("converts a completion writer failure to a stable failure", async () => {
    const fixture = createRunner();
    const errors: string[] = [];
    const code = await runJobsCli(["cleanup-expired-ingest-state"], {
      runnerFactory: () => fixture.runner,
      stderr: (message) => errors.push(message),
      stdout: () => {
        throw new Error(privateDetail);
      },
    });

    expect(code).toBe(1);
    expect(errors).toEqual(["Vibe Racing Jobs command failed.\n"]);
  });

  it("contains a failure writer exception", async () => {
    await expect(
      runJobsCli(["unknown"], {
        stderr: () => {
          throw new Error(privateDetail);
        },
      }),
    ).resolves.toBe(1);
  });

  it("uses the default stdout and stderr writers without exposing details", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fixture = createRunner();

    await expect(
      runJobsCli(["cleanup-expired-ingest-state"], {
        runnerFactory: () => fixture.runner,
      }),
    ).resolves.toBe(0);
    await expect(runJobsCli(["unknown"])).resolves.toBe(1);
    expect(stdout).toHaveBeenCalledWith("Vibe Racing Jobs command completed.\n");
    expect(stderr).toHaveBeenCalledWith("Vibe Racing Jobs command failed.\n");
  });
});
