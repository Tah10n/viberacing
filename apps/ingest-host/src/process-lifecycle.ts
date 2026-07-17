import { ingestHostShutdownDeadlineMs, type IngestHostController } from "./host.js";

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

export type IngestHostSignal = (typeof signals)[number];
export type IngestHostSignalHandler = () => void;

export type IngestProcessLifecycleErrorCode = "controller_invalid" | "dependencies_invalid";

export class IngestProcessLifecycleError extends Error {
  readonly code: IngestProcessLifecycleErrorCode;

  constructor(code: IngestProcessLifecycleErrorCode) {
    super("Ingest process lifecycle failed closed.");
    this.name = "IngestProcessLifecycleError";
    this.code = code;
  }
}

export interface IngestProcessDependencies {
  readonly clearTimer: (token: unknown) => void;
  readonly forceExit: (code: 1) => void;
  readonly onSignal: (signal: IngestHostSignal, handler: IngestHostSignalHandler) => void;
  readonly removeSignal: (signal: IngestHostSignal, handler: IngestHostSignalHandler) => void;
  readonly setExitCode: (code: 0 | 1) => void;
  readonly setTimer: (handler: () => void, milliseconds: number) => unknown;
  readonly start: () => Promise<unknown>;
}

function fail(code: IngestProcessLifecycleErrorCode): never {
  throw new IngestProcessLifecycleError(code);
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

function ownDataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor && descriptor.enumerable
    ? (descriptor.value as unknown)
    : undefined;
}

function readDependencies(value: unknown): IngestProcessDependencies {
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
    return Object.freeze(result) as unknown as IngestProcessDependencies;
  } catch (error) {
    if (error instanceof IngestProcessLifecycleError) {
      throw error;
    }
    fail("dependencies_invalid");
  }
}

function readController(value: unknown): IngestHostController {
  try {
    if (!isPlainRecord(value) || !Object.isFrozen(value) || !hasExactKeys(value, controllerKeys)) {
      fail("controller_invalid");
    }
    const close = ownDataValue(value, "close");
    if (typeof close !== "function") {
      fail("controller_invalid");
    }
    return Object.freeze({ close: close as IngestHostController["close"] });
  } catch (error) {
    if (error instanceof IngestProcessLifecycleError) {
      throw error;
    }
    fail("controller_invalid");
  }
}

export async function runIngestProcess(rawDependencies: unknown): Promise<void> {
  const dependencies = readDependencies(rawDependencies);
  let resolveController!: (controller: IngestHostController) => void;
  let rejectController!: (error: unknown) => void;
  const controllerPromise = new Promise<IngestHostController>((resolve, reject) => {
    resolveController = resolve;
    rejectController = reject;
  });
  void controllerPromise.catch(() => undefined);
  let shutdownStarted = false;
  let terminal = false;
  let timerToken: unknown;

  const removeHandlers = (): void => {
    for (const signal of signals) {
      dependencies.removeSignal(signal, signalHandler);
    }
  };

  const finish = (code: 0 | 1, force: boolean): void => {
    if (terminal) {
      return;
    }
    terminal = true;
    if (timerToken !== undefined) {
      dependencies.clearTimer(timerToken);
      timerToken = undefined;
    }
    removeHandlers();
    if (force) {
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
      }, ingestHostShutdownDeadlineMs);
      if (timerToken === undefined) {
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

  try {
    const rawController = await dependencies.start();
    resolveController(readController(rawController));
  } catch (error) {
    rejectController(error);
    finish(1, false);
  }
}
