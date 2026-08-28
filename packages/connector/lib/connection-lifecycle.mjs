import { removeConfig, removeHooks, removeInstallationIdentity } from "./config.mjs";
import {
  captureOpenCodePluginCleanupContext,
  cleanupOpenCodePluginTargets,
} from "./opencode-cleanup.mjs";
import { clearAutomaticState, clearPendingPayloads } from "./runtime.mjs";

export async function disableLocalConnection(clearPending = false) {
  const cleanupContext = await captureOpenCodePluginCleanupContext();
  const [config] = await Promise.allSettled([removeConfig()]);
  const operations = [
    removeHooks(),
    clearAutomaticState(),
    cleanupOpenCodePluginTargets({ includeInstallation: true, cleanupContext }),
  ];
  if (clearPending) operations.push(clearPendingPayloads());
  const results = await Promise.allSettled(operations);
  const hooks = results[0];
  const automatic = results[1];
  const plugin = results[2];
  const pending = clearPending ? results[3] : null;
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
  const installation =
    config.status === "fulfilled" && !pluginCleanup.preserveInstallationIdentity
      ? (await Promise.allSettled([removeInstallationIdentity()]))[0]
      : null;
  const pluginResult = pluginCleanup.failures[0] ?? pluginCleanup.results[0] ?? null;
  const warningCount =
    (config.status === "rejected" ? 1 : 0) +
    (installation?.status === "rejected" ? 1 : 0) +
    hookFailures +
    (automatic.status === "rejected" ? 1 : 0) +
    (pending?.status === "rejected" ? 1 : 0) +
    pluginCleanup.failures.length;
  return {
    authorizationRemoved: config.status === "fulfilled",
    authorizationError: config.status === "rejected" ? config.reason : null,
    installationIdentityPreserved: pluginCleanup.preserveInstallationIdentity === true,
    warningCount,
    plugin: pluginResult,
    pluginCleanup,
  };
}
