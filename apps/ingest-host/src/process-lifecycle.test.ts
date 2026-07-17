import { describe, expect, it, vi } from "vitest";

import { ingestHostShutdownDeadlineMs } from "./host.js";
import {
  IngestProcessLifecycleError,
  runIngestProcess,
  type IngestHostSignal,
  type IngestHostSignalHandler,
  type IngestProcessDependencies,
} from "./process-lifecycle.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T) => void;
}

interface FakeProcess {
  readonly clearedTimers: unknown[];
  readonly dependencies: IngestProcessDependencies;
  readonly exitCodes: (0 | 1)[];
  readonly forcedCodes: number[];
  readonly handlers: Map<IngestHostSignal, Set<IngestHostSignalHandler>>;
  readonly start: ReturnType<typeof vi.fn>;
  readonly timers: { readonly handler: () => void; readonly milliseconds: number }[];
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

function createController(
  close: () => Promise<void> = vi.fn(async (): Promise<void> => undefined),
) {
  return Object.freeze({ close });
}

function createFakeProcess(
  startResult: Promise<unknown> = Promise.resolve(createController()),
): FakeProcess {
  const handlers = new Map<IngestHostSignal, Set<IngestHostSignalHandler>>();
  const timers: { readonly handler: () => void; readonly milliseconds: number }[] = [];
  const clearedTimers: unknown[] = [];
  const exitCodes: (0 | 1)[] = [];
  const forcedCodes: number[] = [];
  const start = vi.fn(() => startResult);
  const dependencies = Object.freeze({
    clearTimer: (token: unknown) => {
      clearedTimers.push(token);
    },
    forceExit: (code: 1) => {
      forcedCodes.push(code);
    },
    onSignal: (signal: IngestHostSignal, handler: IngestHostSignalHandler) => {
      const signalHandlers = handlers.get(signal) ?? new Set<IngestHostSignalHandler>();
      signalHandlers.add(handler);
      handlers.set(signal, signalHandlers);
    },
    removeSignal: (signal: IngestHostSignal, handler: IngestHostSignalHandler) => {
      handlers.get(signal)?.delete(handler);
    },
    setExitCode: (code: 0 | 1) => {
      exitCodes.push(code);
    },
    setTimer: (handler: () => void, milliseconds: number) => {
      const timer = { handler, milliseconds };
      timers.push(timer);
      return timer;
    },
    start,
  }) satisfies IngestProcessDependencies;
  return { clearedTimers, dependencies, exitCodes, forcedCodes, handlers, start, timers };
}

function emit(fake: FakeProcess, signal: IngestHostSignal): void {
  for (const handler of [...(fake.handlers.get(signal) ?? [])]) {
    handler();
  }
}

async function flushLifecycle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe("runIngestProcess", () => {
  it("registers both shutdown signals before starting and remains active after startup", async () => {
    const fake = createFakeProcess();

    await runIngestProcess(fake.dependencies);

    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(fake.handlers.get("SIGINT")?.size).toBe(1);
    expect(fake.handlers.get("SIGTERM")?.size).toBe(1);
    expect(fake.exitCodes).toEqual([]);
    expect(fake.forcedCodes).toEqual([]);
  });

  it("accepts a frozen null-prototype dependency record", async () => {
    const fake = createFakeProcess();
    const dependencies = Object.freeze(
      Object.assign(Object.create(null) as Record<string, unknown>, fake.dependencies),
    );

    await runIngestProcess(dependencies);

    expect(fake.start).toHaveBeenCalledTimes(1);
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "gracefully closes once on %s and clears its deadline",
    async (signal) => {
      const close = vi.fn(async () => undefined);
      const fake = createFakeProcess(Promise.resolve(createController(close)));
      await runIngestProcess(fake.dependencies);

      emit(fake, signal);
      await flushLifecycle();

      expect(close).toHaveBeenCalledTimes(1);
      expect(fake.timers).toHaveLength(1);
      expect(fake.timers[0]?.milliseconds).toBe(ingestHostShutdownDeadlineMs);
      expect(fake.clearedTimers).toEqual([fake.timers[0]]);
      expect(fake.exitCodes).toEqual([0]);
      expect(fake.forcedCodes).toEqual([]);
      expect(fake.handlers.get("SIGINT")?.size).toBe(0);
      expect(fake.handlers.get("SIGTERM")?.size).toBe(0);
    },
  );

  it("honors shutdown requested while startup is still pending", async () => {
    const startup = deferred<unknown>();
    const close = vi.fn(async () => undefined);
    const fake = createFakeProcess(startup.promise);
    const run = runIngestProcess(fake.dependencies);

    emit(fake, "SIGTERM");
    startup.resolve(createController(close));
    await run;
    await flushLifecycle();

    expect(close).toHaveBeenCalledTimes(1);
    expect(fake.exitCodes).toEqual([0]);
  });

  it("forces termination on a second shutdown signal", async () => {
    const closing = deferred<undefined>();
    const close = vi.fn(() => closing.promise);
    const fake = createFakeProcess(Promise.resolve(createController(close)));
    await runIngestProcess(fake.dependencies);

    emit(fake, "SIGTERM");
    emit(fake, "SIGINT");

    expect(fake.forcedCodes).toEqual([1]);
    expect(fake.clearedTimers).toEqual([fake.timers[0]]);
    closing.resolve(undefined);
    await flushLifecycle();
    expect(fake.exitCodes).toEqual([]);
    expect(fake.forcedCodes).toEqual([1]);
  });

  it("forces termination when the shutdown deadline expires", async () => {
    const closing = deferred<undefined>();
    const fake = createFakeProcess(Promise.resolve(createController(vi.fn(() => closing.promise))));
    await runIngestProcess(fake.dependencies);

    emit(fake, "SIGTERM");
    fake.timers[0]?.handler();

    expect(fake.forcedCodes).toEqual([1]);
    closing.resolve(undefined);
    await flushLifecycle();
    expect(fake.forcedCodes).toEqual([1]);
  });

  it("forces termination when graceful close rejects", async () => {
    const close = vi.fn(async () => Promise.reject(new Error("private-close-value")));
    const fake = createFakeProcess(Promise.resolve(createController(close)));
    await runIngestProcess(fake.dependencies);

    emit(fake, "SIGTERM");
    await flushLifecycle();

    expect(fake.forcedCodes).toEqual([1]);
    expect(fake.exitCodes).toEqual([]);
  });

  it("fails closed when creating the shutdown timer throws or returns no token", async () => {
    for (const setTimer of [
      () => {
        throw new Error("private-timer-value");
      },
      () => undefined,
    ]) {
      const fake = createFakeProcess();
      const dependencies = Object.freeze({ ...fake.dependencies, setTimer });
      await runIngestProcess(dependencies);

      emit(fake, "SIGTERM");

      expect(fake.forcedCodes).toEqual([1]);
      expect(fake.exitCodes).toEqual([]);
    }
  });

  it("sets a generic failed exit status when startup rejects", async () => {
    const fake = createFakeProcess(Promise.reject(new Error("private-startup-value")));

    await runIngestProcess(fake.dependencies);

    expect(fake.exitCodes).toEqual([1]);
    expect(fake.forcedCodes).toEqual([]);
    expect(fake.handlers.get("SIGINT")?.size).toBe(0);
    expect(fake.handlers.get("SIGTERM")?.size).toBe(0);
  });

  it.each([
    null,
    [],
    {},
    { close: async (): Promise<void> => undefined },
    Object.freeze({ close: true }),
    Object.freeze({ close: async (): Promise<void> => undefined, extra: true }),
  ])("treats an invalid startup controller %# as startup failure", async (controller) => {
    const fake = createFakeProcess(Promise.resolve(controller));

    await runIngestProcess(fake.dependencies);

    expect(fake.exitCodes).toEqual([1]);
    expect(fake.forcedCodes).toEqual([]);
  });

  it("contains hostile controller traps", async () => {
    const controller = new Proxy(Object.freeze({}), {
      getPrototypeOf() {
        throw new Error("private-controller-value");
      },
    });
    const fake = createFakeProcess(Promise.resolve(controller));

    await runIngestProcess(fake.dependencies);

    expect(fake.exitCodes).toEqual([1]);
  });

  it("handles a signal-registration failure without starting", async () => {
    const fake = createFakeProcess();
    const dependencies = Object.freeze({
      ...fake.dependencies,
      onSignal: () => {
        throw new Error("private-signal-value");
      },
    });

    await runIngestProcess(dependencies);

    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.exitCodes).toEqual([1]);
  });

  it("forces termination if a registration adapter emits a synchronous signal", async () => {
    const fake = createFakeProcess();
    const dependencies = Object.freeze({
      ...fake.dependencies,
      onSignal: (_signal: IngestHostSignal, handler: IngestHostSignalHandler) => {
        handler();
      },
      setTimer: () => undefined,
    });

    await runIngestProcess(dependencies);

    expect(fake.forcedCodes).toEqual([1]);
    expect(fake.start).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    [],
    {},
    { clearTimer: () => undefined },
    Object.freeze({}),
    Object.freeze({
      clearTimer: true,
      forceExit: () => undefined,
      onSignal: () => undefined,
      removeSignal: () => undefined,
      setExitCode: () => undefined,
      setTimer: () => ({}),
      start: async () => createController(),
    }),
  ])("rejects invalid process dependencies %#", async (dependencies) => {
    await expect(runIngestProcess(dependencies)).rejects.toMatchObject({
      code: "dependencies_invalid",
      message: "Ingest process lifecycle failed closed.",
    });
  });

  it("rejects an accessor-backed dependency without invoking it", async () => {
    const fake = createFakeProcess();
    const dependencies = { ...fake.dependencies } as Record<string, unknown>;
    const accessor = vi.fn(() => fake.dependencies.start);
    Object.defineProperty(dependencies, "start", { enumerable: true, get: accessor });
    Object.freeze(dependencies);

    await expect(runIngestProcess(dependencies)).rejects.toMatchObject({
      code: "dependencies_invalid",
    });
    expect(accessor).not.toHaveBeenCalled();
  });

  it("contains hostile dependency traps", async () => {
    const dependencies = new Proxy(Object.freeze({}), {
      ownKeys() {
        throw new Error("private-dependency-value");
      },
    });

    await expect(runIngestProcess(dependencies)).rejects.toBeInstanceOf(
      IngestProcessLifecycleError,
    );
  });
});
