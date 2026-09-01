import { resolve } from "node:path";
import {
  clearOpenCodePluginCleanupTarget,
  clearOpenCodePluginRecoveryTarget,
  readConfig,
  readExistingInstallation,
  readOpenCodePluginCleanupJournals,
  rememberOpenCodePluginRevocationTargets,
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
  const normalizedInstallationId = installationId.toLowerCase();
  const normalizedPath =
    pluginPath === undefined
      ? "<unresolved>"
      : process.platform === "win32"
        ? resolve(pluginPath).toLowerCase()
        : resolve(pluginPath);
  return `${normalizedInstallationId}\0${normalizedPath}`;
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
  let configStatus = "missing";
  let installation = null;
  let installationError = null;
  let installationStatus = "missing";
  try {
    config = await readConfig();
    configStatus = "valid";
  } catch (error) {
    if (error?.code !== "ENOENT") {
      configError = error;
      configStatus = "unreadable";
    }
  }
  try {
    installation = await readExistingInstallation();
    if (installation) installationStatus = "valid";
  } catch (error) {
    if (error?.code !== "ENOENT") {
      installationError = error;
      installationStatus = "unreadable";
    }
  }
  return {
    config,
    configError,
    configStatus,
    installation,
    installationError,
    installationStatus,
  };
}

export function openCodePluginRevocationTargets(cleanupContext) {
  const targets = [];
  const installationId = uuidPattern.test(cleanupContext.installation?.id ?? "")
    ? cleanupContext.installation.id.toLowerCase()
    : null;
  if (installationId && cleanupContext.installation.openCodePluginPath)
    targets.push({
      installationId,
      openCodePluginPath: cleanupContext.installation.openCodePluginPath,
    });

  const configInstallationId = uuidPattern.test(cleanupContext.config?.installationId ?? "")
    ? cleanupContext.config.installationId.toLowerCase()
    : null;
  if (
    cleanupContext.configStatus === "valid" &&
    configInstallationId &&
    configWantsOpenCodePlugin(cleanupContext.config, configInstallationId)
  ) {
    let openCodePluginPath;
    try {
      openCodePluginPath = openCodePluginLocation({ installationId: configInstallationId }).path;
    } catch {}
    const target = {
      installationId: configInstallationId,
      ...(openCodePluginPath === undefined ? {} : { openCodePluginPath }),
    };
    if (
      !targets.some(
        (candidate) =>
          cleanupTargetKey(candidate.installationId, candidate.openCodePluginPath) ===
          cleanupTargetKey(target.installationId, target.openCodePluginPath),
      )
    )
      targets.push(target);
  }
  return targets;
}

export async function prepareOpenCodePluginRevocation(cleanupContext) {
  const targets = openCodePluginRevocationTargets(cleanupContext);
  if (targets.length === 0) return { changed: false, journal: null, targets };
  const result = await rememberOpenCodePluginRevocationTargets(targets);
  return { ...result, targets };
}

export async function prepareOpenCodePluginTeardown() {
  const cleanupContext = await captureOpenCodePluginCleanupContext();
  const revocationPrepare = await prepareOpenCodePluginRevocation(cleanupContext);
  return { cleanupContext, revocationPrepare };
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
    await rememberOpenCodePluginRevocationTargets([
      {
        installationId,
        ...(pluginPath === undefined ? {} : { openCodePluginPath: pluginPath }),
      },
    ]);
    return null;
  } catch (error) {
    return error;
  }
}

async function clearPendingTargets(targets, path, failures, results) {
  for (const pending of targets)
    try {
      await clearOpenCodePluginCleanupTarget(pending.installationId, pending.openCodePluginPath, {
        journal: pending.journal ?? "cleanup",
      });
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
  preserveCommittedPlugin,
  preserveTargetsOnUnreadableJournals = false,
} = {}) {
  const targets = [];
  const failures = [];
  const results = [];
  let preserveInstallationIdentity = false;
  let preserveInstallationIdentityReason;
  let committedPluginTarget = null;
  let committedPluginReadError = null;
  let retainCommittedPending = false;
  const preserveCurrentPlugin = preserveCommittedPlugin ?? !includeInstallation;
  const context =
    cleanupContext ??
    (preserveCurrentPlugin || includeInstallation
      ? await captureOpenCodePluginCleanupContext()
      : null);
  if (preserveCurrentPlugin && context) {
    const configInstallationId = uuidPattern.test(context.config?.installationId ?? "")
      ? context.config.installationId.toLowerCase()
      : null;
    if (
      context.configStatus === "valid" &&
      configInstallationId &&
      configWantsOpenCodePlugin(context.config, configInstallationId)
    ) {
      try {
        committedPluginTarget = cleanupTargetKey(
          configInstallationId,
          openCodePluginLocation({ installationId: configInstallationId }).path,
        );
        retainCommittedPending = context.installationStatus !== "valid";
      } catch (error) {
        committedPluginReadError = error;
      }
    } else if (context.installationStatus === "unreadable")
      committedPluginReadError = context.installationError;
  }
  const journalState = await readOpenCodePluginCleanupJournals();
  const unreadableJournals = new Set(journalState.failures.map(({ journal }) => journal));
  for (const { journal, target } of journalState.entries)
    addDistinctTarget(targets, {
      ...target,
      pendingTargets: [{ ...target, journal }],
      retainIfLocationFails: false,
    });
  for (const { journal, error } of journalState.failures) {
    preserveInstallationIdentity = true;
    preserveInstallationIdentityReason ??= "cleanup-metadata-unreadable";
    failures.push({
      status: "unreadable",
      action: "blocked",
      error,
      path: null,
      journal,
      message:
        error instanceof Error
          ? error.message
          : `${journal === "cleanup" ? "Cleanup" : "Revocation"} metadata is unreadable`,
    });
  }
  if (committedPluginReadError && targets.length > 0) {
    preserveInstallationIdentity = true;
    preserveInstallationIdentityReason ??= "installation-unreadable";
    failures.push({
      status: "unreadable",
      action: "blocked",
      error: committedPluginReadError,
      path: null,
      message:
        committedPluginReadError instanceof Error
          ? committedPluginReadError.message
          : "Installation identity is unreadable",
    });
  }
  if (
    preserveTargetsOnUnreadableJournals &&
    context?.configStatus === "valid" &&
    journalState.failures.length > 0
  )
    return {
      failures,
      results,
      preserveInstallationIdentity,
      preserveInstallationIdentityReason,
    };

  if (includeInstallation && journalState.failures.length === 0) {
    const installation = context.installation;
    const installationId = uuidPattern.test(installation?.id ?? "")
      ? installation.id.toLowerCase()
      : null;
    if (installation?.openCodePluginPath)
      addDistinctTarget(targets, {
        installationId,
        openCodePluginPath: installation.openCodePluginPath,
        pendingTargets: [],
        retainIfLocationFails: false,
      });

    const configInstallationId = uuidPattern.test(context.config?.installationId ?? "")
      ? context.config.installationId.toLowerCase()
      : null;
    const configNeedsPlugin =
      configInstallationId &&
      configWantsOpenCodePlugin(context.config, context.config.installationId);
    if (configNeedsPlugin)
      addDistinctTarget(targets, {
        installationId: configInstallationId,
        pendingTargets: [],
        retainIfLocationFails: true,
      });
    if (installationId && (context.configStatus !== "valid" || configNeedsPlugin))
      addDistinctTarget(targets, {
        installationId,
        pendingTargets: [],
        retainIfLocationFails: Boolean(context.configStatus === "unreadable" || configNeedsPlugin),
      });
    if (context.configStatus === "unreadable" && !installation?.openCodePluginPath) {
      const retentionError = installationId ? await retainCleanupTarget(installationId) : null;
      failures.push({
        status: "unreadable",
        action: "blocked",
        error: context.configError,
        retentionError,
        path: null,
        message:
          context.configError instanceof Error
            ? context.configError.message
            : "Connection configuration is unreadable",
      });
    }
    if (context.installationStatus === "unreadable") {
      preserveInstallationIdentity = true;
      preserveInstallationIdentityReason ??= "installation-unreadable";
      const retentionError = configInstallationId
        ? await retainCleanupTarget(configInstallationId)
        : null;
      failures.push({
        status: "unreadable",
        action: "blocked",
        error: context.installationError,
        retentionError,
        path: null,
        message:
          context.installationError instanceof Error
            ? context.installationError.message
            : "Installation identity is unreadable",
      });
    }
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
        allowRecoveryPath: true,
      });
    } catch {}

  const physicalTargets = [];
  for (const target of resolvedTargets) {
    if (
      target.key === committedPluginTarget &&
      target.inspection?.owned === true &&
      target.pendingTargets.length > 0
    ) {
      const retained = {
        status: target.inspection.status,
        action: "retained-committed",
        changed: false,
        path: target.pluginPath,
      };
      results.push(retained);
      if (retainCommittedPending) {
        preserveInstallationIdentity = true;
        preserveInstallationIdentityReason ??= "installation-unavailable";
        failures.push({
          ...retained,
          action: "blocked",
          message:
            "The active OpenCode plugin cleanup target was retained because its installation identity is unavailable",
        });
      } else await clearPendingTargets(target.pendingTargets, target.pluginPath, failures, results);
      continue;
    }
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

  for (const target of physicalTargets) {
    let result;
    try {
      result = await reconcileOpenCodePlugin({
        installationId: target.installationId,
        stateRoot: stateDirectory,
        pluginPath: target.pluginPath,
        allowRecoveryPath: true,
        allowIncompleteStageCleanup: target.pendingTargets.some(
          (pending) => pending.openCodePluginPath === target.pluginPath,
        ),
        journaledRecoveryPeerPaths: resolvedTargets
          .filter(
            (candidate) =>
              candidate.installationId === target.installationId &&
              candidate.pluginPath !== target.pluginPath &&
              candidate.pendingTargets.length > 0,
          )
          .map((candidate) => candidate.pluginPath),
        desired: false,
        retainRecoveryPath: async (path) => {
          const error = await retainCleanupTarget(target.installationId, path);
          if (error) throw error;
        },
        releaseRecoveryPath: async (path) => {
          const cleared = await clearOpenCodePluginRecoveryTarget(target.installationId, path);
          const newFailure = cleared.failures.find(
            ({ journal }) => !unreadableJournals.has(journal),
          );
          if (newFailure) throw newFailure.error;
        },
      });
    } catch (error) {
      result = {
        status: "unreadable",
        action: "blocked",
        error,
        path: error?.recoveryPath ?? error?.pluginPath ?? target.pluginPath,
        recoveryPath: error?.recoveryPath,
        recoveryPaths: error?.recoveryPaths,
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
      const retentionPath = result.path ?? target.pluginPath;
      result.retentionError = await retainCleanupTarget(target.installationId, retentionPath);
      if (
        !result.retentionError &&
        cleanupTargetKey(target.installationId, retentionPath) !==
          cleanupTargetKey(target.installationId, target.pluginPath)
      )
        await clearPendingTargets(target.pendingTargets, target.pluginPath, failures, results);
      failures.push({
        ...result,
        message: result.error instanceof Error ? result.error.message : result.status,
      });
      continue;
    }
    await clearPendingTargets(target.pendingTargets, target.pluginPath, failures, results);
  }
  return {
    failures,
    results,
    preserveInstallationIdentity,
    preserveInstallationIdentityReason,
  };
}
