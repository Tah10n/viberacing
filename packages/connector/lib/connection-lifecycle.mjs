import { removeConfig, removeHooks, removeInstallationIdentity } from "./config.mjs";
import {
  captureOpenCodePluginCleanupContext,
  cleanupOpenCodePluginTargets,
} from "./opencode-cleanup.mjs";
import { clearAutomaticState, clearPendingPayloads } from "./runtime.mjs";

export async function disableLocalConnection(clearPending = false) {
  const cleanupContext = await captureOpenCodePluginCleanupContext();
  const operations = [
    removeConfig(),
    removeInstallationIdentity(),
    removeHooks(),
    clearAutomaticState(),
    cleanupOpenCodePluginTargets({ includeInstallation: true, cleanupContext }),
  ];
  if (clearPending) operations.push(clearPendingPayloads());
  const results = await Promise.allSettled(operations);
  const config = results[0];
  const installation = results[1];
  const hooks = results[2];
  const automatic = results[3];
  const plugin = results[4];
  const pending = clearPending ? results[5] : null;
  const hookFailures = hooks.status === "fulfilled" ? hooks.value.failures.length : 1;
  const pluginCleanup =
    plugin?.status === "fulfilled"
      ? plugin.value
      : plugin?.status === "rejected"
        ? {
            failures: [
              {
                status: "unreadable",
                action: "blocked",
                error: plugin.reason,
                path: null,
                message:
                  plugin.reason instanceof Error
                    ? plugin.reason.message
                    : "OpenCode cleanup failed",
              },
            ],
            results: [],
          }
        : { failures: [], results: [] };
  const pluginResult = pluginCleanup.failures[0] ?? pluginCleanup.results[0] ?? null;
  const warningCount =
    (config.status === "rejected" ? 1 : 0) +
    (installation.status === "rejected" ? 1 : 0) +
    hookFailures +
    (automatic.status === "rejected" ? 1 : 0) +
    (pending?.status === "rejected" ? 1 : 0) +
    pluginCleanup.failures.length;
  return { warningCount, plugin: pluginResult, pluginCleanup };
}
