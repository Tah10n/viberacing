import {
  clearOpenCodePluginCleanupTarget,
  readConfig,
  readExistingInstallation,
  readOpenCodePluginCleanups,
  rememberOpenCodePluginCleanup,
  stateDirectory,
} from "./config.mjs";
import {
  inspectOpenCodePlugin,
  openCodePluginLocation,
  reconcileOpenCodePlugin,
} from "./opencode-plugin.mjs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function configWantsOpenCodePlugin(config, installationId) {
  return (
    config?.installationId === installationId &&
    config.sources?.some(
      (source) => source.agentId === "opencode" && uuidPattern.test(source.sourceId ?? ""),
    )
  );
}

export function openCodePluginBlocked(result) {
  return result?.action === "blocked" || result?.error !== undefined;
}

function cleanupTargetKey(installationId, pluginPath) {
  const normalizedPath =
    pluginPath === undefined
      ? "<unresolved>"
      : process.platform === "win32"
        ? pluginPath.toLowerCase()
        : pluginPath;
  return `${installationId}\0${normalizedPath}`;
}

function sameOpenCodePluginFile(left, right) {
  return (
    left?.owned === true &&
    right?.owned === true &&
    left.info?.dev === right.info?.dev &&
    left.info?.ino === right.info?.ino
  );
}

export async function captureOpenCodePluginCleanupContext() {
  let config = null;
  let configError = null;
  let installation = null;
  let installationError = null;
  try {
    config = await readConfig();
  } catch (error) {
    configError = error;
  }
  try {
    installation = await readExistingInstallation();
  } catch (error) {
    installationError = error;
  }
  return { config, configError, installation, installationError };
}

function addDistinctTarget(targets, candidate) {
  const normalizedCandidate = {
    ...candidate,
    installationId: candidate.installationId.toLowerCase(),
  };
  const key = cleanupTargetKey(
    normalizedCandidate.installationId,
    normalizedCandidate.openCodePluginPath,
  );
  const existing = targets.find((target) => target.key === key);
  if (existing) {
    existing.pendingTargets.push(...normalizedCandidate.pendingTargets);
    existing.retainIfLocationFails ||= normalizedCandidate.retainIfLocationFails;
    return;
  }
  targets.push({ ...normalizedCandidate, key });
}

async function retainCleanupTarget(installationId, pluginPath) {
  try {
    await rememberOpenCodePluginCleanup(installationId, pluginPath);
    return null;
  } catch (error) {
    return error;
  }
}

async function clearPendingTargets(targets, path, failures, results) {
  for (const pending of targets)
    try {
      await clearOpenCodePluginCleanupTarget(pending.installationId, pending.openCodePluginPath);
    } catch (error) {
      const failure = {
        status: "unreadable",
        action: "blocked",
        error,
        path,
        message: error instanceof Error ? error.message : "Cleanup metadata could not be cleared",
      };
      failures.push(failure);
      results.push(failure);
    }
}

export async function cleanupOpenCodePluginTargets({
  includeInstallation = false,
  cleanupContext,
} = {}) {
  const targets = [];
  const failures = [];
  try {
    for (const target of await readOpenCodePluginCleanups())
      addDistinctTarget(targets, {
        ...target,
        pendingTargets: [target],
        retainIfLocationFails: false,
      });
  } catch (error) {
    failures.push({
      status: "unreadable",
      action: "blocked",
      error,
      path: null,
      message: error instanceof Error ? error.message : "Cleanup metadata is unreadable",
    });
  }

  if (includeInstallation) {
    const context = cleanupContext ?? (await captureOpenCodePluginCleanupContext());
    const installation = context.installation;
    if (installation?.openCodePluginPath)
      addDistinctTarget(targets, {
        installationId: installation.id,
        openCodePluginPath: installation.openCodePluginPath,
        pendingTargets: [],
        retainIfLocationFails: false,
      });

    const configInstallationId = uuidPattern.test(context.config?.installationId ?? "")
      ? context.config.installationId.toLowerCase()
      : null;
    if (
      configInstallationId &&
      configWantsOpenCodePlugin(context.config, context.config.installationId)
    )
      addDistinctTarget(targets, {
        installationId: configInstallationId,
        pendingTargets: [],
        retainIfLocationFails: true,
      });
  }

  const resolvedTargets = [];
  for (const target of targets) {
    let pluginPath = target.openCodePluginPath;
    if (pluginPath === undefined)
      try {
        pluginPath = openCodePluginLocation({ installationId: target.installationId }).path;
      } catch (error) {
        const retentionError = target.retainIfLocationFails
          ? await retainCleanupTarget(target.installationId)
          : null;
        failures.push({
          status: "unreadable",
          action: "blocked",
          error,
          retentionError,
          path: null,
          message: error instanceof Error ? error.message : "Plugin location is unreadable",
        });
        continue;
      }
    const key = cleanupTargetKey(target.installationId, pluginPath);
    const existing = resolvedTargets.find((candidate) => candidate.key === key);
    if (existing) existing.pendingTargets.push(...target.pendingTargets);
    else resolvedTargets.push({ ...target, key, pluginPath, inspection: null });
  }

  for (const target of resolvedTargets)
    try {
      target.inspection = await inspectOpenCodePlugin({
        installationId: target.installationId,
        stateRoot: stateDirectory,
        pluginPath: target.pluginPath,
      });
    } catch {}

  const physicalTargets = [];
  for (const target of resolvedTargets) {
    const existing = physicalTargets.find(
      (candidate) =>
        candidate.installationId === target.installationId &&
        sameOpenCodePluginFile(candidate.inspection, target.inspection),
    );
    if (existing) {
      existing.pendingTargets.push(...target.pendingTargets);
      existing.aliasPaths.push(target.pluginPath);
    } else physicalTargets.push({ ...target, aliasPaths: [target.pluginPath] });
  }

  const results = [];
  for (const target of physicalTargets) {
    let result;
    try {
      result = await reconcileOpenCodePlugin({
        installationId: target.installationId,
        stateRoot: stateDirectory,
        pluginPath: target.pluginPath,
        desired: false,
      });
    } catch (error) {
      result = {
        status: "unreadable",
        action: "blocked",
        error,
        path: error?.pluginPath ?? target.pluginPath,
      };
    }
    results.push(result);
    const unresolvedPending = target.pendingTargets.some(
      (pending) => pending.openCodePluginPath === undefined,
    );
    if (result.status === "missing" && result.action === "none" && unresolvedPending) {
      await clearPendingTargets(
        target.pendingTargets.filter((candidate) => candidate.openCodePluginPath !== undefined),
        target.pluginPath,
        failures,
        results,
      );
      failures.push({
        status: "unresolved-location",
        action: "blocked",
        path: target.pluginPath,
        message:
          "The pending cleanup target has no exact recorded path and no owned plugin was found at the current OpenCode load path",
      });
      continue;
    }
    if (openCodePluginBlocked(result)) {
      result.retentionError = await retainCleanupTarget(target.installationId, target.pluginPath);
      failures.push({
        ...result,
        message: result.error instanceof Error ? result.error.message : result.status,
      });
      continue;
    }
    await clearPendingTargets(target.pendingTargets, target.pluginPath, failures, results);
  }
  return { failures, results };
}
