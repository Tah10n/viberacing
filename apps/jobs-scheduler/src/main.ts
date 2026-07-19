import process from "node:process";

import { startConfiguredJobsScheduler } from "./scheduler.js";
import { runJobsSchedulerProcess, type JobsSchedulerProcessSignal } from "./process-lifecycle.js";

function reportSignal(): void {
  try {
    process.stderr.write("Vibe Racing Jobs scheduler cycle failed.\n");
  } catch {
    // The next fixed slot remains the retry boundary when the output stream is unavailable.
  }
}

if (process.argv.length !== 2) {
  process.exitCode = 1;
} else {
  try {
    await runJobsSchedulerProcess(
      Object.freeze({
        clearTimer: (token: unknown) => {
          clearTimeout(token as NodeJS.Timeout);
        },
        forceExit: (code: 1) => {
          process.exit(code);
        },
        onSignal: (signal: JobsSchedulerProcessSignal, handler: () => void) => {
          process.on(signal, handler);
        },
        removeSignal: (signal: JobsSchedulerProcessSignal, handler: () => void) => {
          process.off(signal, handler);
        },
        setExitCode: (code: 0 | 1) => {
          process.exitCode = code;
        },
        setTimer: (handler: () => void, milliseconds: number) => setTimeout(handler, milliseconds),
        start: () => startConfiguredJobsScheduler(undefined, reportSignal),
      }),
    );
  } catch {
    process.exitCode = 1;
  }
}
