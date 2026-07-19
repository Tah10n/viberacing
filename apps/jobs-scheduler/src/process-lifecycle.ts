import { jobsSchedulerShutdownDeadlineMs, type JobsSchedulerController } from "./scheduler.js";

const dependencyKeys = new Set([
  "clearTimer",
  "forceExit",
  "onSignal",
  "removeSignal",
  "setExitCode",
  "setTimer",
  "start",
]);
const controllerKeys = new Set(["close"]);
const signals = ["SIGINT", "SIGTERM"] as const;

export type JobsSchedulerProcessSignal = (typeof signals)[number];
export type JobsSchedulerProcessSignalHandler = () => void;

export type JobsSchedulerProcessErrorCode = "controller_invalid" | "dependencies_invalid";

export class JobsSchedulerProcessError extends Error {
  readonly code: JobsSchedulerProcessErrorCode;

  constructor(code: JobsSchedulerProcessErrorCode) {
    super("Jobs scheduler process lifecycle failed closed.");
    this.name = "JobsSchedulerProcessError";
    this.code = code;
  }
}

export interface JobsSchedulerProcessDependencies {
  readonly clearTimer: (token: unknown) => void;
  readonly forceExit: (code: 1) => void;
  readonly onSignal: (
    signal: JobsSchedulerProcessSignal,
    handler: JobsSchedulerProcessSignalHandler,
  ) => void;
  readonly removeSignal: (
    signal: JobsSchedulerProcessSignal,
    handler: JobsSchedulerProcessSignalHandler,
  ) => void;
  readonly setExitCode: (code: 0 | 1) => void;
  readonly setTimer: (handler: () => void, milliseconds: number) => unknown;
  readonly start: () => Promise<unknown>;
}

function fail(code: JobsSchedulerProcessErrorCode): never {
  throw new JobsSchedulerProcessError(code);
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

function readDependencies(value: unknown): JobsSchedulerProcessDependencies {
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
    return Object.freeze(result) as unknown as JobsSchedulerProcessDependencies;
  } catch (error) {
    if (error instanceof JobsSchedulerProcessError) {
      throw error;
    }
    fail("dependencies_invalid");
  }
}

function readController(value: unknown): JobsSchedulerController {
  try {
    if (!isPlainRecord(value) || !Object.isFrozen(value) || !hasExactKeys(value, controllerKeys)) {
      fail("controller_invalid");
    }
    const close = ownDataValue(value, "close");
    if (typeof close !== "function") {
      fail("controller_invalid");
    }
    return Object.freeze({ close: close as JobsSchedulerController["close"] });
  } catch (error) {
    if (error instanceof JobsSchedulerProcessError) {
      throw error;
    }
    fail("controller_invalid");
  }
}

export async function runJobsSchedulerProcess(rawDependencies: unknown): Promise<void> {
  const dependencies = readDependencies(rawDependencies);
  let resolveController!: (controller: JobsSchedulerController) => void;
  let rejectController!: (error: unknown) => void;
  const controllerPromise = new Promise<JobsSchedulerController>((resolve, reject) => {
    resolveController = resolve;
    rejectController = reject;
  });
  void controllerPromise.catch(() => undefined);
  let shutdownStarted = false;
  let terminal = false;
  let timerToken: unknown;

  const hasTerminated = (): boolean => terminal;

  const removeHandlers = (): boolean => {
    let failed = false;
    for (const signal of signals) {
      try {
        dependencies.removeSignal(signal, signalHandler);
      } catch {
        failed = true;
      }
    }
    return failed;
  };

  const finish = (code: 0 | 1, force: boolean): void => {
    if (terminal) {
      return;
    }
    terminal = true;
    let cleanupFailed = false;
    if (timerToken !== undefined) {
      try {
        dependencies.clearTimer(timerToken);
      } catch {
        cleanupFailed = true;
      }
      timerToken = undefined;
    }
    cleanupFailed = removeHandlers() || cleanupFailed;
    if (force || cleanupFailed) {
      dependencies.forceExit(1);
    } else {
      dependencies.setExitCode(code);
    }
  };

  const signalHandler = (): void => {
    if (shutdownStarted) {
      finish(1, true);
      return;
    }
    shutdownStarted = true;
    try {
      timerToken = dependencies.setTimer(() => {
        finish(1, true);
      }, jobsSchedulerShutdownDeadlineMs);
      if (!isTimerToken(timerToken)) {
        finish(1, true);
        return;
      }
    } catch {
      finish(1, true);
      return;
    }
    void controllerPromise
      .then(async (controller) => {
        await controller.close();
      })
      .then(
        () => {
          finish(0, false);
        },
        () => {
          finish(1, true);
        },
      );
  };

  try {
    for (const signal of signals) {
      dependencies.onSignal(signal, signalHandler);
    }
  } catch {
    finish(1, false);
    return;
  }

  if (hasTerminated()) {
    return;
  }

  try {
    const rawController = await dependencies.start();
    resolveController(readController(rawController));
  } catch (error) {
    rejectController(error);
    finish(1, false);
  }
}
