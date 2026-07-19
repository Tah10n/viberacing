import { createConfiguredCommunityMaintenanceRunner } from "@viberacing/jobs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jobsSchedulerPollIntervalMs } from "./config.js";
import {
  JobsSchedulerError,
  startConfiguredJobsScheduler,
  startJobsScheduler,
  type JobsSchedulerDependencies,
} from "./scheduler.js";

vi.mock("@viberacing/jobs", () => ({
  createConfiguredCommunityMaintenanceRunner: vi.fn(),
  maximumCleanupBatchSize: 1_000,
  maximumProfileDeletionPurgeBatchSize: 10,
}));

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T) => void;
}

interface SchedulerFixture {
  readonly clearInterval: ReturnType<typeof vi.fn>;
  readonly dependencies: JobsSchedulerDependencies;
  readonly due: ReturnType<typeof vi.fn>;
  readonly execute: ReturnType<typeof vi.fn>;
  readonly handler: () => void;
  readonly runnerClose: ReturnType<typeof vi.fn>;
  readonly signalSink: ReturnType<typeof vi.fn>;
}

const config = Object.freeze({ enabled: true as const, pollIntervalMs: 60_000 as const });
const firstJob = Object.freeze({ kind: "reset_expired_pairing_request_windows" });
const secondJob = Object.freeze({
  batchSize: 1_000,
  kind: "cleanup_expired_auth_state",
});

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 24; index += 1) {
    await Promise.resolve();
  }
}

function createFixture(
  jobs: unknown = Object.freeze([firstJob]),
  execute: ReturnType<typeof vi.fn> = vi.fn(async () => Object.freeze({})),
): SchedulerFixture {
  let handler = (): void => undefined;
  const due = vi.fn(() => jobs);
  const runnerClose = vi.fn(async () => undefined);
  const signalSink = vi.fn();
  const clearInterval = vi.fn();
  const dependencies = Object.freeze({
    clearInterval,
    createRunner: () => Object.freeze({ close: runnerClose, execute }),
    createSchedule: () => Object.freeze({ due }),
    now: () => Date.parse("2026-07-15T12:00:00.000Z"),
    setInterval: (callback: () => void, milliseconds: number) => {
      expect(milliseconds).toBe(jobsSchedulerPollIntervalMs);
      handler = callback;
      return Object.freeze({ timer: true });
    },
    signalSink,
  }) satisfies JobsSchedulerDependencies;
  return {
    clearInterval,
    dependencies,
    due,
    execute,
    get handler() {
      return handler;
    },
    runnerClose,
    signalSink,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("startJobsScheduler", () => {
  it("runs the initial fixed cycle and closes the one runner idempotently", async () => {
    const fixture = createFixture(Object.freeze([firstJob, secondJob]));
    const controller = await startJobsScheduler(config, fixture.dependencies);
    await flush();

    expect(fixture.due).toHaveBeenCalledOnce();
    expect(fixture.execute).toHaveBeenNthCalledWith(1, firstJob);
    expect(fixture.execute).toHaveBeenNthCalledWith(2, secondJob);

    const firstClose = controller.close();
    const secondClose = controller.close();
    expect(firstClose).toBe(secondClose);
    await firstClose;

    expect(fixture.clearInterval).toHaveBeenCalledOnce();
    expect(fixture.runnerClose).toHaveBeenCalledOnce();
  });

  it("accepts a frozen null-prototype dependency record", async () => {
    const fixture = createFixture();
    const dependencies = Object.freeze(
      Object.assign(Object.create(null) as Record<string, unknown>, fixture.dependencies),
    );

    const controller = await startJobsScheduler(config, dependencies);
    await flush();
    await controller.close();

    expect(fixture.execute).toHaveBeenCalledOnce();
  });

  it("never overlaps cycles", async () => {
    const held = deferred<unknown>();
    const execute = vi.fn(() => held.promise);
    const fixture = createFixture(Object.freeze([firstJob, secondJob]), execute);
    const controller = await startJobsScheduler(config, fixture.dependencies);

    fixture.handler();
    fixture.handler();
    expect(fixture.due).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();

    held.resolve(Object.freeze({}));
    await flush();
    expect(execute).toHaveBeenCalledTimes(2);

    fixture.handler();
    await flush();
    expect(fixture.due).toHaveBeenCalledTimes(2);
    await controller.close();
  });

  it("starts no later capability after shutdown begins", async () => {
    const held = deferred<unknown>();
    const execute = vi.fn(() => held.promise);
    const fixture = createFixture(Object.freeze([firstJob, secondJob]), execute);
    const controller = await startJobsScheduler(config, fixture.dependencies);

    const closing = controller.close();
    fixture.handler();
    held.resolve(Object.freeze({}));
    await closing;

    expect(execute).toHaveBeenCalledOnce();
    expect(fixture.due).toHaveBeenCalledOnce();
    expect(fixture.runnerClose).toHaveBeenCalledOnce();
  });

  it("contains one failed job, continues the fixed cycle, and emits one closed signal", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("private-query-value"))
      .mockResolvedValueOnce(Object.freeze({}));
    const fixture = createFixture(Object.freeze([firstJob, secondJob]), execute);
    const controller = await startJobsScheduler(config, fixture.dependencies);
    await flush();

    expect(execute).toHaveBeenCalledTimes(2);
    expect(fixture.signalSink).toHaveBeenCalledExactlyOnceWith("cycle_failed");
    await controller.close();
  });

  it("contains schedule failures and a throwing signal sink", async () => {
    const fixture = createFixture();
    fixture.due.mockImplementation(() => {
      throw new Error("private-clock-value");
    });
    fixture.signalSink.mockImplementation(() => {
      throw new Error("private-signal-value");
    });
    const controller = await startJobsScheduler(config, fixture.dependencies);
    await flush();

    expect(fixture.signalSink).toHaveBeenCalledExactlyOnceWith("cycle_failed");
    expect(fixture.execute).not.toHaveBeenCalled();
    await controller.close();
  });

  it.each([
    Object.freeze({}),
    Object.freeze(Array.from({ length: 18 }, () => firstJob)),
    [firstJob],
    Object.freeze(Object.assign([firstJob], { extra: true })),
    Object.freeze(new Array(1)),
  ])("rejects an invalid due-job collection %# without calling the runner", async (jobs) => {
    const fixture = createFixture(jobs);
    const controller = await startJobsScheduler(config, fixture.dependencies);
    await flush();

    expect(fixture.signalSink).toHaveBeenCalledExactlyOnceWith("cycle_failed");
    expect(fixture.execute).not.toHaveBeenCalled();
    await controller.close();
  });

  it("rejects an accessor-backed due entry", async () => {
    const jobs: unknown[] = [];
    Object.defineProperty(jobs, "0", { enumerable: true, get: () => firstJob });
    Object.freeze(jobs);
    const fixture = createFixture(jobs);
    const controller = await startJobsScheduler(config, fixture.dependencies);
    await flush();

    expect(fixture.signalSink).toHaveBeenCalledExactlyOnceWith("cycle_failed");
    expect(fixture.execute).not.toHaveBeenCalled();
    await controller.close();
  });

  it("reports shutdown failure after still attempting both timer and runner cleanup", async () => {
    const fixture = createFixture();
    fixture.clearInterval.mockImplementation(() => {
      throw new Error("private-timer-value");
    });
    fixture.runnerClose.mockRejectedValue(new Error("private-close-value"));
    const controller = await startJobsScheduler(config, fixture.dependencies);
    await flush();

    await expect(controller.close()).rejects.toMatchObject({ code: "shutdown_failed" });
    expect(fixture.runnerClose).toHaveBeenCalledOnce();
  });

  it.each([
    null,
    [],
    {},
    Object.freeze({ enabled: false, pollIntervalMs: 60_000 }),
    Object.freeze({ enabled: true, pollIntervalMs: 1 }),
    Object.freeze({ enabled: true, pollIntervalMs: 60_000, extra: true }),
  ])("rejects invalid scheduler config %#", async (value) => {
    const fixture = createFixture();
    await expect(startJobsScheduler(value, fixture.dependencies)).rejects.toMatchObject({
      code: "configuration_invalid",
    });
  });

  it("contains hostile config traps", async () => {
    const fixture = createFixture();
    const value = new Proxy(Object.freeze({}), {
      ownKeys() {
        throw new Error("private-config-value");
      },
    });

    await expect(startJobsScheduler(value, fixture.dependencies)).rejects.toBeInstanceOf(
      JobsSchedulerError,
    );
  });

  it.each([
    null,
    [],
    {},
    Object.freeze({}),
    Object.freeze({
      clearInterval: true,
      createRunner: () => Object.freeze({}),
      createSchedule: () => Object.freeze({}),
      now: () => Date.parse("2026-07-15T12:00:00.000Z"),
      setInterval: () => Object.freeze({}),
      signalSink: () => undefined,
    }),
  ])("rejects invalid scheduler dependencies %#", async (value) => {
    await expect(startJobsScheduler(config, value)).rejects.toMatchObject({
      code: "dependencies_invalid",
    });
  });

  it("rejects accessor-backed and hostile dependencies without invoking accessors", async () => {
    const fixture = createFixture();
    const accessorRecord = { ...fixture.dependencies } as Record<string, unknown>;
    const accessor = vi.fn(() => fixture.dependencies.createRunner);
    Object.defineProperty(accessorRecord, "createRunner", { enumerable: true, get: accessor });
    Object.freeze(accessorRecord);
    await expect(startJobsScheduler(config, accessorRecord)).rejects.toMatchObject({
      code: "dependencies_invalid",
    });
    expect(accessor).not.toHaveBeenCalled();

    const hostile = new Proxy(Object.freeze({}), {
      getPrototypeOf() {
        throw new Error("private-dependencies-value");
      },
    });
    await expect(startJobsScheduler(config, hostile)).rejects.toBeInstanceOf(JobsSchedulerError);
  });

  it.each([
    null,
    [],
    {},
    Object.freeze({ close: async () => undefined, execute: true }),
    Object.freeze({ close: async () => undefined, execute: async () => undefined, extra: true }),
  ])("rejects an invalid runner %#", async (runner) => {
    const fixture = createFixture();
    const dependencies = Object.freeze({ ...fixture.dependencies, createRunner: () => runner });
    await expect(startJobsScheduler(config, dependencies)).rejects.toMatchObject({
      code: "runner_invalid",
    });
  });

  it("contains hostile runner traps and runner-factory failure", async () => {
    const fixture = createFixture();
    const hostile = new Proxy(Object.freeze({}), {
      ownKeys() {
        throw new Error("private-runner-value");
      },
    });
    await expect(
      startJobsScheduler(
        config,
        Object.freeze({ ...fixture.dependencies, createRunner: () => hostile }),
      ),
    ).rejects.toBeInstanceOf(JobsSchedulerError);

    await expect(
      startJobsScheduler(
        config,
        Object.freeze({
          ...fixture.dependencies,
          createRunner: () => {
            throw new Error("private-factory-value");
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "start_failed" });
  });

  it.each([
    null,
    [],
    {},
    Object.freeze({ due: true }),
    Object.freeze({ due: () => Object.freeze([]), extra: true }),
  ])("closes the runner when the schedule is invalid %#", async (schedule) => {
    const fixture = createFixture();
    const dependencies = Object.freeze({
      ...fixture.dependencies,
      createSchedule: () => schedule,
    });
    await expect(startJobsScheduler(config, dependencies)).rejects.toMatchObject({
      code: "start_failed",
    });
    expect(fixture.runnerClose).toHaveBeenCalledOnce();
  });

  it("contains hostile schedule traps and schedule-factory failure", async () => {
    const fixture = createFixture();
    const hostile = new Proxy(Object.freeze({}), {
      getPrototypeOf() {
        throw new Error("private-schedule-value");
      },
    });
    for (const createSchedule of [
      () => hostile,
      () => {
        throw new Error("private-schedule-factory-value");
      },
    ]) {
      await expect(
        startJobsScheduler(config, Object.freeze({ ...fixture.dependencies, createSchedule })),
      ).rejects.toMatchObject({ code: "start_failed" });
    }
  });

  it("closes after interval setup throws or returns no token", async () => {
    for (const setInterval of [
      () => {
        throw new Error("private-interval-value");
      },
      (handler: () => void) => {
        handler();
        return undefined;
      },
      () => undefined,
      () => null,
      () => 0,
    ]) {
      const fixture = createFixture();
      await expect(
        startJobsScheduler(config, Object.freeze({ ...fixture.dependencies, setInterval })),
      ).rejects.toMatchObject({ code: "start_failed" });
      expect(fixture.runnerClose).toHaveBeenCalledOnce();
      expect(fixture.execute).not.toHaveBeenCalled();
    }
  });

  it("keeps startup failure generic when partial cleanup also fails", async () => {
    const fixture = createFixture();
    fixture.runnerClose.mockRejectedValue(new Error("private-close-value"));
    await expect(
      startJobsScheduler(
        config,
        Object.freeze({ ...fixture.dependencies, setInterval: () => undefined }),
      ),
    ).rejects.toMatchObject({ code: "start_failed" });
  });
});

describe("startConfiguredJobsScheduler", () => {
  it("rejects a disabled scheduler before constructing the Jobs runner", async () => {
    const reads: PropertyKey[] = [];
    const environment = new Proxy(
      { VIBERACING_JOBS_SCHEDULER_ENABLED: "false" },
      {
        get(target, key, receiver) {
          reads.push(key);
          return Reflect.get(target, key, receiver) as unknown;
        },
      },
    );

    await expect(startConfiguredJobsScheduler(environment)).rejects.toMatchObject({
      code: "disabled",
    });

    expect(reads).toEqual(["VIBERACING_JOBS_SCHEDULER_ENABLED"]);
    expect(createConfiguredCommunityMaintenanceRunner).not.toHaveBeenCalled();
  });

  it("composes the reviewed Jobs runner, UTC schedule, and platform timer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("private-query-value"))
      .mockResolvedValue(Object.freeze({}));
    const close = vi.fn(async () => undefined);
    vi.mocked(createConfiguredCommunityMaintenanceRunner).mockReturnValue(
      Object.freeze({ close, execute }),
    );
    const environment = Object.freeze({ VIBERACING_JOBS_SCHEDULER_ENABLED: "true" });

    const controller = await startConfiguredJobsScheduler(environment);
    await flush();

    expect(createConfiguredCommunityMaintenanceRunner).toHaveBeenCalledExactlyOnceWith(environment);
    expect(execute).toHaveBeenCalledTimes(17);
    await controller.close();
    expect(close).toHaveBeenCalledOnce();
  });
});
