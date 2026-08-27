import { readExistingInstallation, removeConfig, removeHooks, stateDirectory } from "./config.mjs";
import { reconcileOpenCodePlugin } from "./opencode-plugin.mjs";
import { clearAutomaticState, clearPendingPayloads } from "./runtime.mjs";

export async function disableLocalConnection(clearPending = false) {
  const installation = await readExistingInstallation().catch(() => null);
  await removeConfig();
  const operations = [removeHooks(), clearAutomaticState()];
  if (clearPending) operations.push(clearPendingPayloads());
  if (installation)
    operations.push(
      reconcileOpenCodePlugin({
        installationId: installation.id,
        stateRoot: stateDirectory,
        desired: false,
      }),
    );
  const results = await Promise.allSettled(operations);
  const hooks = results[0];
  const automatic = results[1];
  const pending = clearPending ? results[2] : null;
  const plugin = installation ? results[clearPending ? 3 : 2] : null;
  const hookFailures = hooks.status === "fulfilled" ? hooks.value.failures.length : 1;
  const pluginResult =
    plugin?.status === "fulfilled"
      ? plugin.value
      : plugin?.status === "rejected"
        ? { status: "unreadable", action: "blocked", error: plugin.reason, path: null }
        : null;
  const warningCount =
    hookFailures +
    (automatic.status === "rejected" ? 1 : 0) +
    (pending?.status === "rejected" ? 1 : 0) +
    (pluginResult?.action === "blocked" ? 1 : 0);
  return { warningCount, plugin: pluginResult };
}
