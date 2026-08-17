import { removeConfig, removeHooks } from "./config.mjs";
import { clearAutomaticState, clearPendingPayloads } from "./runtime.mjs";

export async function disableLocalConnection(clearPending = false) {
  await removeConfig();
  const operations = [removeHooks(), clearAutomaticState()];
  if (clearPending) operations.push(clearPendingPayloads());
  const results = await Promise.allSettled(operations);
  const hookFailures = results[0].status === "fulfilled" ? results[0].value.failures.length : 1;
  return hookFailures + results.slice(1).filter((result) => result.status === "rejected").length;
}
