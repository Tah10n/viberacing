import process from "node:process";

import { startConfiguredIngestHost } from "./host.js";
import { runIngestProcess, type IngestHostSignal } from "./process-lifecycle.js";

try {
  await runIngestProcess(
    Object.freeze({
      clearTimer: (token: unknown) => {
        clearTimeout(token as NodeJS.Timeout);
      },
      forceExit: (code: 1) => {
        process.exit(code);
      },
      onSignal: (signal: IngestHostSignal, handler: () => void) => {
        process.on(signal, handler);
      },
      removeSignal: (signal: IngestHostSignal, handler: () => void) => {
        process.off(signal, handler);
      },
      setExitCode: (code: 0 | 1) => {
        process.exitCode = code;
      },
      setTimer: (handler: () => void, milliseconds: number) => setTimeout(handler, milliseconds),
      start: startConfiguredIngestHost,
    }),
  );
} catch {
  process.exitCode = 1;
}
