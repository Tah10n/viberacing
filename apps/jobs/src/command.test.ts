import { describe, expect, it, vi } from "vitest";

import {
  JobsCommandError,
  parseJobsCommand,
  runJobsCli,
  type JobsCliDependencies,
} from "./command.js";
import type { ConfiguredJobsMaintenanceRunner } from "./maintenance.js";

const privateDetail = "private command detail must not leak";

function createRunner(): {
  close: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  runner: ConfiguredJobsMaintenanceRunner;
} {
  const execute = vi.fn(() =>
    Promise.resolve({
      kind: "refresh_dirty_leaderboard" as const,
      outcome: "idle" as const,
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

const commandCases = [
  ["ensure-current-season", { kind: "ensure_current_season" }],
  ["refresh-dirty-leaderboard", { kind: "refresh_dirty_leaderboard" }],
  ["finalize-due-season", { kind: "finalize_due_season" }],
  ["reset-expired-pairing-request-windows", { kind: "reset_expired_pairing_request_windows" }],
  ["cleanup-expired-pairing-state", { batchSize: 1_000, kind: "cleanup_expired_pairing_state" }],
  ["cleanup-expired-usage-nonces", { batchSize: 1_000, kind: "cleanup_expired_usage_nonces" }],
  ["cleanup-expired-usage-history", { batchSize: 1_000, kind: "cleanup_expired_usage_history" }],
  ["cleanup-expired-auth-state", { batchSize: 1_000, kind: "cleanup_expired_auth_state" }],
  ["cleanup-aged-revoked-authority", { batchSize: 1_000, kind: "cleanup_aged_revoked_authority" }],
  ["cleanup-snapshot-history", { batchSize: 1_000, kind: "cleanup_snapshot_history" }],
  ["cleanup-expired-ranking-events", { batchSize: 1_000, kind: "cleanup_expired_ranking_events" }],
  ["purge-profile-deletions", { batchSize: 10, kind: "purge_profile_deletions" }],
  ["cleanup-terminal-deletion-jobs", { batchSize: 1_000, kind: "cleanup_terminal_deletion_jobs" }],
] as const;

describe("Jobs command", () => {
  it.each(commandCases)("parses one closed no-argument command", (command, expected) => {
    const result = parseJobsCommand([command]);
    expect(result).toEqual(expected);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    null,
    {},
    [],
    ["refresh-dirty-leaderboard", "unexpected"],
    ["refresh-community-season", "2026-07-13"],
    ["cleanup-expired-ingest-state"],
    ["unknown"],
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
        return "refresh-dirty-leaderboard";
      },
    });
    accessor.length = 1;
    const extended = ["refresh-dirty-leaderboard"];
    Object.defineProperty(extended, "extra", { enumerable: true, value: true });
    const trapped = new Proxy(["refresh-dirty-leaderboard"], {
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

    await expect(runJobsCli(["refresh-dirty-leaderboard"], dependencies)).resolves.toBe(0);
    expect(fixture.execute).toHaveBeenCalledWith({ kind: "refresh_dirty_leaderboard" });
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
  });

  it("uses the default configured factory but fails closed before a connection", async () => {
    const dependencies = outputDependencies({ environment: {} });
    await expect(runJobsCli(["refresh-dirty-leaderboard"], dependencies)).resolves.toBe(1);
    expect(dependencies.errors).toEqual(["Vibe Racing Jobs command failed.\n"]);
  });

  it("uses process.env when no explicit environment is supplied", async () => {
    const fixture = createRunner();
    const runnerFactory = vi.fn(() => fixture.runner);
    const dependencies = outputDependencies({ runnerFactory });

    await runJobsCli(["cleanup-expired-usage-nonces"], dependencies);
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

      await expect(runJobsCli(["refresh-dirty-leaderboard"], dependencies)).resolves.toBe(1);
      expect(dependencies.output).toEqual([]);
      expect(dependencies.errors).toEqual(["Vibe Racing Jobs command failed.\n"]);
      expect(dependencies.errors.join("")).not.toContain(privateDetail);
      expect(fixture.close).toHaveBeenCalledTimes(failurePoint === "factory" ? 0 : 1);
    },
  );

  it("contains output-writer failures and default writer details", async () => {
    const fixture = createRunner();
    const errors: string[] = [];
    await expect(
      runJobsCli(["cleanup-expired-usage-nonces"], {
        runnerFactory: () => fixture.runner,
        stderr: (message) => errors.push(message),
        stdout: () => {
          throw new Error(privateDetail);
        },
      }),
    ).resolves.toBe(1);
    expect(errors).toEqual(["Vibe Racing Jobs command failed.\n"]);

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
      runJobsCli(["cleanup-expired-usage-nonces"], {
        runnerFactory: () => fixture.runner,
      }),
    ).resolves.toBe(0);
    await expect(runJobsCli(["unknown"])).resolves.toBe(1);
    expect(stdout).toHaveBeenCalledWith("Vibe Racing Jobs command completed.\n");
    expect(stderr).toHaveBeenCalledWith("Vibe Racing Jobs command failed.\n");
  });
});
