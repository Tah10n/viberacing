import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

// 20 seconds for capture, plus five seconds each for Node startup and process shutdown.
// All hook lock waits and ACL subprocesses share this single monotonic budget.
export const cursorCaptureDeadlineMs = 20_000;
export const cursorHookTimeoutSeconds = (cursorCaptureDeadlineMs + 5_000 + 5_000) / 1_000;
const context = new AsyncLocalStorage();
export function withCursorDeadline(callback, budgetMs = cursorCaptureDeadlineMs) {
  return context.run(performance.now() + budgetMs, callback);
}
export function cursorDeadlineActive() {
  return context.getStore() !== undefined;
}
export function cursorOperationBudget(normal, maximum = normal) {
  const deadline = context.getStore();
  if (deadline === undefined) return normal;
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) {
    const error = new Error("cursor_capture_deadline");
    error.diagnosticCode = "cursor_capture_deadline";
    throw error;
  }
  return Math.min(normal, maximum, remaining);
}
