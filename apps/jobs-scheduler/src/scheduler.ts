import {
  createConfiguredCommunityMaintenanceRunner,
  type ConfiguredCommunityMaintenanceRunner,
} from "@viberacing/jobs";

import { resolveJobsSchedulerConfig, type JobsSchedulerConfig } from "./config.js";
import { createMaintenanceSchedule, type MaintenanceSchedule } from "./schedule.js";

const configKeys = new Set(["enabled", "pollIntervalMs"]);
const dependencyKeys = new Set([
  "clearInterval",
  "createRunner",
  "createSchedule",
  "now",
  "setInterval",
  "signalSink",
]);
const runnerKeys = new Set(["close", "execute"]);
const scheduleKeys = new Set(["due"]);
const maximumDueJobs = 18;

export const jobsSchedulerShutdownDeadlineMs = 35_000;

export type JobsSchedulerSignal = "cycle_failed";
export type JobsSchedulerSignalSink = (signal: JobsSchedulerSignal) => void;

export type JobsSchedulerErrorCode =
  | "configuration_invalid"
  | "dependencies_invalid"
  | "runner_invalid"
  | "schedule_invalid"
  | "start_failed"
  | "shutdown_failed";

export class JobsSchedulerError extends Error {
  readonly code: JobsSchedulerErrorCode;

  constructor(code: JobsSchedulerErrorCode) {
    super("Jobs scheduler failed closed.");
    this.name = "JobsSchedulerError";
    this.code = code;
  }
}

export interface JobsSchedulerController {
  close(): Promise<void>;
}

export interface JobsSchedulerDependencies {
  readonly clearInterval: (token: unknown) => void;
  readonly createRunner: () => unknown;
  readonly createSchedule: () => unknown;
  readonly now: () => number;
  readonly setInterval: (handler: () => void, milliseconds: number) => unknown;
  readonly signalSink: JobsSchedulerSignalSink;
}

interface ValidatedRunner {
  close(): Promise<void>;
  execute(job: unknown): Promise<unknown>;
}

interface ValidatedSchedule {
  due(nowEpochMs: unknown): unknown;
}

function fail(code: JobsSchedulerErrorCode): never {
  throw new JobsSchedulerError(code);
}

function isPlainRecord(value: unknown): value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: object, expected: ReadonlySet<string>): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.size &&
    keys.every((key) => typeof key === "string" && expected.has(key))
  );
}

function isTimerToken(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

function ownDataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor && descriptor.enumerable
    ? (descriptor.value as unknown)
    : undefined;
}

function readConfig(value: unknown): JobsSchedulerConfig {
  try {
    if (!isPlainRecord(value) || !Object.isFrozen(value) || !hasExactKeys(value, configKeys)) {
      fail("configuration_invalid");
    }
    const enabled = ownDataValue(value, "enabled");
    const pollIntervalMs = ownDataValue(value, "pollIntervalMs");
    if (enabled !== true || pollIntervalMs !== 60_000) {
      fail("configuration_invalid");
    }
    return Object.freeze({ enabled, pollIntervalMs });
  } catch (error) {
    if (error instanceof JobsSchedulerError) {
      throw error;
    }
    fail("configuration_invalid");
  }
}

function readDependencies(value: unknown): JobsSchedulerDependencies {
  try {
    if (!isPlainRecord(value) || !Object.isFrozen(value) || !hasExactKeys(value, dependencyKeys)) {
      fail("dependencies_invalid");
    }
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of dependencyKeys) {
      const dependency = ownDataValue(value, key);
      if (typeof dependency !== "function") {
        fail("dependencies_invalid");
      }
      result[key] = dependency;
    }
    return Object.freeze(result) as unknown as JobsSchedulerDependencies;
  } catch (error) {
    if (error instanceof JobsSchedulerError) {
      throw error;
    }
    fail("dependencies_invalid");
  }
}

function readRunner(value: unknown): ValidatedRunner {
  try {
    if (!isPlainRecord(value) || !Object.isFrozen(value) || !hasExactKeys(value, runnerKeys)) {
      fail("runner_invalid");
    }
    const close = ownDataValue(value, "close");
    const execute = ownDataValue(value, "execute");
    if (typeof close !== "function" || typeof execute !== "function") {
      fail("runner_invalid");
    }
    return Object.freeze({
      close: close as ValidatedRunner["close"],
      execute: execute as ValidatedRunner["execute"],
    });
  } catch (error) {
    if (error instanceof JobsSchedulerError) {
      throw error;
    }
    fail("runner_invalid");
  }
}

function readSchedule(value: unknown): ValidatedSchedule {
  try {
    if (!isPlainRecord(value) || !Object.isFrozen(value) || !hasExactKeys(value, scheduleKeys)) {
      fail("schedule_invalid");
    }
    const due = ownDataValue(value, "due");
    if (typeof due !== "function") {
      fail("schedule_invalid");
    }
    return Object.freeze({ due: due as ValidatedSchedule["due"] });
  } catch (error) {
    if (error instanceof JobsSchedulerError) {
      throw error;
    }
    fail("schedule_invalid");
  }
}

function readDueJobs(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || !Object.isFrozen(value) || value.length > maximumDueJobs) {
    fail("schedule_invalid");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1 ||
    keys.some(
      (key) =>
        key !== "length" &&
        (typeof key !== "string" ||
          !/^(?:0|[1-9][0-9]*)$/.test(key) ||
          Number(key) >= value.length),
    )
  ) {
    fail("schedule_invalid");
  }
  const jobs: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      fail("schedule_invalid");
    }
    jobs.push(descriptor.value);
  }
  return Object.freeze(jobs);
}

async function closeAfterFailure(runner: ValidatedRunner): Promise<void> {
  try {
    await runner.close();
  } catch {
    return;
  }
}

export async function startJobsScheduler(
  rawConfig: unknown,
  rawDependencies: unknown,
): Promise<JobsSchedulerController> {
  const config = readConfig(rawConfig);
  const dependencies = readDependencies(rawDependencies);

  let rawRunner: unknown;
  try {
    rawRunner = dependencies.createRunner();
  } catch {
    fail("start_failed");
  }
  const runner = readRunner(rawRunner);

  let schedule: ValidatedSchedule;
  try {
    schedule = readSchedule(dependencies.createSchedule());
  } catch {
    await closeAfterFailure(runner);
    fail("start_failed");
  }

  let closing = false;
  let activeCycle: Promise<void> | undefined;

  const signalFailure = (): void => {
    try {
      dependencies.signalSink("cycle_failed");
    } catch {
      return;
    }
  };

  const runCycle = async (): Promise<void> => {
    let jobs: readonly unknown[];
    try {
      jobs = readDueJobs(schedule.due(dependencies.now()));
    } catch {
      signalFailure();
      return;
    }

    let failed = false;
    for (const job of jobs) {
      if (closing) {
        break;
      }
      try {
        await runner.execute(job);
      } catch {
        failed = true;
      }
    }
    if (failed) {
      signalFailure();
    }
  };

  const triggerCycle = (): void => {
    if (closing || activeCycle !== undefined) {
      return;
    }
    const cycle = runCycle();
    activeCycle = cycle.finally(() => {
      activeCycle = undefined;
    });
  };

  let intervalReady = false;
  const intervalHandler = (): void => {
    if (intervalReady) {
      triggerCycle();
    }
  };

  let intervalToken: unknown;
  try {
    intervalToken = dependencies.setInterval(intervalHandler, config.pollIntervalMs);
    if (!isTimerToken(intervalToken)) {
      throw new JobsSchedulerError("start_failed");
    }
  } catch {
    await closeAfterFailure(runner);
    fail("start_failed");
  }

  intervalReady = true;
  triggerCycle();

  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    close(): Promise<void> {
      closePromise ??= (async () => {
        closing = true;
        let failed = false;
        try {
          dependencies.clearInterval(intervalToken);
        } catch {
          failed = true;
        }
        await activeCycle;
        try {
          await runner.close();
        } catch {
          failed = true;
        }
        if (failed) {
          fail("shutdown_failed");
        }
      })();
      return closePromise;
    },
  });
}

export async function startConfiguredJobsScheduler(
  environment?: Readonly<Record<string, string | undefined>>,
  signalSink: JobsSchedulerSignalSink = () => undefined,
): Promise<JobsSchedulerController> {
  const config = resolveJobsSchedulerConfig(environment);
  return startJobsScheduler(
    config,
    Object.freeze({
      clearInterval: (token: unknown) => {
        clearInterval(token as NodeJS.Timeout);
      },
      createRunner: (): ConfiguredCommunityMaintenanceRunner =>
        createConfiguredCommunityMaintenanceRunner(environment),
      createSchedule: (): MaintenanceSchedule => createMaintenanceSchedule(),
      now: Date.now,
      setInterval: (handler: () => void, milliseconds: number) =>
        setInterval(handler, milliseconds),
      signalSink,
    }),
  );
}
