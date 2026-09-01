#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { connectorVersion } from "../lib/version.mjs";
import {
  acknowledgeDiagnosticEvents,
  collectorDiagnostic,
  forgetSourceDiagnostics,
  normalizeAdapterDiagnostics,
  pendingDiagnosticEvents,
  reconcileDiagnosticPhase,
} from "../lib/diagnostics.mjs";
import { connectorProtocolVersion, parseProtocolResponse } from "../lib/protocol.mjs";
import { normalizeOrigin, officialProductionOrigin } from "../lib/origin.mjs";
import { assertOpenCodeUpgradeReady } from "../lib/opencode-cutover-preflight.mjs";
import {
  inspectOpenCodePlugin,
  openCodePluginLocation,
  reconcileOpenCodePlugin,
} from "../lib/opencode-plugin.mjs";
import {
  cleanupOpenCodePluginTargets,
  configWantsOpenCodePlugin,
  openCodePluginBlocked,
  prepareOpenCodePluginTeardown,
} from "../lib/opencode-cleanup.mjs";
import {
  adapters,
  adapterFor,
  discoverSources,
  entriesWithinRange,
  safeCaptureRecord,
  wrapperInvocation,
} from "../lib/readers.mjs";
import { openBrowser } from "../lib/browser.mjs";
import {
  browserSyncProtocolVersion,
  browserSyncHandlerAttestation,
  registerBrowserSync,
  unregisterBrowserSync,
} from "../lib/browser-integration.mjs";
import { disableLocalConnection } from "../lib/connection-lifecycle.mjs";
import { sanitizeTerminalText } from "../lib/terminal.mjs";
import {
  executableOverride,
  resolveAgentExecutable,
  spawnResolvedExecutable,
} from "../lib/executables.mjs";
import {
  addSource,
  beginConnectAttempt,
  bindCodexProviderAccount,
  clearConnectAttempt,
  clearOpenCodePluginCleanupTarget,
  commitConnectionState,
  connectionSnapshot,
  connectedStateExists,
  connectedSourceMappingExists,
  diagnoseHooks,
  invalidateConnectAttempt,
  inspectConfig,
  inspectSources,
  localInstallationStateExists,
  localSourceRegistryContains,
  migrateSourcesSchema,
  prepareRuntime,
  reconcileHooks,
  readConfig,
  readExistingInstallation,
  readOrCreateInstallation,
  readOrCreateProviderIdentitySalt,
  readSources,
  rememberOpenCodePluginCleanup,
  rememberOpenCodePluginPath,
  recordConnectAttemptPairing,
  rememberSourceExecutable,
  reconcileDetectedSources,
  removeHookForSource,
  removeHooks,
  removeConfig,
  removeLocalState,
  removeSource,
  resetInstallation,
  stateDirectory,
  writeConfig,
  withConnectionConfig,
} from "../lib/config.mjs";
import {
  automaticDueAt,
  configuredAutomaticSyncTimings,
  appendCapture,
  claimConnectedScheduler,
  claimSchedulerLaunch,
  compactCapture,
  clearAutomaticState,
  clearDirty,
  clearDirtyForSources,
  clearQuarantine,
  markAgentSourcesDirtyIfConnected,
  markDirty,
  markDirtyIfConnected,
  dirtyClaims,
  dirtyEntries,
  lifecycleMutationActive,
  ownsScheduler,
  pendingPayloads,
  quarantinePending,
  quarantinedPayloads,
  readDirty,
  inspectState,
  readPending,
  readState,
  releaseScheduler,
  releaseSchedulerLaunch,
  mergePendingPayloads,
  removePending,
  removePendingForSource,
  savePending,
  withLifecycleMutation,
  withSyncLock,
  writeState,
} from "../lib/runtime.mjs";

const protocolVersion = connectorProtocolVersion;
const semanticVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const handlerInspectionDiagnostic = "browser_handler_inspection_failed";
const arguments_ = process.argv.slice(2);
const command = arguments_[0] ?? "help";
const quiet = arguments_.includes("--quiet");
const automaticTimings = configuredAutomaticSyncTimings();
const remoteReconciliationIntervalMs =
  process.env.NODE_ENV === "test" &&
  /^\d+$/.test(process.env.VIBERACING_TEST_REMOTE_RECONCILIATION_INTERVAL_MS ?? "")
    ? Number(process.env.VIBERACING_TEST_REMOTE_RECONCILIATION_INTERVAL_MS)
    : 10 * 60_000;
const pairingPollIntervalMs =
  process.env.NODE_ENV === "test" &&
  /^\d+$/.test(process.env.VIBERACING_TEST_PAIRING_POLL_INTERVAL_MS ?? "")
    ? Number(process.env.VIBERACING_TEST_PAIRING_POLL_INTERVAL_MS)
    : 2_000;
const automaticSyncLockWaitMs =
  process.env.NODE_ENV === "test" &&
  /^\d+$/.test(process.env.VIBERACING_TEST_AUTOMATIC_SYNC_LOCK_WAIT_MS ?? "")
    ? Number(process.env.VIBERACING_TEST_AUTOMATIC_SYNC_LOCK_WAIT_MS)
    : process.env.NODE_ENV === "test"
      ? 5_000
      : 60_000;
const manualSyncLockWaitMs =
  process.env.NODE_ENV === "test" &&
  /^\d+$/.test(process.env.VIBERACING_TEST_MANUAL_SYNC_LOCK_WAIT_MS ?? "")
    ? Number(process.env.VIBERACING_TEST_MANUAL_SYNC_LOCK_WAIT_MS)
    : process.env.NODE_ENV === "test"
      ? 5_000
      : 60_000;
const option = (name, fallback) => {
  const index = arguments_.indexOf(name);
  return index >= 0 && arguments_[index + 1] ? arguments_[index + 1] : fallback;
};
const output = (...values) => {
  if (!quiet) process.stdout.write(`${values.map(sanitizeTerminalText).join(" ")}\n`);
};
const warning = (value) => process.stderr.write(`${sanitizeTerminalText(value)}\n`);
let lastHookErrorRecorded = false;

async function recordLastHookError() {
  lastHookErrorRecorded = true;
  const directory = join(stateDirectory, "logs");
  await mkdir(directory, { recursive: true, mode: 0o700 }).catch(() => {});
  await writeFile(
    join(directory, "last-error.log"),
    `${new Date().toISOString()} ${command === "auto-sync" ? "automatic_sync_failed" : "connector_command_failed"}\n`,
    { mode: 0o600 },
  ).catch(() => {});
}

async function clearLastHookError() {
  await unlink(join(stateDirectory, "logs", "last-error.log")).catch(() => {});
}

function collectorWarningMessage(code) {
  if (code === "codex_session_components_incomplete")
    return "local Codex token components are incomplete for one or more requested UTC days; authoritative daily totals remain available";
  if (code === "local_event_identity_conflict")
    return "one local usage event identity was reused with different counters; the first observed tuple was retained";
  return `local usage detail warning: ${code}`;
}

function codexHookGuidance(status) {
  if (status === undefined || status === "current") return null;
  if (status === "untrusted" || status === "modified")
    return "Codex automatic sync needs approval. In Codex CLI, run `/hooks` and trust the Vibe Racing Stop hook.";
  if (status === "disabled")
    return "Codex automatic sync is disabled. In Codex CLI, run `/hooks`, then enable and trust the Vibe Racing Stop hook.";
  if (status === "trust-unknown")
    return "Codex automatic sync trust could not be verified. In Codex CLI, run `/hooks` and verify the Vibe Racing Stop hook.";
  return "Codex automatic sync hook needs repair. Run `viberacing doctor --repair`.";
}

function sameOpenCodePluginPath(left, right) {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function sameOpenCodePluginFile(left, right) {
  return (
    left?.owned === true &&
    right?.owned === true &&
    left.info?.dev === right.info?.dev &&
    left.info?.ino === right.info?.ino
  );
}

async function inspectPluginForDoctor(config) {
  const wantsPlugin = configWantsOpenCodePlugin(config, config?.installationId);
  let installation;
  try {
    installation = await readExistingInstallation();
  } catch {
    return { status: "unreadable", recordedStatus: null };
  }
  if (wantsPlugin && installation?.id !== config.installationId)
    return { status: "identity-mismatch", recordedStatus: null };
  const installationId = config?.installationId ?? installation?.id;
  if (!uuidPattern.test(installationId ?? ""))
    return { status: wantsPlugin ? "identity-mismatch" : "not-needed", recordedStatus: null };
  const inspectRecorded = async () => {
    if (installation?.id !== installationId || !installation.openCodePluginPath) return null;
    return inspectOpenCodePlugin({
      installationId,
      stateRoot: stateDirectory,
      pluginPath: installation.openCodePluginPath,
    });
  };
  if (!wantsPlugin) {
    const recorded = await inspectRecorded();
    const recordedStatus = recorded ? (recorded.owned ? "orphaned" : recorded.status) : null;
    if (recorded?.owned) return { status: "orphaned", recordedStatus };
    if (recorded && recorded.status !== "missing")
      return { status: recorded.status, recordedStatus };
    return { status: "not-needed", recordedStatus };
  }
  let currentPath;
  try {
    currentPath = openCodePluginLocation({ installationId }).path;
  } catch {
    const recorded = await inspectRecorded();
    return {
      status: "unreadable",
      recordedStatus: recorded ? (recorded.owned ? "orphaned" : recorded.status) : null,
    };
  }
  const current = await inspectOpenCodePlugin({
    installationId,
    stateRoot: stateDirectory,
    pluginPath: currentPath,
  });
  let recorded = null;
  if (
    installation?.id === installationId &&
    installation.openCodePluginPath &&
    !sameOpenCodePluginPath(installation.openCodePluginPath, currentPath)
  )
    recorded = await inspectRecorded();
  const recordedStatus = recorded ? (recorded.owned ? "orphaned" : recorded.status) : null;
  if (current.status === "current") return { status: "current", recordedStatus };
  if (current.status !== "missing") return { status: current.status, recordedStatus };
  if (recorded?.owned) return { status: "relocation-required", recordedStatus };
  return { status: "missing", recordedStatus };
}

function pendingOpenCodeCleanupError(cleanup) {
  const paths = [
    ...new Set(
      cleanup.failures
        .map((failure) => failure.path)
        .filter(Boolean)
        .map((path) => sanitizeTerminalText(path)),
    ),
  ];
  const location = paths.length > 0 ? ` at ${paths.join(", ")}` : "";
  const error = new Error(
    `Pending OpenCode plugin cleanup is incomplete${location}. Fix XDG_CONFIG_HOME, permissions, or the foreign plugin conflict, then run \`viberacing uninstall\` or \`viberacing connect\` again.`,
  );
  error.pluginCleanup = cleanup;
  error.pluginPath = cleanup.failures.find((failure) => failure.path)?.path ?? null;
  return error;
}

function reportOpenCodeCleanupFailures(cleanup) {
  for (const failure of cleanup?.failures ?? []) {
    reportOpenCodePluginTransition(failure);
    if ((!failure.path || failure.status === "unresolved-location") && failure.message)
      warning(
        `Vibe Racing warning: OpenCode cleanup detail: ${sanitizeTerminalText(failure.message)}.`,
      );
  }
}

function blockedOpenCodePluginResult(error) {
  return {
    status: "unreadable",
    action: "blocked",
    error,
    path: error?.recoveryPath ?? error?.pluginPath ?? null,
    retentionError: error?.retentionError,
    retentionPaths: error?.retentionPaths ?? error?.recoveryPaths,
    pluginCleanup: error?.pluginCleanup,
  };
}

async function reconcileOpenCodePluginRetainingRecovery(options) {
  const journaledOptions = uuidPattern.test(options.installationId ?? "")
    ? {
        ...options,
        retainRecoveryPath:
          options.retainRecoveryPath ??
          ((path) => rememberOpenCodePluginCleanup(options.installationId, path)),
        releaseRecoveryPath:
          options.releaseRecoveryPath ??
          ((path) => clearOpenCodePluginCleanupTarget(options.installationId, path)),
        deferCanonicalRecoveryRelease:
          options.deferCanonicalRecoveryRelease ?? options.desired !== false,
      }
    : options;
  try {
    return await reconcileOpenCodePlugin(journaledOptions);
  } catch (error) {
    const recoveryPaths = [
      ...new Set([...(error?.recoveryPaths ?? []), error?.recoveryPath].filter(Boolean)),
    ];
    if (recoveryPaths.length > 0 && uuidPattern.test(options.installationId ?? ""))
      for (const recoveryPath of recoveryPaths)
        try {
          await rememberOpenCodePluginCleanup(options.installationId, recoveryPath);
        } catch (retentionError) {
          error.retentionError = retentionError;
          error.retentionPaths = [...new Set([...(error.retentionPaths ?? []), recoveryPath])];
        }
    throw error;
  }
}

async function rollbackUnrecordedOpenCodePlugin({
  installationId,
  currentPath,
  previousInspection,
  recordedPath,
}) {
  const failures = [];
  const retainFailure = async (message, path) => {
    let retentionError = null;
    try {
      await rememberOpenCodePluginCleanup(installationId, path);
    } catch (error) {
      retentionError = error;
    }
    failures.push({ message, path, retentionError });
  };
  try {
    const removed =
      process.env.NODE_ENV === "test" &&
      process.env.VIBERACING_TEST_BLOCK_OPENCODE_PLUGIN_ROLLBACK === "1"
        ? {
            status: "unreadable",
            action: "blocked",
            path: currentPath,
            error: new Error("Synthetic OpenCode plugin rollback block"),
          }
        : await reconcileOpenCodePluginRetainingRecovery({
            installationId,
            stateRoot: stateDirectory,
            pluginPath: currentPath,
            desired: false,
          });
    if (openCodePluginBlocked(removed))
      await retainFailure(
        `new plugin cleanup was blocked (${removed.status})`,
        removed.path ?? currentPath,
      );
  } catch (error) {
    await retainFailure(
      `new plugin cleanup failed (${error.message})`,
      error?.recoveryPath ?? error?.pluginPath ?? currentPath,
    );
  }
  if (previousInspection?.owned && recordedPath)
    try {
      const restored = await reconcileOpenCodePluginRetainingRecovery({
        installationId,
        stateRoot: stateDirectory,
        pluginPath: recordedPath,
        desired: true,
      });
      if (openCodePluginBlocked(restored))
        await retainFailure(
          `prior plugin restoration was blocked (${restored.status})`,
          restored.path ?? recordedPath,
        );
      else
        for (const recoveryPath of restored.recoveryPathsToRelease ?? [])
          try {
            await clearOpenCodePluginCleanupTarget(installationId, recoveryPath);
          } catch (error) {
            failures.push({
              message: `prior plugin recovery journal could not be cleared (${error.message})`,
              path: recoveryPath,
              retentionError: error,
            });
          }
    } catch (error) {
      await retainFailure(
        `prior plugin restoration failed (${error.message})`,
        error?.recoveryPath ?? error?.pluginPath ?? recordedPath,
      );
    }
  return failures;
}

async function reconcilePluginForConfig(config, options = {}) {
  if (options.skipPendingCleanup !== true) {
    const cleanup = await cleanupOpenCodePluginTargets();
    if (cleanup.failures.length > 0) throw pendingOpenCodeCleanupError(cleanup);
  }
  let installation = null;
  let installationError = null;
  try {
    installation = await readExistingInstallation();
  } catch (error) {
    installationError = error;
  }
  const installationId = options.installationId ?? config?.installationId ?? installation?.id;
  if (!uuidPattern.test(installationId ?? ""))
    return { status: "missing", action: "none", changed: false, path: null };
  const desired = options.desired ?? configWantsOpenCodePlugin(config, installationId);
  if (desired && installationError) throw installationError;
  if (desired && installation?.id !== installationId)
    throw new Error(
      "OpenCode plugin installation requires the matching local installation identity",
    );
  const recordedPath =
    options.pluginPath ??
    (installation?.id === installationId ? installation.openCodePluginPath : undefined);
  if (!desired && !recordedPath && options.cleanupUnrecorded !== true)
    return { status: "not-needed", action: "none", changed: false, path: null };
  const currentPath = desired ? openCodePluginLocation({ installationId }).path : null;
  let previousInspection = null;
  if (desired && recordedPath && !sameOpenCodePluginPath(recordedPath, currentPath)) {
    previousInspection = await inspectOpenCodePlugin({
      installationId,
      stateRoot: stateDirectory,
      pluginPath: recordedPath,
    });
    if (!previousInspection.owned && previousInspection.status !== "missing")
      return {
        status: previousInspection.status,
        action: "blocked",
        changed: false,
        path: recordedPath,
      };
  }
  const result = await reconcileOpenCodePluginRetainingRecovery({
    installationId,
    stateRoot: stateDirectory,
    ...(desired ? {} : { pluginPath: recordedPath }),
    desired,
  });
  if (
    desired &&
    result.status === "current" &&
    recordedPath &&
    !sameOpenCodePluginPath(recordedPath, result.path)
  ) {
    const currentInspection = await inspectOpenCodePlugin({
      installationId,
      stateRoot: stateDirectory,
      pluginPath: result.path,
    });
    if (currentInspection.status !== "current")
      return {
        status: currentInspection.status,
        action: "blocked",
        changed: result.changed,
        path: result.path,
      };
    if (!sameOpenCodePluginFile(previousInspection, currentInspection))
      try {
        const previous = await reconcileOpenCodePluginRetainingRecovery({
          installationId,
          stateRoot: stateDirectory,
          pluginPath: recordedPath,
          desired: false,
        });
        if (openCodePluginBlocked(previous)) {
          await reconcileOpenCodePluginRetainingRecovery({
            installationId,
            stateRoot: stateDirectory,
            pluginPath: result.path,
            desired: false,
          });
          return previous;
        }
      } catch (error) {
        await reconcileOpenCodePluginRetainingRecovery({
          installationId,
          stateRoot: stateDirectory,
          pluginPath: result.path,
          desired: false,
        });
        throw error;
      }
  }
  if (desired && result.status === "current") {
    let pluginPathRecorded = false;
    try {
      await rememberOpenCodePluginPath(
        installationId,
        result.path,
        process.env.NODE_ENV === "test" &&
          process.env.VIBERACING_TEST_FAIL_OPENCODE_PLUGIN_PATH_COMMIT === "1"
          ? {
              beforeRename() {
                throw new Error("Synthetic OpenCode plugin path commit failure");
              },
            }
          : undefined,
      );
      pluginPathRecorded = true;
      for (const recoveryPath of result.recoveryPathsToRelease ?? [])
        if (
          process.env.NODE_ENV === "test" &&
          process.env.VIBERACING_TEST_FAIL_OPENCODE_CANONICAL_JOURNAL_CLEAR === "1"
        )
          throw new Error("Synthetic OpenCode canonical journal clear failure");
        else await clearOpenCodePluginCleanupTarget(installationId, recoveryPath);
    } catch (error) {
      if (pluginPathRecorded) {
        const failure = new Error(
          `OpenCode plugin recovery journal could not be cleared: ${error.message}`,
        );
        failure.pluginPath = result.path;
        failure.recoveryPaths = result.recoveryPathsToRelease ?? [result.path];
        failure.cause = error;
        throw failure;
      }
      const rollbackFailures = await rollbackUnrecordedOpenCodePlugin({
        installationId,
        currentPath: result.path,
        previousInspection,
        recordedPath,
      });
      const rollback = rollbackFailures.length
        ? `; rollback incomplete: ${rollbackFailures.map((item) => item.message).join("; ")}`
        : "; plugin changes were rolled back";
      const failure = new Error(
        `OpenCode plugin path could not be recorded: ${error.message}${rollback}`,
      );
      failure.pluginPath = result.path;
      failure.rollbackFailures = rollbackFailures;
      failure.retentionError = rollbackFailures.find((item) => item.retentionError)?.retentionError;
      failure.retentionPaths = rollbackFailures
        .filter((item) => item.retentionError)
        .map((item) => item.path);
      failure.cause = error;
      throw failure;
    }
    delete result.recoveryPathsToRelease;
  }
  return result;
}

function reportOpenCodePluginTransition(result, { connected = false } = {}) {
  if (result?.action === "created" || result?.action === "updated") {
    output("Restart OpenCode once to activate automatic Vibe Racing sync.");
    return;
  }
  if (!openCodePluginBlocked(result)) return;
  const path = result.path ? ` at ${result.path}` : "";
  warning(
    connected
      ? `Vibe Racing warning: connection is active, but OpenCode automatic sync plugin repair is required${path}. Run \`viberacing doctor --repair\`.`
      : `Vibe Racing warning: the owned OpenCode automatic sync plugin could not be cleaned${path}; inspect that path manually.`,
  );
  if (result.retentionError) {
    const retentionPaths = result.retentionPaths?.length
      ? result.retentionPaths
      : result.path
        ? [result.path]
        : [];
    if (retentionPaths.length === 0)
      warning(
        `Vibe Racing warning: OpenCode cleanup metadata could not be retained (${result.retentionError.message}); keep the reported path for manual cleanup.`,
      );
    else
      for (const retentionPath of retentionPaths)
        warning(
          `Vibe Racing warning: OpenCode cleanup metadata could not be retained for the exact path ${retentionPath} (${result.retentionError.message}); keep that path for manual cleanup.`,
        );
  }
}

async function waitForTestConnectBarrier(stage) {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.VIBERACING_TEST_CONNECT_PAUSE !== stage ||
    !process.env.VIBERACING_TEST_CONNECT_BARRIER
  )
    return;
  const barrier = process.env.VIBERACING_TEST_CONNECT_BARRIER;
  await writeFile(`${barrier}.ready`, `${process.pid}\n`, { mode: 0o600 });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await readFile(`${barrier}.continue`);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await delay(10);
  }
  throw new Error("Timed out at connect test barrier");
}

async function waitForTestOpenCodePreflightBarrier(stage) {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.VIBERACING_TEST_OPENCODE_PREFLIGHT_PAUSE !== stage ||
    !process.env.VIBERACING_TEST_OPENCODE_PREFLIGHT_BARRIER
  )
    return;
  const barrier = resolve(process.env.VIBERACING_TEST_OPENCODE_PREFLIGHT_BARRIER);
  await writeFile(`${barrier}.ready`, `${process.pid}\n`, { mode: 0o600 });
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      await readFile(`${barrier}.continue`);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (Date.now() >= deadline) throw new Error("Timed out at OpenCode preflight test barrier");
    await delay(10);
  }
}

async function withOpenCodeLifecycleMutation(callback, options = {}) {
  return withLifecycleMutation(callback, {
    ...options,
    afterExclusion: () => assertOpenCodeUpgradeReady(stateDirectory),
  });
}

function commandRequiresOpenCodeGuard() {
  if (command === "connect" || command === "sync") return true;
  if (command === "auto-sync" || command === "handle-url" || command === "doctor") return true;
  if (command === "reset-installation") return true;
  if (command === "run" && arguments_[1] === "antigravity") return true;
  return command === "source" && ["add", "remove"].includes(arguments_[1]);
}

async function readConnectedConfig() {
  try {
    return await readConfig();
  } catch (error) {
    if (error?.code === "ENOENT")
      throw new Error(
        "This computer is not connected. Run `viberacing connect --origin <your Vibe Racing URL>`.",
      );
    throw error;
  }
}

function retryAfterMilliseconds(response) {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return null;
  let milliseconds;
  if (/^\d+$/.test(value)) milliseconds = Number(value) * 1_000;
  else {
    const date = Date.parse(value);
    if (Number.isNaN(date)) return null;
    milliseconds = Math.max(0, date - Date.now());
  }
  const maximum =
    process.env.NODE_ENV === "test" &&
    /^\d+$/.test(process.env.VIBERACING_TEST_MAX_RETRY_AFTER_MS ?? "")
      ? Number(process.env.VIBERACING_TEST_MAX_RETRY_AFTER_MS)
      : 300_000;
  return Math.min(maximum, milliseconds);
}

async function request(origin, path, options = {}, attempts = 1, responseContext) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${origin}${path}`, {
        ...options,
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      let payload;
      try {
        payload = await parseProtocolResponse(response, responseContext);
      } catch (error) {
        if (
          error?.code === "invalid_server_response" &&
          (response.status >= 500 || response.status === 429)
        ) {
          error.status = response.status;
          error.retryAfterMs = retryAfterMilliseconds(response);
        }
        throw error;
      }
      if (!response.ok) {
        const error = new Error(
          `Vibe Racing returned ${response.status}: ${payload.error ?? "request failed"}`,
        );
        error.status = response.status;
        error.code = payload.error;
        error.retryAfterMs = retryAfterMilliseconds(response);
        if (response.status < 500 && response.status !== 429) throw error;
        lastError = error;
      } else return payload;
    } catch (error) {
      lastError = error;
      if (
        error?.code === "invalid_server_response" &&
        !(error?.status >= 500 || error?.status === 429)
      )
        throw error;
      if (error?.status && error.status < 500 && error.status !== 429) throw error;
    }
    if (attempt + 1 < attempts) {
      const retryAfter = Number.isFinite(lastError?.retryAfterMs) ? lastError.retryAfterMs : 0;
      const backoff = Math.min(8_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
      await delay(Math.max(retryAfter, backoff));
    }
  }
  throw lastError;
}

async function requestPairingStart(origin, installationId, body) {
  const send = (payload) =>
    request(
      origin,
      "/api/pairing/start",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      1,
      { kind: "pairingStart", origin, installationId },
    );
  try {
    return await send(body);
  } catch (error) {
    if (
      error?.status !== 400 ||
      error?.code !== "invalid_request" ||
      !Object.hasOwn(body, "browserSyncProtocol")
    ) {
      throw error;
    }
    const legacyBody = { ...body };
    delete legacyBody.browserSyncProtocol;
    delete legacyBody.installedRuntimeVersion;
    return send(legacyBody);
  }
}

function validLocalHandlerAttestation(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([
        "attestationId",
        "browserSyncProtocol",
        "installedRuntimeVersion",
        "pending",
      ]) &&
    uuidPattern.test(value.attestationId ?? "") &&
    (value.installedRuntimeVersion === null ||
      semanticVersionPattern.test(value.installedRuntimeVersion ?? "")) &&
    Number.isSafeInteger(value.browserSyncProtocol) &&
    value.browserSyncProtocol >= 0 &&
    value.browserSyncProtocol <= browserSyncProtocolVersion &&
    typeof value.pending === "boolean"
  );
}

function publicHandlerAttestation(value) {
  if (!validLocalHandlerAttestation(value) || !value.pending) return null;
  return {
    attestationId: value.attestationId,
    installedRuntimeVersion: value.installedRuntimeVersion,
    browserSyncProtocol: value.browserSyncProtocol,
  };
}

async function recordInstalledHandlerAttestation(
  installedRuntimeVersion,
  browserSyncProtocol,
  options = {},
) {
  if (
    !(
      installedRuntimeVersion === null || semanticVersionPattern.test(installedRuntimeVersion ?? "")
    ) ||
    !Number.isSafeInteger(browserSyncProtocol) ||
    browserSyncProtocol < 0 ||
    browserSyncProtocol > browserSyncProtocolVersion
  ) {
    throw new Error("Invalid installed handler attestation");
  }
  const state = await readState();
  const previous = validLocalHandlerAttestation(state.handlerAttestation)
    ? state.handlerAttestation
    : null;
  if (
    !options.force &&
    previous?.installedRuntimeVersion === installedRuntimeVersion &&
    previous.browserSyncProtocol === browserSyncProtocol
  ) {
    return previous;
  }
  state.handlerAttestation = {
    attestationId: randomUUID(),
    installedRuntimeVersion,
    browserSyncProtocol,
    pending: true,
  };
  await writeState(state);
  return state.handlerAttestation;
}

async function refreshInstalledHandlerAttestation(options = {}) {
  const state = await readState();
  if (resolve(stateDirectory) !== resolve(join(homedir(), ".viberacing"))) {
    return { inspectionFailed: false, observed: null, state };
  }
  let observed;
  try {
    observed = await browserSyncHandlerAttestation();
  } catch {
    if (state.handlerInspectionDiagnostic !== handlerInspectionDiagnostic) {
      state.handlerInspectionDiagnostic = handlerInspectionDiagnostic;
      await writeState(state).catch(() => {});
    }
    return { inspectionFailed: true, observed: null, state };
  }
  const previous = validLocalHandlerAttestation(state.handlerAttestation)
    ? state.handlerAttestation
    : null;
  let changed = false;
  if (
    options.force ||
    previous === null ||
    observed.runtimeVersion !== previous.installedRuntimeVersion ||
    observed.protocol !== previous.browserSyncProtocol
  ) {
    state.handlerAttestation = {
      attestationId: randomUUID(),
      installedRuntimeVersion: observed.runtimeVersion,
      browserSyncProtocol: observed.protocol,
      pending: true,
    };
    changed = true;
  }
  if (Object.hasOwn(state, "handlerInspectionDiagnostic")) {
    delete state.handlerInspectionDiagnostic;
    changed = true;
  }
  if (changed) await writeState(state);
  return { inspectionFailed: false, observed, state };
}

async function acknowledgeInstalledHandlerAttestation(attestationId) {
  if (!uuidPattern.test(attestationId ?? "")) return;
  const state = await readState();
  if (
    !validLocalHandlerAttestation(state.handlerAttestation) ||
    state.handlerAttestation.attestationId !== attestationId ||
    !state.handlerAttestation.pending
  ) {
    return;
  }
  state.handlerAttestation.pending = false;
  await writeState(state);
}

async function cancelPairingAttempt(attempt) {
  if (
    attempt === null ||
    typeof attempt?.origin !== "string" ||
    typeof attempt?.installationId !== "string" ||
    typeof attempt?.pollToken !== "string"
  )
    return { status: "not_needed" };
  try {
    await request(
      attempt.origin,
      "/api/pairing/cancel",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationId: attempt.installationId,
          pollToken: attempt.pollToken,
        }),
      },
      1,
      { kind: "empty" },
    );
    return { status: "confirmed" };
  } catch (error) {
    return { status: "unconfirmed", error };
  }
}

async function invalidateAndCancelConnectAttempt() {
  const attempt = await invalidateConnectAttempt();
  return { attempt, cancellation: await cancelPairingAttempt(attempt) };
}

function publicSource(source) {
  return {
    clientSourceId: source.clientSourceId,
    agentId: source.agentId,
    collectionMethod: source.collectionMethod,
    supportedSurface: source.supportedSurface,
    suggestedLabel: source.suggestedLabel,
  };
}

async function exactPairingSources(sources) {
  const result = [];
  for (const source of sources) {
    if (source.agentId === "codex" && source.profileClientSourceId !== undefined) continue;
    const adapter = adapterFor(source.agentId);
    if (!adapter || adapter.exactAccounting === false) continue;
    if (source.agentId === "antigravity") {
      result.push(source);
      continue;
    }
    try {
      const diagnostic = await adapter.diagnose(source);
      if (diagnostic.status === "ok" && diagnostic.dataLocationAvailable !== false)
        result.push(source);
    } catch {}
  }
  return result;
}

async function existingConnectionIdentityForPairing() {
  let previousConfig;
  try {
    previousConfig = await readConfig();
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!uuidPattern.test(previousConfig.installationId ?? ""))
    return { previousConfig, installation: null, identityError: null, reconcilable: false };

  let installation = null;
  let identityError = null;
  try {
    installation = await readExistingInstallation();
  } catch (error) {
    identityError = error;
  }
  return { previousConfig, installation, identityError, reconcilable: true };
}

function existingConnectionIdentityMismatchError(identityError) {
  const error = new Error(
    "The existing connection has no strictly matching local installation identity. Run `viberacing disconnect` or `viberacing uninstall` to revoke and clean up the previous installation before connecting again.",
  );
  if (identityError) error.cause = identityError;
  return error;
}

async function reconcilePreviousConnectionBeforePairing(origin) {
  return withOpenCodeLifecycleMutation(async () => {
    const previous = await existingConnectionIdentityForPairing();
    if (previous === null)
      return {
        previousConfig: null,
        installation: null,
        connectionSnapshot: connectionSnapshot(null),
      };
    const { previousConfig, installation, identityError, reconcilable } = previous;
    if (!reconcilable)
      return {
        previousConfig: null,
        installation: null,
        connectionSnapshot: connectionSnapshot(previousConfig),
      };
    const matchingInstallation = installation?.id === previousConfig.installationId;
    if (previousConfig.origin !== origin) {
      if (!matchingInstallation) throw existingConnectionIdentityMismatchError(identityError);
      return {
        previousConfig: null,
        installation,
        connectionSnapshot: connectionSnapshot(previousConfig),
      };
    }
    let remote;
    try {
      remote = await requestReconciliation(previousConfig, 1, undefined, {
        beforeResponseMutation: assertOpenCodeRemoteSequenceReady,
      });
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        const cleanup = await disableLocalConnection(true);
        reportOpenCodeCleanupFailures(cleanup.pluginCleanup);
        if (!cleanup.authorizationRemoved)
          throw new Error(
            "Previous installation authorization is no longer valid, but the local token file could not be removed; repair its permissions before reconnecting",
          );
        output("Previous installation authorization is no longer valid; reconnecting…");
        if (cleanup.warningCount)
          warning(
            "Vibe Racing warning: local authorization was removed, but one or more auxiliary cleanup steps need manual inspection.",
          );
        return {
          previousConfig: null,
          installation: null,
          connectionSnapshot: connectionSnapshot(null),
        };
      }
      throw error;
    }
    if (!matchingInstallation) throw existingConnectionIdentityMismatchError(identityError);
    await reconcileRemoteSources(previousConfig, remote.sources, { allowDuringLifecycle: true });
    return {
      previousConfig,
      installation,
      connectionSnapshot: connectionSnapshot(previousConfig),
    };
  });
}

async function connect() {
  await assertOpenCodeUpgradeReady(stateDirectory);
  const pendingCleanup = await withOpenCodeLifecycleMutation(() => cleanupOpenCodePluginTargets());
  if (pendingCleanup.failures.length > 0) throw pendingOpenCodeCleanupError(pendingCleanup);
  const origin = normalizeOrigin(option("--origin", officialProductionOrigin), "--origin");
  const previousConnection = await reconcilePreviousConnectionBeforePairing(origin);
  await waitForTestConnectBarrier("after_previous_connection_reconciliation");
  const previousConfig = previousConnection?.previousConfig ?? null;
  output("Detecting supported agent sources…");
  const discovery = await discoverSources();
  const detected = discovery.sources;
  for (const diagnostic of discovery.diagnostics)
    warning(`Vibe Racing warning: ${diagnostic.displayName}: ${diagnostic.error}.`);
  const sourcesBeforeDiscovery = await readSources();
  const localSources = await reconcileDetectedSources(detected, { persist: false });
  const localSourceIds = new Set(localSources.map((source) => source.clientSourceId));
  const supersededClientSourceIds = sourcesBeforeDiscovery
    .filter(
      (source) =>
        !localSourceIds.has(source.clientSourceId) &&
        !(source.agentId === "codex" && source.profileClientSourceId !== undefined),
    )
    .map((source) => source.clientSourceId);
  const exactSources = await exactPairingSources(localSources);
  const sources = new Map(exactSources.map((source) => [source.clientSourceId, source]));
  if (exactSources.length === 0)
    throw new Error(
      "No exact token source was found yet. Run a supported agent at least once, or add its token data root explicitly. Try `viberacing doctor` or `viberacing source add --agent <agent> --name <label> --data-dir <usage-root>`.",
    );
  const { installedRuntime, browserSyncCapable } = await withOpenCodeLifecycleMutation(async () => {
    const pending = await cleanupOpenCodePluginTargets();
    if (pending.failures.length > 0) throw pendingOpenCodeCleanupError(pending);
    const runtime = await prepareRuntime(import.meta.url);
    const browserCapable = await registerBrowserSync(runtime);
    await invalidateAndCancelConnectAttempt();
    return {
      installedRuntime: runtime,
      browserSyncCapable: browserCapable,
    };
  });
  if (!browserSyncCapable)
    warning(
      "Vibe Racing warning: browser Sync could not be registered; CLI sync remains available.",
    );
  const installation =
    previousConnection?.installation ??
    (await withOpenCodeLifecycleMutation(async () => {
      const pending = await cleanupOpenCodePluginTargets();
      if (pending.failures.length > 0) throw pendingOpenCodeCleanupError(pending);
      return readOrCreateInstallation();
    }));
  const pairingLocalSources = new Map(sources);
  if (previousConfig !== null) {
    const localById = new Map(localSources.map((source) => [source.clientSourceId, source]));
    for (const previous of previousConfig.sources) {
      const local = localById.get(previous.clientSourceId);
      if (local?.agentId === "codex" && local.profileClientSourceId !== undefined) continue;
      if (
        local &&
        local.agentId === previous.agentId &&
        local.collectionMethod === previous.collectionMethod
      ) {
        pairingLocalSources.set(previous.clientSourceId, {
          ...local,
          sourceId: previous.sourceId,
        });
      }
    }
  }
  output(`Found: ${[...sources.values()].map((source) => source.suggestedLabel).join(", ")}`);
  await waitForTestConnectBarrier("before_begin_connect_attempt");
  const initialAttempt = await withOpenCodeLifecycleMutation(async () => {
    const pending = await cleanupOpenCodePluginTargets();
    if (pending.failures.length > 0) throw pendingOpenCodeCleanupError(pending);
    return beginConnectAttempt({
      installationId: installation.id,
      origin,
      expectedSources: sourcesBeforeDiscovery,
      expectedConnectionSnapshot:
        previousConnection?.connectionSnapshot ?? connectionSnapshot(null),
    });
  });
  let attempt = initialAttempt;
  let pairing;
  let committed = false;
  let openCodePluginResult;
  try {
    ({ pairing, attempt } = await withOpenCodeLifecycleMutation(async () => {
      const started = await requestPairingStart(origin, installation.id, {
        protocolVersion,
        connectorVersion,
        installationId: installation.id,
        installationSecret: installation.secret,
        sources: [...sources.values()].map(publicSource),
        supersededClientSourceIds,
        browserSyncCapable,
        browserSyncProtocol: browserSyncCapable ? browserSyncProtocolVersion : 0,
        installedRuntimeVersion: connectorVersion,
      });
      return {
        pairing: started,
        attempt: await recordConnectAttemptPairing(initialAttempt, started.pollToken),
      };
    }));
    await waitForTestConnectBarrier("after_pairing_start");
    output(`Open ${pairing.verificationUrl}`);
    output(`Pairing code: ${pairing.code}`);
    openBrowser(pairing.verificationUrl);
    const deadline = Date.now() + pairing.expiresInSeconds * 1_000;
    while (Date.now() < deadline) {
      await delay(pairingPollIntervalMs);
      const result = await request(
        origin,
        "/api/pairing/poll",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            installationId: pairing.installationId,
            pollToken: pairing.pollToken,
          }),
        },
        1,
        {
          kind: "pairingPoll",
          localSources: [...pairingLocalSources.values()],
          requiredClientSourceIds: [...pairingLocalSources.keys()],
        },
      );
      if (result.status === "active") {
        await waitForTestConnectBarrier("after_active_poll");
        const config = await withOpenCodeLifecycleMutation(async () => {
          const localById = new Map(localSources.map((source) => [source.clientSourceId, source]));
          const mapped = result.sources.map((mapping) => {
            const local = localById.get(mapping.clientSourceId);
            if (!local) throw new Error("Paired source is no longer configured locally");
            if (
              local.agentId !== mapping.agentId ||
              local.collectionMethod !== mapping.collectionMethod
            )
              throw new Error("Paired source identity changed");
            return {
              ...local,
              sourceId: mapping.sourceId,
              agentAccountId: mapping.agentAccountId,
              accountLabel: mapping.accountLabel,
              lastAcceptedSyncSequence: mapping.lastAcceptedSyncSequence,
              historyBackfillYear: mapping.historyBackfillYear,
              historyBackfillStatus: mapping.historyBackfillStatus,
            };
          });
          const nextConfig = {
            version: 2,
            origin,
            installationId: pairing.installationId,
            deviceToken: result.deviceToken,
            sources: mapped,
            protocol: result.protocol,
          };
          for (const local of localSources) {
            if (local.agentId !== "codex" || local.profileClientSourceId === undefined) continue;
            const profile = nextConfig.sources.find(
              (source) => source.clientSourceId === local.profileClientSourceId,
            );
            if (!profile)
              throw new Error("Codex logical source profile was not paired on this installation");
            const registered = await requestCodexLogicalSourceRegistration(
              nextConfig,
              local,
              profile,
            );
            if (registered.profileSourceId !== profile.sourceId)
              throw new Error("Codex logical source profile mapping changed during pairing");
            nextConfig.sources.push(registered);
          }
          const currentLocalSources = await commitConnectionState(nextConfig, localSources, {
            connectAttempt: attempt,
            beforeCommit:
              process.env.NODE_ENV === "test" &&
              process.env.VIBERACING_TEST_FAIL_CONNECTION_CONFIG_COMMIT === "1"
                ? () => {
                    throw new Error("Synthetic connection config commit failure");
                  }
                : undefined,
            afterConfigCommit:
              process.env.NODE_ENV === "test" &&
              process.env.VIBERACING_TEST_INTERRUPT_AFTER_CONNECTION_COMMIT === "1"
                ? () => process.exit(86)
                : undefined,
          });
          const knownForHookCleanup = [
            ...currentLocalSources,
            ...sourcesBeforeDiscovery.filter(
              (previous) =>
                !currentLocalSources.some(
                  (current) => current.clientSourceId === previous.clientSourceId,
                ),
            ),
          ];
          const hooks = await reconcileHooks(
            import.meta.url,
            nextConfig.sources,
            knownForHookCleanup,
            {
              installedScript: installedRuntime,
            },
          );
          for (const failure of hooks.failures)
            warning(
              `Vibe Racing warning: ${failure.agentId ?? "connector"} hook: ${failure.message}.`,
            );
          try {
            openCodePluginResult = await reconcilePluginForConfig(nextConfig, {
              installationId: installation.id,
            });
          } catch (error) {
            openCodePluginResult = blockedOpenCodePluginResult(error);
          }
          await confirmAutomaticCompatibility();
          return nextConfig;
        });
        committed = true;
        await refreshInstalledHandlerAttestation({ force: true });
        output("Connected.");
        const initial = await sync(config, { waitMs: automaticSyncLockWaitMs });
        if (initial?.skipped) throw new Error("Timed out waiting to start the initial sync");
        const hookStatuses = await diagnoseHooks(config.sources);
        const guidance = codexHookGuidance(hookStatuses.codex);
        if (guidance) warning(`Vibe Racing warning: ${guidance}`);
        reportOpenCodePluginTransition(openCodePluginResult, { connected: true });
        if (!guidance && openCodePluginResult?.action === "none") {
          if (
            configWantsOpenCodePlugin(config, installation.id) &&
            openCodePluginResult.status === "current"
          )
            output(
              "OpenCode automatic sync plugin is installed and current. Restart OpenCode if it has been running since the plugin was installed or updated.",
            );
          else if (
            !configWantsOpenCodePlugin(config, installation.id) &&
            openCodePluginResult.status === "not-needed"
          )
            output("Automatic exact aggregate sync is active.");
        }
        return;
      }
      if (result.status !== "pending") throw new Error("Pairing was revoked");
    }
    throw new Error("Pairing expired");
  } finally {
    if (!committed) {
      await cancelPairingAttempt(
        pairing === undefined ? attempt : { ...attempt, pollToken: pairing.pollToken },
      );
      await clearConnectAttempt(attempt).catch(() => {});
    }
  }
}

function snapshotRange(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  if (start < yearStart) start.setTime(yearStart.valueOf());
  return { rangeStart: start.toISOString().slice(0, 10), rangeEnd: end.toISOString().slice(0, 10) };
}

function addUtcDays(date, days) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ||
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== date ||
    !Number.isSafeInteger(days)
  )
    throw new Error("Invalid UTC date range");
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function currentHistoryYear(now = new Date()) {
  return now.getUTCFullYear();
}

function historyYearStart(year) {
  return `${String(year).padStart(4, "0")}-01-01`;
}

function historyRangeEndingAt(rangeEnd, year) {
  const firstCandidate = addUtcDays(rangeEnd, -30);
  const yearStart = historyYearStart(year);
  return { rangeStart: firstCandidate < yearStart ? yearStart : firstCandidate, rangeEnd };
}

function historySnapshotState(sourceId, range, completeness, state, kind) {
  const year = Number(range.rangeEnd.slice(0, 4));
  const yearStart = historyYearStart(year);
  if (kind === "rolling") {
    if (range.rangeStart !== yearStart) return { snapshot: {}, advance: null };
    return {
      snapshot: { historyYearComplete: completeness },
      advance: {
        sourceId,
        year,
        nextRangeEnd: null,
        hadPartialChunk: completeness === "partial",
        terminalStatus: completeness,
      },
    };
  }
  const cursor = state.history?.[sourceId];
  if (cursor?.year !== year || cursor.nextRangeEnd !== range.rangeEnd)
    throw new Error("Current-year history cursor changed during collection");
  const hadPartialChunk = cursor.hadPartialChunk || completeness === "partial";
  const terminalStatus =
    range.rangeStart === yearStart ? (hadPartialChunk ? "partial" : "complete") : null;
  return {
    snapshot: terminalStatus === null ? {} : { historyYearComplete: terminalStatus },
    advance: {
      sourceId,
      year,
      nextRangeEnd: terminalStatus === null ? addUtcDays(range.rangeStart, -1) : null,
      hadPartialChunk,
      terminalStatus,
    },
  };
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function deliver(config, payload) {
  if (await lifecycleMutationActive())
    throw new Error("Sync delivery stopped by a local lifecycle operation");
  return request(
    config.origin,
    "/api/usage",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.deviceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    3,
    {
      kind: "usage",
      sourceIds: [
        ...(payload.snapshots ?? []).map((snapshot) => snapshot.sourceId),
        ...(payload.sourceErrors ?? []).map((sourceError) => sourceError.sourceId),
      ],
      protocolVersion: payload.protocolVersion,
    },
  );
}

async function deliverDiagnosticOutbox(config, allowedSourceIds) {
  let attempted = false;
  try {
    const configuredSourceIds = config.sources
      .map((source) => source.sourceId)
      .filter((sourceId) => typeof sourceId === "string");
    const allowed = allowedSourceIds ? new Set(allowedSourceIds) : undefined;
    const eligibleSourceIds = allowed
      ? configuredSourceIds.filter((sourceId) => allowed.has(sourceId))
      : configuredSourceIds;
    const state = await readState();
    const events = pendingDiagnosticEvents(state, configuredSourceIds, 32, eligibleSourceIds);
    await writeState(state);
    if (events.length === 0 || (await lifecycleMutationActive())) {
      return { attempted, delivered: 0 };
    }
    attempted = true;
    await request(
      config.origin,
      "/api/installations/current/diagnostics",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.deviceToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ schemaVersion: 1, connectorVersion, events }),
      },
      1,
      { kind: "diagnostics", expectedEvents: events.length },
    );
    const current = await readState();
    acknowledgeDiagnosticEvents(current, events);
    await writeState(current);
    return { attempted, delivered: events.length };
  } catch {
    // Diagnostics are best-effort and must never affect usage delivery or recurse.
    return { attempted, delivered: 0 };
  }
}

async function finishSuccessfulSourceDiagnostics(config, sourceIds, allowedSourceIds) {
  try {
    if (sourceIds.length > 0) {
      const state = await readState();
      for (const sourceId of sourceIds) reconcileDiagnosticPhase(state, sourceId, "sync", []);
      await writeState(state);
    }
  } catch {}
  return deliverDiagnosticOutbox(config, allowedSourceIds);
}

function pendingSourceId(payload) {
  const ids = [
    ...(payload.snapshots ?? []).map((snapshot) => snapshot.sourceId),
    ...(payload.sourceErrors ?? []).map((sourceError) => sourceError.sourceId),
  ];
  return ids.length === 1 && typeof ids[0] === "string" ? ids[0] : null;
}

function isLegacyPendingSourceError(payload) {
  return (
    (payload.protocolVersion === 2 || payload.protocolVersion === 3) &&
    (payload.snapshots?.length ?? 0) === 0 &&
    (payload.sourceErrors?.length ?? 0) > 0
  );
}

async function forgetSourceState(sourceIds) {
  const state = await readState();
  state.sequences ??= {};
  state.adapters ??= {};
  state.fingerprints ??= {};
  state.quarantine ??= {};
  state.collectionWarnings ??= {};
  for (const sourceId of sourceIds) {
    delete state.sequences[sourceId];
    delete state.adapters[sourceId];
    delete state.fingerprints[sourceId];
    delete state.quarantine[sourceId];
    delete state.collectionWarnings[sourceId];
    forgetSourceDiagnostics(state, sourceId);
    await removePendingForSource(sourceId);
    await clearQuarantine(sourceId);
  }
  await writeState(state);
}

async function retireMappedSources(config, sourceIds, options = {}) {
  if (!options.allowDuringLifecycle && (await lifecycleMutationActive()))
    throw new Error("Source retirement stopped by a local lifecycle operation");
  const retired = new Set(sourceIds);
  const mappings = config.sources.filter((source) => retired.has(source.sourceId));
  for (const source of mappings)
    try {
      const physicalStillMapped =
        source.agentId === "codex" &&
        source.profileClientSourceId === undefined &&
        config.sources.some(
          (candidate) =>
            !retired.has(candidate.sourceId) &&
            candidate.profileClientSourceId === source.clientSourceId,
        );
      if (!physicalStillMapped) await removeHookForSource(source, { removeLegacy: true });
    } catch (error) {
      warning(
        `Vibe Racing warning: hook cleanup failed for disconnected ${source.agentId} source: ${error.message}`,
      );
    }
  await clearDirtyForSources(mappings.map((source) => source.clientSourceId));
  await forgetSourceState(mappings.map((source) => source.sourceId));
  config.sources = config.sources.filter((source) => !retired.has(source.sourceId));
  await writeConfig(config);
  try {
    reportOpenCodePluginTransition(
      await reconcilePluginForConfig(config, {
        cleanupUnrecorded: mappings.some((source) => source.agentId === "opencode"),
      }),
      { connected: true },
    );
  } catch (error) {
    reportOpenCodePluginTransition(blockedOpenCodePluginResult(error), { connected: true });
  }
  return mappings;
}

function openCodeServerSequences(remote) {
  return Object.fromEntries(
    (remote.sources ?? []).map((source) => [source.sourceId, source.lastAcceptedSyncSequence]),
  );
}

function assertOpenCodeRemoteSequenceReady(remote) {
  return assertOpenCodeUpgradeReady(stateDirectory, {
    serverSequences: openCodeServerSequences(remote),
  });
}

async function requestReconciliation(config, attempts = 1, bootstrapSourceIds, options = {}) {
  const sourceIds = config.sources.map((source) => source.sourceId);
  const inspection = await refreshInstalledHandlerAttestation();
  const handlerAttestation = inspection.inspectionFailed
    ? null
    : publicHandlerAttestation(inspection.state.handlerAttestation);
  const body = {
    sourceIds,
    ...(bootstrapSourceIds === undefined ? {} : { bootstrapSourceIds }),
    cliVersion: connectorVersion,
    protocolVersion,
    ...(handlerAttestation === null ? {} : { handlerAttestation }),
  };
  const send = (payload, requestAttempts, attestationId) =>
    request(
      config.origin,
      "/api/installations/current",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.deviceToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      requestAttempts,
      {
        kind: "reconciliation",
        sourceIds,
        protocolVersion: payload.protocolVersion ?? 4,
        handlerAttestationId: attestationId,
        ...(payload.bootstrapSourceIds === undefined
          ? {}
          : { bootstrapSourceIds: payload.bootstrapSourceIds }),
      },
    );
  try {
    const remote = await send(body, attempts, handlerAttestation?.attestationId);
    await options.beforeResponseMutation?.(remote);
    if (handlerAttestation !== null) {
      await acknowledgeInstalledHandlerAttestation(remote.acceptedHandlerAttestationId);
    }
    return remote;
  } catch (error) {
    if (error?.status !== 400 || error?.code !== "invalid_request") {
      throw error;
    }
    if (bootstrapSourceIds !== undefined) throw error;
    const remote = await send({ sourceIds, connectorVersion }, 1);
    await options.beforeResponseMutation?.(remote);
    return remote;
  }
}

async function reconcileRemoteSources(config, remoteSources, options = {}) {
  const configured = new Set(config.sources.map((source) => source.sourceId));
  const retired = (remoteSources ?? [])
    .filter((source) => source.status === "disconnected" && configured.has(source.sourceId))
    .map((source) => source.sourceId);
  if (retired.length > 0) await retireMappedSources(config, retired, options);
}

async function compactSuccessfulCaptures(config) {
  const state = await readState();
  const pending = new Set(
    (await pendingPayloads()).map((path) => path.split(/[\\/]/).at(-1)?.split(".")[0]),
  );
  for (const source of config.sources) {
    if (
      source.collectionMethod !== "antigravity_cli_capture" ||
      typeof source.dataPath !== "string" ||
      pending.has(source.sourceId) ||
      state.quarantine?.[source.sourceId]
    )
      continue;
    await compactCapture(source.dataPath);
  }
}

async function rememberServerSequences(config, sequences) {
  if (await lifecycleMutationActive())
    throw new Error("Sequence reconciliation stopped by a local lifecycle operation");
  const state = await readState();
  if (!Array.isArray(sequences) || sequences.length === 0) return state;
  state.sequences ??= {};
  const byId = new Map(sequences.map((item) => [item.sourceId, item.lastAcceptedSyncSequence]));
  const statusById = new Map(sequences.map((item) => [item.sourceId, item]));
  let changed = false;
  for (const source of config.sources) {
    const reported = byId.get(source.sourceId);
    if (typeof reported !== "string" || !/^(?:0|[1-9]\d*)$/.test(reported)) continue;
    const local = state.sequences[source.sourceId] ?? "0";
    const reconciled = BigInt(local) > BigInt(reported) ? local : reported;
    if (state.sequences[source.sourceId] !== reconciled) {
      state.sequences[source.sourceId] = reconciled;
      changed = true;
    }
    if (source.lastAcceptedSyncSequence !== reported) {
      source.lastAcceptedSyncSequence = reported;
      changed = true;
    }
    const status = statusById.get(source.sourceId);
    if (
      Number.isSafeInteger(status?.historyBackfillYear) &&
      ["pending", "complete", "partial"].includes(status?.historyBackfillStatus) &&
      (source.historyBackfillYear !== status.historyBackfillYear ||
        source.historyBackfillStatus !== status.historyBackfillStatus)
    ) {
      source.historyBackfillYear = status.historyBackfillYear;
      source.historyBackfillStatus = status.historyBackfillStatus;
      changed = true;
    }
  }
  if (changed) {
    await writeState(state);
    await writeConfig(config);
  }
  return state;
}

function reconcileHistoryCursors(config, state, now = new Date()) {
  const year = currentHistoryYear(now);
  const yearStart = historyYearStart(year);
  const firstHistoricalEnd = addUtcDays(snapshotRange(now).rangeStart, -1);
  state.history ??= {};
  state.historyAdapters ??= {};
  const configured = new Set(config.sources.map((source) => source.sourceId));
  let changed = false;
  for (const sourceId of Object.keys(state.history))
    if (!configured.has(sourceId)) {
      delete state.history[sourceId];
      delete state.historyAdapters[sourceId];
      changed = true;
    }
  for (const source of config.sources) {
    if (typeof source.sourceId !== "string") continue;
    const terminal =
      source.historyBackfillYear === year &&
      ["complete", "partial"].includes(source.historyBackfillStatus);
    if (terminal || firstHistoricalEnd < yearStart) {
      if (state.history[source.sourceId] !== undefined) {
        delete state.history[source.sourceId];
        delete state.historyAdapters[source.sourceId];
        changed = true;
      }
      continue;
    }
    const current = state.history[source.sourceId];
    if (current?.year === year) continue;
    state.history[source.sourceId] = {
      year,
      nextRangeEnd: firstHistoricalEnd,
      hadPartialChunk: false,
    };
    delete state.historyAdapters[source.sourceId];
    changed = true;
  }
  return changed;
}

async function confirmAutomaticCompatibility() {
  const state = await readState();
  if (state.automaticDisabledReason !== "unsupported_connector") return state;
  delete state.automaticDisabledReason;
  await writeState(state);
  return state;
}

async function lifecycleFailure(error) {
  if (error?.status === 401 || error?.status === 403) {
    const cleanup = await disableLocalConnection(true);
    reportOpenCodeCleanupFailures(cleanup.pluginCleanup);
    if (!cleanup.authorizationRemoved)
      throw new Error(
        "Installation authorization was revoked, but the local token file could not be removed; repair its permissions before reconnecting",
      );
    throw new Error("Installation authorization was revoked; run `viberacing connect`");
  }
  if (error?.status === 426) {
    const state = await readState();
    state.automaticDisabledReason = "unsupported_connector";
    await writeState(state);
    throw new Error("Connector update required");
  }
  throw error;
}

async function reconcileServerState(config, state) {
  const inspection = await refreshInstalledHandlerAttestation();
  state = inspection.state;
  const missing = config.sources.some(
    (source) =>
      typeof source.sourceId === "string" && state.sequences?.[source.sourceId] === undefined,
  );
  const historyStatusMissing = config.sources.some(
    (source) =>
      !Number.isSafeInteger(source.historyBackfillYear) ||
      !["pending", "complete", "partial"].includes(source.historyBackfillStatus),
  );
  const bootstrapSourceIds = config.sources
    .filter(
      (source) =>
        source.agentId === "opencode" &&
        typeof source.sourceId === "string" &&
        state.adapters?.[source.sourceId]?.bootstrapComplete !== true &&
        BigInt(state.sequences?.[source.sourceId] ?? source.lastAcceptedSyncSequence ?? "0") > 0n,
    )
    .map((source) => source.sourceId);
  const handlerConfirmationPending = publicHandlerAttestation(state.handlerAttestation) !== null;
  const lastReconciliation = state.lastRemoteReconciliationAt;
  const historyStateChanged = reconcileHistoryCursors(config, state);
  if (
    !missing &&
    !historyStatusMissing &&
    bootstrapSourceIds.length === 0 &&
    !handlerConfirmationPending &&
    lastReconciliation === undefined
  ) {
    state.lastRemoteReconciliationAt = Date.now();
    await writeState(state);
    return state;
  }
  if (
    !missing &&
    !historyStatusMissing &&
    bootstrapSourceIds.length === 0 &&
    !handlerConfirmationPending &&
    Number.isFinite(lastReconciliation) &&
    Date.now() - lastReconciliation < remoteReconciliationIntervalMs
  ) {
    if (historyStateChanged) await writeState(state);
    return state;
  }
  let remote;
  try {
    remote = await requestReconciliation(
      config,
      missing || historyStatusMissing || handlerConfirmationPending || bootstrapSourceIds.length > 0
        ? 3
        : 1,
      bootstrapSourceIds.length === 0 ? undefined : bootstrapSourceIds,
      { beforeResponseMutation: assertOpenCodeRemoteSequenceReady },
    );
  } catch (error) {
    if (
      missing ||
      historyStatusMissing ||
      bootstrapSourceIds.length > 0 ||
      error?.status === 401 ||
      error?.status === 403 ||
      error?.status === 426
    )
      await lifecycleFailure(error);
    const fresh = await readState();
    fresh.lastRemoteReconciliationAt = Date.now();
    await writeState(fresh);
    return fresh;
  }
  if (await lifecycleMutationActive())
    throw new Error("Remote reconciliation stopped by a local lifecycle operation");
  await confirmAutomaticCompatibility();
  await reconcileRemoteSources(config, remote.sources);
  const reconciled = await rememberServerSequences(config, remote.sources);
  reconciled.adapters ??= {};
  const acceptedSequenceBySourceId = new Map(
    (remote.sources ?? []).map((source) => [source.sourceId, source.lastAcceptedSyncSequence]),
  );
  for (const baseline of remote.sourceBaselines ?? [])
    reconciled.adapters[baseline.sourceId] = {
      ...(reconciled.adapters[baseline.sourceId] ?? {}),
      serverBaseline: {
        acceptedAt: baseline.acceptedAt,
        acceptedSequence: acceptedSequenceBySourceId.get(baseline.sourceId),
        entries: baseline.entries,
      },
    };
  reconcileHistoryCursors(config, reconciled);
  reconciled.lastRemoteReconciliationAt = Date.now();
  await writeState(reconciled);
  return reconciled;
}

function validatedHistoryAdvance(payload, sourceId) {
  const advances = payload.historyAdvances ?? [];
  if (!Array.isArray(advances) || advances.length > 1) {
    throw new Error("Pending history advancement state is invalid");
  }
  const advance = advances[0];
  if (advance === undefined) return null;
  if (
    advance?.sourceId !== sourceId ||
    !uuidPattern.test(advance.sourceId ?? "") ||
    !Number.isSafeInteger(advance.year) ||
    advance.year < 1970 ||
    advance.year > 9999 ||
    !(
      advance.nextRangeEnd === null ||
      (/^\d{4}-\d{2}-\d{2}$/.test(advance.nextRangeEnd ?? "") &&
        advance.nextRangeEnd.startsWith(`${String(advance.year).padStart(4, "0")}-`))
    ) ||
    typeof advance.hadPartialChunk !== "boolean" ||
    !(
      advance.terminalStatus === null || ["complete", "partial"].includes(advance.terminalStatus)
    ) ||
    (advance.nextRangeEnd === null) !== (advance.terminalStatus !== null) ||
    JSON.stringify(Object.keys(advance).sort()) !==
      JSON.stringify(["hadPartialChunk", "nextRangeEnd", "sourceId", "terminalStatus", "year"])
  )
    throw new Error("Pending history advancement state is invalid");
  return advance;
}

async function applyHistoryAdvance(config, item) {
  const advance = validatedHistoryAdvance(item.payload, item.sourceId);
  if (advance === null) return;
  const state = await readState();
  state.history ??= {};
  state.historyAdapters ??= {};
  if (advance.terminalStatus === null) {
    state.history[item.sourceId] = {
      year: advance.year,
      nextRangeEnd: advance.nextRangeEnd,
      hadPartialChunk: advance.hadPartialChunk,
    };
  } else {
    delete state.history[item.sourceId];
    delete state.historyAdapters[item.sourceId];
    const source = config.sources.find((candidate) => candidate.sourceId === item.sourceId);
    if (source) {
      source.historyBackfillYear = advance.year;
      source.historyBackfillStatus = advance.terminalStatus;
    }
  }
  await writeState(state);
  if (advance.terminalStatus !== null) await writeConfig(config);
}

async function deliverPendingGroup(config, items, retired) {
  const eligible = [];
  for (const item of items) {
    if (retired.has(item.sourceId)) await removePending(item.path);
    else eligible.push(item);
  }
  if (eligible.length === 0)
    return {
      accepted: 0,
      successfulDeliveries: 0,
      staleSources: [],
      quarantinedSources: [],
    };
  try {
    if (await lifecycleMutationActive())
      throw new Error("Pending delivery stopped by a local lifecycle operation");
    const result = await deliver(
      config,
      mergePendingPayloads(eligible.map((item) => item.payload)),
    );
    if (await lifecycleMutationActive())
      throw new Error("Pending reconciliation stopped by a local lifecycle operation");
    await confirmAutomaticCompatibility();
    await rememberServerSequences(config, result.sourceSequences);
    const sequenceById = new Map(
      (result.sourceSequences ?? []).map((item) => [item.sourceId, item]),
    );
    const staleSources = [];
    for (const item of eligible) {
      const snapshot = item.payload.snapshots?.[0];
      const sequenceStatus = sequenceById.get(item.sourceId);
      const reported = sequenceStatus?.lastAcceptedSyncSequence;
      if (
        snapshot &&
        sequenceStatus?.accepted === false &&
        typeof reported === "string" &&
        BigInt(snapshot.syncSequence) <= BigInt(reported)
      ) {
        const sequence = (BigInt(reported) + 1n).toString();
        snapshot.syncSequence = sequence;
        if (await lifecycleMutationActive())
          throw new Error("Pending repair stopped by a local lifecycle operation");
        await savePending(item.payload);
        const state = await readState();
        state.sequences ??= {};
        state.sequences[item.sourceId] = sequence;
        await writeState(state);
        staleSources.push(item.sourceId);
      } else {
        await removePending(item.path);
        if (snapshot) await applyHistoryAdvance(config, item);
        if (snapshot && sequenceStatus?.accepted !== false) {
          await clearQuarantine(item.sourceId);
          const state = await readState();
          if (state.quarantine?.[item.sourceId]) {
            delete state.quarantine[item.sourceId];
          }
          reconcileDiagnosticPhase(state, item.sourceId, "deliver", []);
          await writeState(state);
        }
      }
    }
    return {
      accepted: result.acceptedEntries ?? 0,
      successfulDeliveries: staleSources.length === 0 ? 1 : 0,
      staleSources,
      quarantinedSources: [],
    };
  } catch (error) {
    if (error?.status === 400 && eligible.length > 1) {
      const middle = Math.ceil(eligible.length / 2);
      const left = await deliverPendingGroup(config, eligible.slice(0, middle), retired);
      const right = await deliverPendingGroup(config, eligible.slice(middle), retired);
      return {
        accepted: left.accepted + right.accepted,
        successfulDeliveries: left.successfulDeliveries + right.successfulDeliveries,
        staleSources: [...left.staleSources, ...right.staleSources],
        quarantinedSources: [...left.quarantinedSources, ...right.quarantinedSources],
      };
    }
    if (error?.status === 400 && error?.code === "unsupported_source") {
      retired.add(eligible[0].sourceId);
      await removePending(eligible[0].path);
      return {
        accepted: 0,
        successfulDeliveries: 0,
        staleSources: [],
        quarantinedSources: [],
      };
    }
    if (error?.status === 400) {
      const item = eligible[0];
      await quarantinePending(item.sourceId, item.payload, error.code ?? "invalid_payload");
      await removePending(item.path);
      const state = await readState();
      state.quarantine ??= {};
      state.quarantine[item.sourceId] = error.code ?? "invalid_payload";
      reconcileDiagnosticPhase(state, item.sourceId, "deliver", [
        { code: "pending_payload_rejected", phase: "deliver" },
      ]);
      await writeState(state);
      return {
        accepted: 0,
        successfulDeliveries: 0,
        staleSources: [],
        quarantinedSources: [item.sourceId],
      };
    }
    await lifecycleFailure(error);
  }
}

function pendingGroups(items) {
  const groups = [];
  let current = [];
  for (const item of items) {
    const candidate = [...current, item];
    const payload = mergePendingPayloads(candidate.map((entry) => entry.payload));
    const entries = payload.snapshots.reduce(
      (total, snapshot) => total + (snapshot.entries?.length ?? 0),
      0,
    );
    const tooLarge =
      candidate.length > 32 ||
      entries > 1_024 ||
      Buffer.byteLength(JSON.stringify(payload)) > 500_000;
    if (current.length > 0 && tooLarge) {
      groups.push(current);
      current = [item];
    } else current = candidate;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

async function drainPending(config, retryStale = true, allowedSourceIds) {
  const configured = new Set(
    config.sources
      .map((source) => source.sourceId)
      .filter((sourceId) => typeof sourceId === "string"),
  );
  const items = [];
  const legacyPendingErrors = [];
  for (const path of await pendingPayloads()) {
    let storedPayload;
    try {
      storedPayload = await readPending(path);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const sourceId = pendingSourceId(storedPayload);
    if (sourceId === null) throw new Error("Invalid pending payload");
    if (!configured.has(sourceId)) {
      await removePending(path);
      continue;
    }
    if (allowedSourceIds && !allowedSourceIds.has(sourceId)) continue;
    if (isLegacyPendingSourceError(storedPayload)) {
      legacyPendingErrors.push({ path, sourceId });
      continue;
    }
    const payload = {
      ...storedPayload,
      protocolVersion,
      snapshots: (storedPayload.snapshots ?? []).map((snapshot) => ({
        ...snapshot,
        kind: snapshot.kind ?? "rolling",
      })),
    };
    items.push({ path, payload, sourceId });
  }
  if (legacyPendingErrors.length > 0) {
    const state = await readState();
    const collectorFailureFingerprint = fingerprint({ error: "collector_failed" });
    let changed = false;
    for (const { sourceId } of legacyPendingErrors) {
      if (state.fingerprints?.[sourceId] !== collectorFailureFingerprint) continue;
      delete state.fingerprints[sourceId];
      changed = true;
    }
    if (changed) await writeState(state);
    for (const { path } of legacyPendingErrors) await removePending(path);
  }
  const retired = new Set();
  const reobserveSourceIds = new Set(legacyPendingErrors.map(({ sourceId }) => sourceId));
  let accepted = 0;
  let successfulDeliveries = 0;
  const staleSources = new Set();
  const quarantinedSources = new Set();
  const groups = [
    items.filter((item) => (item.payload.snapshots?.length ?? 0) > 0),
    items.filter((item) => (item.payload.sourceErrors?.length ?? 0) > 0),
  ];
  for (const selected of groups) {
    for (const group of pendingGroups(selected)) {
      if (await lifecycleMutationActive())
        throw new Error("Pending delivery stopped by a local lifecycle operation");
      const delivered = await deliverPendingGroup(config, group, retired);
      accepted += delivered.accepted;
      successfulDeliveries += delivered.successfulDeliveries;
      for (const sourceId of delivered.staleSources) staleSources.add(sourceId);
      for (const sourceId of delivered.quarantinedSources) quarantinedSources.add(sourceId);
    }
  }
  if (retired.size > 0) {
    await retireMappedSources(config, retired);
  }
  if (retryStale && staleSources.size > 0) {
    const retried = await drainPending(config, false, allowedSourceIds);
    accepted += retried.accepted;
    successfulDeliveries += retried.successfulDeliveries;
    for (const sourceId of retried.retiredSources) retired.add(sourceId);
    for (const sourceId of retried.quarantinedSources) quarantinedSources.add(sourceId);
    for (const sourceId of retried.reobserveSourceIds) reobserveSourceIds.add(sourceId);
  }
  return {
    accepted,
    successfulDeliveries,
    reobserveSourceIds: [...reobserveSourceIds],
    retiredSources: [...retired],
    staleSources: [...staleSources],
    quarantinedSources: [...quarantinedSources],
  };
}

async function settleLimited(items, worker, limit = 4) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        try {
          results[index] = { status: "fulfilled", value: await worker(items[index]) };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }),
  );
  return results;
}

async function requestCodexLogicalSourceRegistration(config, localSource, profileSource) {
  const existing = config.sources.find(
    (source) => source.clientSourceId === localSource.clientSourceId,
  );
  try {
    const registered = await request(
      config.origin,
      "/api/installations/current/sources/register",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.deviceToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agentId: "codex",
          clientSourceId: localSource.clientSourceId,
          collectionMethod: "codex_app_server",
          profileClientSourceId: profileSource.clientSourceId,
          supportedSurface: "desktop",
        }),
      },
      1,
      {
        kind: "sourceRegistration",
        localSource: existing ?? localSource,
        profileClientSourceId: profileSource.clientSourceId,
        profileSourceId: profileSource.sourceId,
      },
    );
    return registered.source;
  } catch (error) {
    if (error?.code === "profile_account_limit_reached" || error?.code === "source_limit_reached")
      error.diagnosticCode = "provider_account_limit_reached";
    else error.diagnosticCode ??= "provider_account_registration_pending";
    throw error;
  }
}

async function registerCodexLogicalSource(config, localSource, profileSource) {
  const existing = config.sources.find(
    (source) => source.clientSourceId === localSource.clientSourceId,
  );
  const registered = await requestCodexLogicalSourceRegistration(
    config,
    existing ?? localSource,
    profileSource,
  );
  if (existing) Object.assign(existing, registered);
  else config.sources.push(registered);
  await writeConfig(config);
  return existing ?? registered;
}

function syncTasksForSources(sources, localById, allMappedSources) {
  const tasks = new Map();
  for (const source of sources) {
    const local = localById.get(source.clientSourceId) ?? source;
    const taskId =
      source.agentId === "codex"
        ? (local.profileClientSourceId ?? local.clientSourceId)
        : source.clientSourceId;
    const current = tasks.get(taskId);
    if (current) {
      current.requestedSources.push(source);
      continue;
    }
    const physicalLocal = localById.get(taskId) ?? local;
    const physicalMapped =
      allMappedSources.find((candidate) => candidate.clientSourceId === taskId) ?? physicalLocal;
    tasks.set(taskId, {
      physicalClientSourceId: taskId,
      source: physicalMapped,
      requestedSources: [source],
    });
  }
  return [...tasks.values()];
}

function validPendingAccountRegistration(value) {
  return (
    value &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([
        "completeness",
        "entries",
        "profileClientSourceId",
        "rangeEnd",
        "rangeStart",
      ]) &&
    typeof value.profileClientSourceId === "string" &&
    uuidPattern.test(value.profileClientSourceId) &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.rangeStart ?? "") &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.rangeEnd ?? "") &&
    value.rangeStart <= value.rangeEnd &&
    ["complete", "partial"].includes(value.completeness) &&
    Array.isArray(value.entries) &&
    value.entries.length <= 31 &&
    value.entries.every(
      (entry) =>
        entry &&
        JSON.stringify(Object.keys(entry).sort()) === JSON.stringify(["date", "totalTokens"]) &&
        /^\d{4}-\d{2}-\d{2}$/.test(entry.date ?? "") &&
        /^(?:0|[1-9]\d{0,29})$/.test(entry.totalTokens ?? ""),
    )
  );
}

async function applyDurablePendingRegistrationSupersessions() {
  const supersessions = [];
  for (const path of await pendingPayloads()) {
    const payload = await readPending(path);
    const sourceId = pendingSourceId(payload);
    for (const supersession of payload.pendingRegistrationSupersessions ?? []) {
      if (
        sourceId === null ||
        supersession?.sourceId !== sourceId ||
        !uuidPattern.test(supersession.sourceId ?? "") ||
        !uuidPattern.test(supersession.clientSourceId ?? "") ||
        JSON.stringify(Object.keys(supersession).sort()) !==
          JSON.stringify(["clientSourceId", "sourceId"])
      )
        throw new Error("Pending Codex account supersession state is invalid");
      supersessions.push(supersession);
    }
  }
  if (supersessions.length === 0) return;
  const state = await readState();
  let changed = false;
  for (const { clientSourceId } of supersessions)
    if (state.pendingAccountRegistrations?.[clientSourceId]) {
      delete state.pendingAccountRegistrations[clientSourceId];
      changed = true;
    }
  if (changed) await writeState(state);
}

async function syncRange(providedConfig, options = {}) {
  await assertOpenCodeUpgradeReady(stateDirectory);
  return withSyncLock(
    async () => {
      await assertOpenCodeUpgradeReady(stateDirectory);
      const config = providedConfig ?? (await readConfig());
      const requestedSourceIds = Array.isArray(options.sourceIds)
        ? new Set(options.sourceIds)
        : undefined;
      await applyDurablePendingRegistrationSupersessions();
      const previous = await drainPending(config, true, requestedSourceIds);
      let accepted = previous.accepted;
      let state = await readState();
      state = await reconcileServerState(config, state);
      await migrateSourcesSchema();
      const snapshotKind = options.kind ?? "rolling";
      if (!["rolling", "year_backfill"].includes(snapshotKind))
        throw new Error("Invalid sync snapshot kind");
      const range = options.range ?? snapshotRange();
      state.adapters ??= {};
      state.historyAdapters ??= {};
      state.fingerprints ??= {};
      state.collectionWarnings ??= {};
      const localSources = await readSources();
      const localById = new Map(localSources.map((source) => [source.clientSourceId, source]));
      state.pendingAccountRegistrations ??= {};
      if (
        Object.keys(state.pendingAccountRegistrations).length > 32 ||
        Object.values(state.pendingAccountRegistrations).some(
          (pending) => !validPendingAccountRegistration(pending),
        )
      )
        throw new Error("Pending Codex account registration state is invalid");
      const registrationBackfills = [];
      let backfillAccountSetupPending = false;
      for (const [clientSourceId, pending] of Object.entries(state.pendingAccountRegistrations)) {
        const localSource = localById.get(clientSourceId);
        const profileSource = config.sources.find(
          (source) => source.clientSourceId === pending.profileClientSourceId,
        );
        if (!localSource || typeof profileSource.sourceId !== "string") {
          backfillAccountSetupPending = true;
          continue;
        }
        try {
          const mapped = await registerCodexLogicalSource(config, localSource, profileSource);
          if (!requestedSourceIds || requestedSourceIds.has(mapped.sourceId)) {
            registrationBackfills.push({ clientSourceId, source: mapped, pending });
          } else if (!options.installationScoped) backfillAccountSetupPending = true;
        } catch {
          backfillAccountSetupPending = true;
        }
      }
      const mappedSources = config.sources.filter((source) => typeof source.sourceId === "string");
      const dirty = await readDirty();
      const dirtyIds = new Set(dirtyEntries(dirty).map(([clientSourceId]) => clientSourceId));
      const syncSources = requestedSourceIds
        ? mappedSources.filter((source) => requestedSourceIds.has(source.sourceId))
        : options.automatic
          ? mappedSources.filter(
              (source) =>
                dirtyIds.has(
                  source.agentId === "codex"
                    ? (localById.get(source.clientSourceId)?.profileClientSourceId ??
                        source.clientSourceId)
                    : source.clientSourceId,
                ) || previous.reobserveSourceIds.includes(source.sourceId),
            )
          : mappedSources;
      if (requestedSourceIds && syncSources.length !== requestedSourceIds.size)
        throw new Error("Browser sync requested an unavailable source");
      const activeIds = new Set(
        mappedSources.map((source) =>
          source.agentId === "codex"
            ? (localById.get(source.clientSourceId)?.profileClientSourceId ?? source.clientSourceId)
            : source.clientSourceId,
        ),
      );
      const unmappedDirtyIds = [...dirtyIds].filter(
        (clientSourceId) => !activeIds.has(clientSourceId),
      );
      if (unmappedDirtyIds.length > 0) await clearDirtyForSources(unmappedDirtyIds);
      const claims = dirtyClaims(
        dirty,
        syncSources.map((source) =>
          source.agentId === "codex"
            ? (localById.get(source.clientSourceId)?.profileClientSourceId ?? source.clientSourceId)
            : source.clientSourceId,
        ),
      );
      if (options.automatic && syncSources.length > 0) {
        state.lastAutomaticSyncAt = Date.now();
        await writeState(state);
      }
      const syncTasks = syncTasksForSources(syncSources, localById, mappedSources);
      const providerIdentitySaltPromise = syncTasks.some((task) => task.source.agentId === "codex")
        ? readOrCreateProviderIdentitySalt()
        : null;
      const collected = await settleLimited(syncTasks, async (task) => {
        const source = task.source;
        if (process.env.NODE_ENV === "test" && process.env.VIBERACING_TEST_COLLECTOR_TRACE)
          await appendFile(
            process.env.VIBERACING_TEST_COLLECTOR_TRACE,
            `${task.physicalClientSourceId}\n`,
          );
        const adapter = adapterFor(source.agentId);
        if (!adapter || !adapter.collectionMethods.includes(source.collectionMethod))
          throw new Error(`Unsupported configured source ${source.agentId}`);
        if (source.agentId === "codex") {
          const providerIdentitySalt = await providerIdentitySaltPromise;
          const profileMembers = localSources.filter(
            (candidate) =>
              candidate.agentId === "codex" &&
              (candidate.profileClientSourceId ?? candidate.clientSourceId) ===
                task.physicalClientSourceId,
          );
          const profileMapping = mappedSources.find(
            (candidate) => candidate.clientSourceId === task.physicalClientSourceId,
          );
          if (typeof profileMapping.sourceId !== "string")
            throw new Error("Codex profile mapping is unavailable");
          const adapterState =
            snapshotKind === "year_backfill"
              ? (state.historyAdapters[profileMapping.sourceId] ?? {})
              : (state.adapters[profileMapping.sourceId] ?? {});
          let result = await adapter.collect(source, range, adapterState, {
            providerIdentitySalt,
            suppressComponents: profileMembers.length > 1,
            historical: snapshotKind === "year_backfill",
          });
          const binding = await bindCodexProviderAccount(
            task.physicalClientSourceId,
            result.providerAccountKey,
          );
          let activeSource = config.sources.find(
            (candidate) => candidate.clientSourceId === binding.source.clientSourceId,
          );
          let registeredAfterClaim = false;
          const totalOnly = binding.added || profileMembers.length > 1;
          if (totalOnly) {
            result = {
              ...result,
              entries: result.entries.map(({ date, totalTokens }) => ({ date, totalTokens })),
              nextState: {},
            };
          }
          if (!activeSource)
            try {
              activeSource = await registerCodexLogicalSource(
                config,
                binding.source,
                profileMapping,
              );
              registeredAfterClaim = true;
            } catch (error) {
              state.pendingAccountRegistrations[binding.source.clientSourceId] = {
                profileClientSourceId: task.physicalClientSourceId,
                ...range,
                completeness: result.completeness,
                entries: result.entries.map(({ date, totalTokens }) => ({ date, totalTokens })),
              };
              throw error;
            }
          const requestedClientSourceIds = new Set(
            task.requestedSources.map((candidate) => candidate.clientSourceId),
          );
          if (
            requestedSourceIds &&
            !options.installationScoped &&
            !requestedClientSourceIds.has(activeSource.clientSourceId)
          ) {
            return {
              source: activeSource,
              result: null,
              inactiveSourceIds: task.requestedSources.map((candidate) => candidate.sourceId),
              checkedClientSourceId: task.physicalClientSourceId,
              accountSetupPending: registeredAfterClaim,
              supersededPendingClientSourceId: null,
            };
          }
          return {
            source: activeSource,
            result,
            inactiveSourceIds: task.requestedSources
              .filter((candidate) => candidate.clientSourceId !== activeSource.clientSourceId)
              .map((candidate) => candidate.sourceId),
            checkedClientSourceId: task.physicalClientSourceId,
            accountSetupPending: false,
            supersededPendingClientSourceId: state.pendingAccountRegistrations[
              activeSource.clientSourceId
            ]
              ? activeSource.clientSourceId
              : null,
          };
        }
        return {
          source,
          result: await adapter.collect(
            source,
            range,
            snapshotKind === "year_backfill"
              ? (state.historyAdapters[source.sourceId] ?? {})
              : (state.adapters[source.sourceId] ?? {}),
            { historical: snapshotKind === "year_backfill" },
          ),
          inactiveSourceIds: [],
          checkedClientSourceId: source.clientSourceId,
          accountSetupPending: false,
          supersededPendingClientSourceId: null,
        };
      });
      const snapshots = [];
      const sourceErrors = [];
      const failures = [];
      const failedClientSourceIds = [];
      const collectionWarnings = [];
      const successfullyChecked = [];
      const successfullyCheckedSourceIds = [];
      const inactiveSourceIds = [];
      let accountSetupPending = backfillAccountSetupPending;
      const pendingRegistrationSupersessions = new Map();
      const historyAdvances = [];
      let terminalCollectorDiagnostic;
      for (const sourceId of previous.retiredSources)
        failures.push(`server disconnected source ${sourceId}`);
      for (const sourceId of previous.quarantinedSources)
        failures.push(`server rejected source ${sourceId}; payload quarantined`);
      for (let index = 0; index < collected.length; index += 1) {
        const outcome = collected[index];
        const task = syncTasks[index];
        const source = task.source;
        if (outcome.status === "rejected") {
          failedClientSourceIds.push(task.physicalClientSourceId);
          failures.push(`${source.agentId}: ${outcome.reason?.message ?? "collector failed"}`);
          terminalCollectorDiagnostic ??= outcome.reason?.diagnosticCode;
          if (outcome.reason?.diagnosticCode === "provider_account_registration_pending")
            accountSetupPending = true;
          if (snapshotKind === "year_backfill") {
            for (const target of task.requestedSources) {
              if (state.history?.[target.sourceId]?.nextRangeEnd !== range.rangeEnd) continue;
              const previousSequence = BigInt(state.sequences[target.sourceId] ?? "0");
              const sequence = (previousSequence + 1n).toString();
              state.sequences[target.sourceId] = sequence;
              const history = historySnapshotState(
                target.sourceId,
                range,
                "partial",
                state,
                snapshotKind,
              );
              snapshots.push({
                sourceId: target.sourceId,
                syncSequence: sequence,
                kind: snapshotKind,
                ...range,
                completeness: "partial",
                entries: [],
                ...history.snapshot,
              });
              historyAdvances.push(history.advance);
              successfullyCheckedSourceIds.push(target.sourceId);
            }
            continue;
          }
          const nextFingerprint = fingerprint({ error: "collector_failed" });
          if (
            outcome.reason?.diagnosticCode !== "provider_account_registration_pending" &&
            state.fingerprints[source.sourceId] !== nextFingerprint
          ) {
            sourceErrors.push({
              sourceId: source.sourceId,
              code: "collector_failed",
              observedAfterSequence: source.lastAcceptedSyncSequence ?? "0",
            });
            state.fingerprints[source.sourceId] = nextFingerprint;
          }
          reconcileDiagnosticPhase(state, source.sourceId, "collect", [
            collectorDiagnostic(outcome.reason),
          ]);
          continue;
        }
        inactiveSourceIds.push(...outcome.value.inactiveSourceIds);
        if (outcome.value.accountSetupPending) accountSetupPending = true;
        if (outcome.value.result === null) continue;
        successfullyChecked.push(outcome.value.checkedClientSourceId);
        const activeSource = outcome.value.source;
        successfullyCheckedSourceIds.push(activeSource.sourceId);
        if (snapshotKind === "year_backfill")
          state.historyAdapters[activeSource.sourceId] = outcome.value.result.nextState ?? {};
        else {
          state.adapters[activeSource.sourceId] = outcome.value.result.nextState ?? {};
          reconcileDiagnosticPhase(
            state,
            activeSource.sourceId,
            "collect",
            normalizeAdapterDiagnostics(outcome.value.result.diagnostics),
          );
        }
        const resultWarnings = [...new Set(outcome.value.result.warnings ?? [])].sort();
        if (snapshotKind === "rolling") {
          if (resultWarnings.length)
            state.collectionWarnings[activeSource.sourceId] = resultWarnings;
          else delete state.collectionWarnings[activeSource.sourceId];
        }
        for (const code of resultWarnings)
          collectionWarnings.push(`${activeSource.agentId}: ${collectorWarningMessage(code)}`);
        const entries = entriesWithinRange(outcome.value.result.entries, range);
        const nextFingerprint = fingerprint({
          ...range,
          completeness: outcome.value.result.completeness,
          entries,
          warnings: resultWarnings,
        });
        if (
          snapshotKind === "rolling" &&
          options.automatic &&
          state.fingerprints[activeSource.sourceId] === nextFingerprint
        )
          continue;
        const previous = BigInt(state.sequences[activeSource.sourceId] ?? "0");
        const sequence = (previous + 1n).toString();
        state.sequences[activeSource.sourceId] = sequence;
        if (snapshotKind === "rolling") state.fingerprints[activeSource.sourceId] = nextFingerprint;
        const history = historySnapshotState(
          activeSource.sourceId,
          range,
          outcome.value.result.completeness,
          state,
          snapshotKind,
        );
        snapshots.push({
          sourceId: activeSource.sourceId,
          syncSequence: sequence,
          kind: snapshotKind,
          ...range,
          completeness: outcome.value.result.completeness,
          entries,
          ...history.snapshot,
        });
        if (history.advance !== null) historyAdvances.push(history.advance);
        if (outcome.value.supersededPendingClientSourceId)
          pendingRegistrationSupersessions.set(activeSource.sourceId, {
            sourceId: activeSource.sourceId,
            clientSourceId: outcome.value.supersededPendingClientSourceId,
          });
      }
      for (const { clientSourceId, source, pending } of snapshotKind === "rolling"
        ? registrationBackfills
        : []) {
        if (snapshots.some((snapshot) => snapshot.sourceId === source.sourceId)) {
          pendingRegistrationSupersessions.set(source.sourceId, {
            sourceId: source.sourceId,
            clientSourceId,
          });
          continue;
        }
        const previousSequence = BigInt(state.sequences[source.sourceId] ?? "0");
        const sequence = (previousSequence + 1n).toString();
        state.sequences[source.sourceId] = sequence;
        const history = historySnapshotState(
          source.sourceId,
          { rangeStart: pending.rangeStart, rangeEnd: pending.rangeEnd },
          pending.completeness,
          state,
          snapshotKind,
        );
        snapshots.push({
          sourceId: source.sourceId,
          syncSequence: sequence,
          kind: snapshotKind,
          rangeStart: pending.rangeStart,
          rangeEnd: pending.rangeEnd,
          completeness: pending.completeness,
          entries: pending.entries,
          ...history.snapshot,
        });
        if (history.advance !== null) historyAdvances.push(history.advance);
        successfullyCheckedSourceIds.push(source.sourceId);
        pendingRegistrationSupersessions.set(source.sourceId, {
          sourceId: source.sourceId,
          clientSourceId,
        });
      }
      if (await lifecycleMutationActive())
        throw new Error("Sync persistence stopped by a local lifecycle operation");
      await writeState(state);
      const clearSuccessfulDirty = () =>
        clearDirty(
          Object.fromEntries(
            successfullyChecked
              .filter((clientSourceId) => claims[clientSourceId])
              .map((clientSourceId) => [clientSourceId, claims[clientSourceId]]),
          ),
        );
      if (snapshots.length === 0 && sourceErrors.length === 0) {
        await clearSuccessfulDirty();
        const diagnosticDelivery =
          snapshotKind === "rolling"
            ? await finishSuccessfulSourceDiagnostics(
                config,
                successfullyCheckedSourceIds,
                requestedSourceIds,
              )
            : { attempted: false };
        if (failures.length === 0 && previous.successfulDeliveries > 0) await clearLastHookError();
        output(
          diagnosticDelivery.attempted
            ? "No usage changes; a diagnostics request was attempted."
            : "No usage changes; no request was sent.",
        );
        for (const message of collectionWarnings) warning(`Vibe Racing warning: ${message}.`);
        if (failures.length) warning(`Vibe Racing partial sync: ${failures.join("; ")}`);
        if (inactiveSourceIds.length > 0)
          warning(
            "Vibe Racing partial sync: some Codex accounts are inactive; switch accounts and sync again.",
          );
        return {
          accepted,
          failures,
          unchanged: true,
          inactiveSourceIds,
          accountSetupPending,
        };
      }
      const payload = {
        protocolVersion,
        snapshots,
        sourceErrors,
        pendingRegistrationSupersessions: [...pendingRegistrationSupersessions.values()],
        historyAdvances,
      };
      if (await lifecycleMutationActive())
        throw new Error("Sync persistence stopped by a local lifecycle operation");
      await savePending(payload);
      await applyDurablePendingRegistrationSupersessions();
      const deliverySourceIds =
        options.installationScoped && requestedSourceIds
          ? new Set([
              ...requestedSourceIds,
              ...snapshots.map((snapshot) => snapshot.sourceId),
              ...sourceErrors.map((sourceError) => sourceError.sourceId),
            ])
          : requestedSourceIds;
      const delivered = await drainPending(config, true, deliverySourceIds);
      accepted += delivered.accepted;
      await clearSuccessfulDirty();
      if (snapshotKind === "rolling")
        await finishSuccessfulSourceDiagnostics(
          config,
          successfullyCheckedSourceIds,
          requestedSourceIds,
        );
      if (successfullyCheckedSourceIds.length === 0) {
        const error = new Error(failures.join("; ") || "No configured collectors succeeded");
        error.automaticDiagnosticClientSourceIds = failedClientSourceIds;
        error.diagnosticCode = terminalCollectorDiagnostic;
        throw error;
      }
      output(`Synced ${accepted} daily totals from ${snapshots.length} source(s).`);
      for (const message of collectionWarnings) warning(`Vibe Racing warning: ${message}.`);
      for (const sourceId of delivered.retiredSources)
        failures.push(`server disconnected source ${sourceId}`);
      for (const sourceId of delivered.quarantinedSources)
        failures.push(`server rejected source ${sourceId}; payload quarantined`);
      if (
        snapshotKind === "rolling" &&
        failures.length === 0 &&
        previous.successfulDeliveries + delivered.successfulDeliveries > 0
      )
        await clearLastHookError();
      if (failures.length) warning(`Vibe Racing partial sync: ${failures.join("; ")}`);
      if (inactiveSourceIds.length > 0)
        warning(
          "Vibe Racing partial sync: some Codex accounts are inactive; switch accounts and sync again.",
        );
      return { accepted, failures, inactiveSourceIds, accountSetupPending };
    },
    { waitMs: options.waitMs ?? (options.automatic ? automaticSyncLockWaitMs : 0) },
  );
}

async function sync(providedConfig, options = {}) {
  const rolling = await syncRange(providedConfig, {
    ...options,
    kind: "rolling",
    range: snapshotRange(),
  });
  if (rolling?.skipped) return rolling;

  let accepted = rolling?.accepted ?? 0;
  const failures = [...(rolling?.failures ?? [])];
  const inactiveSourceIds = new Set(rolling?.inactiveSourceIds ?? []);
  let accountSetupPending = rolling?.accountSetupPending ?? false;
  let historyChunks = 0;
  const maximumHistoryChunks = options.automatic || options.browser ? 1 : Number.POSITIVE_INFINITY;
  const allowed = Array.isArray(options.sourceIds) ? new Set(options.sourceIds) : null;

  while (historyChunks < maximumHistoryChunks) {
    const config = providedConfig ?? (await readConfig());
    const state = await readState();
    const year = currentHistoryYear();
    const candidates = config.sources
      .filter(
        (source) =>
          typeof source.sourceId === "string" &&
          (allowed === null || allowed.has(source.sourceId)) &&
          !inactiveSourceIds.has(source.sourceId) &&
          state.history?.[source.sourceId]?.year === year,
      )
      .map((source) => ({ source, cursor: state.history[source.sourceId] }))
      .sort(
        (left, right) =>
          right.cursor.nextRangeEnd.localeCompare(left.cursor.nextRangeEnd) ||
          left.source.sourceId.localeCompare(right.source.sourceId),
      );
    const nextRangeEnd = candidates[0]?.cursor.nextRangeEnd;
    if (nextRangeEnd === undefined) break;
    const selected = candidates.filter(
      (candidate) => candidate.cursor.nextRangeEnd === nextRangeEnd,
    );
    const range = historyRangeEndingAt(nextRangeEnd, year);
    const historical = await syncRange(config, {
      ...options,
      automatic: false,
      browser: false,
      sourceIds: selected.map((candidate) => candidate.source.sourceId),
      kind: "year_backfill",
      range,
    });
    if (historical?.skipped) break;
    accepted += historical?.accepted ?? 0;
    failures.push(...(historical?.failures ?? []));
    for (const sourceId of historical?.inactiveSourceIds ?? []) inactiveSourceIds.add(sourceId);
    accountSetupPending ||= historical?.accountSetupPending ?? false;
    historyChunks += 1;
  }

  const finalConfig = providedConfig ?? (await readConfig());
  const terminalCaptureSources = finalConfig.sources.filter(
    (source) =>
      source.collectionMethod === "antigravity_cli_capture" &&
      (allowed === null || allowed.has(source.sourceId)) &&
      source.historyBackfillYear === currentHistoryYear() &&
      ["complete", "partial"].includes(source.historyBackfillStatus),
  );
  if (terminalCaptureSources.length > 0)
    await compactSuccessfulCaptures({ ...finalConfig, sources: terminalCaptureSources });

  return {
    ...rolling,
    accepted,
    failures,
    inactiveSourceIds: [...inactiveSourceIds],
    accountSetupPending,
    historyChunks,
  };
}

function parseBrowserSyncUrl(value) {
  if (typeof value !== "string" || value.length > 1_024)
    throw new Error("Invalid browser Sync URL");
  const url = new URL(value);
  const keys = [...url.searchParams.keys()].sort();
  const accountScoped =
    JSON.stringify(keys) === JSON.stringify(["accountId", "grant", "requestId"]) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      url.searchParams.get("accountId") ?? "",
    );
  const installationScoped =
    JSON.stringify(keys) === JSON.stringify(["grant", "requestId", "scope"]) &&
    url.searchParams.get("scope") === "installation";
  if (
    url.protocol !== "viberacing:" ||
    url.hostname !== "sync" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.hash !== "" ||
    (!accountScoped && !installationScoped) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      url.searchParams.get("requestId") ?? "",
    ) ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(url.searchParams.get("grant") ?? "")
  )
    throw new Error("Invalid browser Sync URL");
  const common = {
    requestId: url.searchParams.get("requestId"),
    grant: url.searchParams.get("grant"),
  };
  return accountScoped
    ? { ...common, accountId: url.searchParams.get("accountId") }
    : { ...common, scope: "installation" };
}

async function reportBrowserSync(config, requestId, status, resultCode) {
  await request(
    config.origin,
    "/api/installations/current/sync/result",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.deviceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requestId, status, resultCode }),
    },
    1,
    { kind: "empty" },
  );
}

async function browserSync(value) {
  await assertOpenCodeUpgradeReady(stateDirectory);
  const link = parseBrowserSyncUrl(value);
  const claimed = await withSyncLock(
    async () => {
      await assertOpenCodeUpgradeReady(stateDirectory);
      const config = await readConnectedConfig();
      const claim = await request(
        config.origin,
        "/api/installations/current/sync/claim",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.deviceToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(link),
        },
        1,
        { kind: "browserSyncClaim" },
      );
      return { claim, config };
    },
    { waitMs: manualSyncLockWaitMs },
  );
  if (claimed?.skipped) throw new Error("Another sync is already running");
  const { claim, config } = claimed;
  const requested = new Set(claim.sourceIds);
  const local = config.sources.filter(
    (source) =>
      requested.has(source.sourceId) &&
      (link.scope === "installation" || source.agentAccountId === link.accountId),
  );
  if (local.length !== requested.size) {
    await reportBrowserSync(config, link.requestId, "failed", "invalid_request").catch(() => {});
    throw new Error("Browser sync source mapping changed");
  }
  try {
    const result = await sync(undefined, {
      sourceIds: claim.sourceIds,
      installationScoped: link.scope === "installation",
      browser: true,
      waitMs: manualSyncLockWaitMs,
    });
    if (result?.skipped) await reportBrowserSync(config, link.requestId, "failed", "busy");
    else if (result?.accountSetupPending)
      await reportBrowserSync(config, link.requestId, "partial", "account_setup_pending");
    else if (link.accountId && (result?.inactiveSourceIds?.length ?? 0) > 0)
      await reportBrowserSync(config, link.requestId, "failed", "account_not_active");
    else if ((result?.inactiveSourceIds?.length ?? 0) > 0)
      await reportBrowserSync(config, link.requestId, "partial", "partial_accounts_inactive");
    else if ((result?.failures?.length ?? 0) > 0)
      await reportBrowserSync(config, link.requestId, "partial", "partial");
    else
      await reportBrowserSync(
        config,
        link.requestId,
        "succeeded",
        result?.unchanged ? "unchanged" : "complete",
      );
  } catch (error) {
    const resultCode =
      error?.status === 401 || error?.status === 403
        ? "authorization_failed"
        : error?.diagnosticCode === "provider_account_registration_pending"
          ? "account_setup_pending"
          : error?.message?.includes("collector")
            ? "collector_failed"
            : "network_failed";
    await reportBrowserSync(
      config,
      link.requestId,
      resultCode === "account_setup_pending" ? "partial" : "failed",
      resultCode,
    ).catch(() => {});
    throw error;
  }
}

function schedulerHandshakeWaitMs() {
  if (process.env.NODE_ENV !== "test") return 2_000;
  const value = process.env.VIBERACING_TEST_SCHEDULER_HANDSHAKE_TIMEOUT_MS;
  return value !== undefined && /^[1-9]\d{0,3}$/.test(value) ? Number(value) : 5_000;
}

async function traceSchedulerForTest(value) {
  if (process.env.NODE_ENV !== "test" || !process.env.VIBERACING_TEST_SCHEDULER_TRACE) return;
  await appendFile(process.env.VIBERACING_TEST_SCHEDULER_TRACE, `${value}\n`).catch(() => {});
}

async function launchAutomaticScheduler(existingLaunch) {
  if ((await lifecycleMutationActive()) || !(await connectedStateExists())) return false;
  const launch = existingLaunch ?? (await claimSchedulerLaunch());
  if (!launch) return false;
  const ownsLaunch = existingLaunch === undefined;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if ((await lifecycleMutationActive()) || !(await connectedStateExists())) return false;
      const state = await readState();
      if (state.automaticDisabledReason) return false;
      let child;
      try {
        child = spawn(process.execPath, [fileURLToPath(import.meta.url), "auto-sync", "--quiet"], {
          detached: true,
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          windowsHide: true,
        });
      } catch {
        await traceSchedulerForTest(`launch-failed:${process.pid}:${attempt + 1}`);
        if (attempt < 2) {
          await delay(25 * 4 ** attempt);
          continue;
        }
        return false;
      }
      const status = await new Promise((resolve) => {
        let settled = false;
        let timeout;
        const message = (value) =>
          finish(value?.type === "viberacing-scheduler" ? value.status : "lost");
        const launchFailed = () => finish("launch_failed");
        const finish = (value) => {
          if (settled) return;
          settled = true;
          if (timeout !== undefined) clearTimeout(timeout);
          child.off("message", message);
          child.off("error", launchFailed);
          child.off("exit", launchFailed);
          resolve(value);
        };
        timeout = setTimeout(() => finish("pending"), schedulerHandshakeWaitMs());
        child.once("message", message);
        child.once("error", launchFailed);
        child.once("exit", launchFailed);
      });
      child.unref();
      child.channel?.unref();
      if (status === "acquired") return true;
      if (status !== "launch_failed") return false;
      await traceSchedulerForTest(`launch-failed:${process.pid}:${attempt + 1}`);
      if (attempt < 2) await delay(25 * 4 ** attempt);
    }
    return false;
  } finally {
    if (ownsLaunch) await releaseSchedulerLaunch(launch);
  }
}

async function waitForTestSchedulerClaimBarrier() {
  if (process.env.NODE_ENV !== "test" || !process.env.VIBERACING_TEST_SCHEDULER_CLAIM_BARRIER)
    return;
  const barrier = process.env.VIBERACING_TEST_SCHEDULER_CLAIM_BARRIER;
  await writeFile(`${barrier}.ready`, `${process.pid}\n`, { mode: 0o600 });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await readFile(`${barrier}.continue`);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await delay(10);
  }
  throw new Error("Timed out at scheduler claim test barrier");
}

async function sendSchedulerHandshake(status) {
  if (typeof process.send !== "function" || !process.connected) return;
  await new Promise((resolve) =>
    process.send({ type: "viberacing-scheduler", status }, () => resolve()),
  );
  if (process.connected) process.disconnect();
}

async function exitAutomaticSchedulerForTest() {
  const marker = process.env.VIBERACING_TEST_SCHEDULER_EXIT_BEFORE_HANDSHAKE;
  if (process.env.NODE_ENV !== "test" || !marker) return false;
  const countText = process.env.VIBERACING_TEST_SCHEDULER_EXIT_BEFORE_HANDSHAKE_COUNT ?? "1";
  if (!/^[1-3]$/.test(countText)) throw new Error("Invalid scheduler exit test count");
  for (let index = 1; index <= Number(countText); index += 1) {
    try {
      await writeFile(`${marker}.${index}`, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  return false;
}

async function recordAutomaticSyncFailure(clientSourceIds) {
  const selected = new Set(clientSourceIds);
  if (selected.size === 0) return;
  const recorded = await withSyncLock(
    async () => {
      await assertOpenCodeUpgradeReady(stateDirectory);
      const config = await readConfig();
      const state = await readState();
      for (const source of config.sources) {
        if (!selected.has(source.clientSourceId) || typeof source.sourceId !== "string") continue;
        reconcileDiagnosticPhase(state, source.sourceId, "sync", [
          { code: "automatic_sync_failed", phase: "sync" },
        ]);
      }
      await writeState(state);
    },
    { waitMs: automaticSyncLockWaitMs },
  );
  if (recorded?.skipped) return;
}

function parseHookRequest() {
  const values = arguments_.slice(1);
  if (!values.includes("--all-sources")) {
    return { type: "source", clientSourceId: option("--source"), agentId: option("--agent") };
  }
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--all-sources") {
      if (parsed.allSources) throw new Error("Duplicate --all-sources option");
      parsed.allSources = true;
      continue;
    }
    if (value === "--agent" || value === "--installation") {
      if (parsed[value] !== undefined || !values[index + 1])
        throw new Error(`Invalid ${value} option`);
      parsed[value] = values[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown bulk hook option: ${value}`);
  }
  if (parsed["--agent"] !== "opencode")
    throw new Error("--all-sources is supported only for OpenCode");
  if (!uuidPattern.test(parsed["--installation"] ?? ""))
    throw new Error("Bulk OpenCode hook requires a valid --installation id");
  return {
    type: "agent",
    agentId: "opencode",
    installationId: parsed["--installation"].toLowerCase(),
  };
}

async function hook() {
  try {
    const request = parseHookRequest();
    await assertOpenCodeUpgradeReady(stateDirectory);
    if (
      request.type === "source" &&
      process.env.NODE_ENV === "test" &&
      process.env.VIBERACING_TEST_HOOK_READY
    )
      await writeFile(process.env.VIBERACING_TEST_HOOK_READY, `${process.pid}\n`, { mode: 0o600 });
    for await (const _chunk of process.stdin) {
      // Hook input can contain private agent context. Discard it without parsing or logging.
    }
    await assertOpenCodeUpgradeReady(stateDirectory);
    const marked =
      request.type === "agent"
        ? await markAgentSourcesDirtyIfConnected({
            agentId: request.agentId,
            installationId: request.installationId,
          })
        : await markDirtyIfConnected(request.clientSourceId, request.agentId);
    if (
      request.type === "agent" &&
      process.env.NODE_ENV === "test" &&
      process.env.VIBERACING_TEST_HOOK_READY
    )
      await writeFile(process.env.VIBERACING_TEST_HOOK_READY, `${process.pid}\n`, { mode: 0o600 });
    if (Array.isArray(marked) ? marked.length > 0 : marked) {
      const launch = await claimSchedulerLaunch({ waitMs: 0 });
      await traceSchedulerForTest(`hook-launch-${launch ? "claimed" : "busy"}:${process.pid}`);
      if (launch)
        try {
          const launched = await launchAutomaticScheduler(launch);
          await traceSchedulerForTest(
            `hook-launch-result:${process.pid}:${launched ? "acquired" : "not-acquired"}`,
          );
        } finally {
          await releaseSchedulerLaunch(launch);
        }
    }
  } catch {
    // Provider hooks are fail-open: local scheduling failures must never affect the agent.
  }
  const agentId = option("--agent");
  if (agentId === "gemini_cli" || agentId === "qwen_code") process.stdout.write("{}\n");
}

async function automaticSync() {
  await assertOpenCodeUpgradeReady(stateDirectory);
  await traceSchedulerForTest(`started:${process.pid}`);
  if (await exitAutomaticSchedulerForTest()) return;
  await waitForTestSchedulerClaimBarrier();
  if (await lifecycleMutationActive()) {
    await sendSchedulerHandshake("lost");
    return;
  }
  const scheduler = await claimConnectedScheduler();
  if (!scheduler) {
    await sendSchedulerHandshake("lost");
    if (process.env.NODE_ENV === "test" && process.env.VIBERACING_TEST_SCHEDULER_TRACE)
      await appendFile(process.env.VIBERACING_TEST_SCHEDULER_TRACE, `lost:${process.pid}\n`);
    return;
  }
  await sendSchedulerHandshake("acquired");
  if (process.env.NODE_ENV === "test" && process.env.VIBERACING_TEST_SCHEDULER_TRACE)
    await appendFile(process.env.VIBERACING_TEST_SCHEDULER_TRACE, `acquired:${process.pid}\n`);
  let attemptedClaims = {};
  let attempted = false;
  let deferredLockRetryAvailable = true;
  try {
    for (;;) {
      if (!(await ownsScheduler(scheduler))) return;
      const dirty = await readDirty();
      if (!dirty) return;
      let state = await readState();
      const dueAt = automaticDueAt(dirty, state.lastAutomaticSyncAt ?? 0, automaticTimings);
      const waitMs = Math.max(0, dueAt - Date.now());
      const waitDeadline = Date.now() + waitMs;
      while (Date.now() < waitDeadline) {
        await delay(Math.min(50, waitDeadline - Date.now()));
        if (!(await ownsScheduler(scheduler)) || !(await readDirty())) return;
      }
      if (!(await ownsScheduler(scheduler))) return;
      const current = await readDirty();
      if (!current) return;
      state = await readState();
      const currentDueAt = automaticDueAt(
        current,
        state.lastAutomaticSyncAt ?? 0,
        automaticTimings,
      );
      if (currentDueAt > Date.now()) continue;
      try {
        await readConfig();
      } catch {
        await clearDirty(dirtyClaims(current));
        return;
      }
      attemptedClaims = dirtyClaims(current);
      attempted = true;
      let result;
      try {
        result = await sync(undefined, { automatic: true });
      } catch (error) {
        if (error?.diagnosticCode === "opencode_cutover_required") {
          attempted = false;
          throw error;
        }
        const sourceLocalFailures = Array.isArray(error?.automaticDiagnosticClientSourceIds)
          ? error.automaticDiagnosticClientSourceIds.filter((clientSourceId) =>
              Object.hasOwn(attemptedClaims, clientSourceId),
            )
          : null;
        await recordAutomaticSyncFailure(sourceLocalFailures ?? Object.keys(attemptedClaims)).catch(
          () => {},
        );
        throw error;
      }
      if (result?.skipped) {
        attempted = false;
        if (process.env.NODE_ENV === "test" && process.env.VIBERACING_TEST_AUTOMATIC_SYNC_TRACE)
          await appendFile(process.env.VIBERACING_TEST_AUTOMATIC_SYNC_TRACE, "sync-lock-skipped\n");
        if (!result.lifecycle && deferredLockRetryAvailable) {
          deferredLockRetryAvailable = false;
          continue;
        }
      }
      return;
    }
  } catch (error) {
    if (quiet && error?.diagnosticCode !== "opencode_cutover_required") await recordLastHookError();
    throw error;
  } finally {
    if (attempted) await clearDirty(attemptedClaims).catch(() => {});
    await releaseScheduler(scheduler);
    if (process.env.NODE_ENV === "test" && process.env.VIBERACING_TEST_SCHEDULER_TRACE)
      await appendFile(process.env.VIBERACING_TEST_SCHEDULER_TRACE, `released:${process.pid}\n`);
    const remaining = dirtyEntries(await readDirty().catch(() => null));
    const hasNewGeneration =
      attempted &&
      remaining.some(
        ([clientSourceId, entry]) => attemptedClaims[clientSourceId] !== entry.generation,
      );
    if (hasNewGeneration) {
      try {
        await readConfig();
        await launchAutomaticScheduler();
      } catch {}
    }
  }
}

async function doctor() {
  await assertOpenCodeUpgradeReady(stateDirectory);
  const repairRequested = arguments_.includes("--repair");
  const defaultState = resolve(stateDirectory) === resolve(join(homedir(), ".viberacing"));
  let repairIncomplete = false;
  let repairFailed = false;
  let repairStarted = false;
  let repairServerPending = false;
  let repairSummaryWritten = false;
  const finishRepair = () => {
    if (!repairRequested || repairSummaryWritten) return;
    repairSummaryWritten = true;
    output("Usage sync: not run.");
    if (repairIncomplete) {
      warning("Vibe Racing warning: connector repair is incomplete; review the warnings above.");
      process.exitCode = 1;
    } else if (repairServerPending) {
      output("Local repair complete; server confirmation is pending until the next contact.");
    } else {
      output(
        "Repair complete. Refresh the dashboard, or run `viberacing sync` to upload totals now.",
      );
    }
  };
  const discovery = await discoverSources();
  const detected = discovery.sources;
  const localSources = await (repairRequested ? readSources() : inspectSources()).catch(() => []);
  let handlerInspection;
  if (!repairRequested) {
    if (!defaultState) handlerInspection = { inspectionFailed: false, observed: null };
    else
      try {
        handlerInspection = {
          inspectionFailed: false,
          observed: await browserSyncHandlerAttestation(),
        };
      } catch {
        handlerInspection = { inspectionFailed: true, observed: null };
      }
  } else {
    handlerInspection = await withSyncLock(
      async () => {
        await assertOpenCodeUpgradeReady(stateDirectory);
        return refreshInstalledHandlerAttestation();
      },
      { waitMs: 0 },
    );
    if (handlerInspection?.skipped)
      handlerInspection = { inspectionFailed: true, deferred: true, observed: null };
  }
  output(`Connector: ${connectorVersion}; protocol: ${protocolVersion}`);
  if (!defaultState) output("Browser Sync handler: unavailable for custom state root");
  else if (handlerInspection.inspectionFailed) {
    output(
      handlerInspection.deferred
        ? "Browser Sync handler: inspection deferred while sync is active"
        : "Browser Sync handler: inspection failed",
    );
    if (!handlerInspection.deferred)
      warning(
        "Vibe Racing warning: Browser Sync handler inspection failed; installed state was not changed and token Sync remains available.",
      );
  } else output(`Browser Sync handler: ${handlerInspection.observed.status}`);
  output(
    `Detected exact sources: ${detected.length ? detected.map((source) => `${source.agentId}/${source.collectionMethod}`).join(", ") : "none"}`,
  );
  for (const diagnostic of discovery.diagnostics)
    output(`Detection error (${diagnostic.displayName}): ${diagnostic.error}`);
  const expectedSources = {
    codex: "account/usage/read account usage",
    claude_code: "session JSONL with usage",
    opencode: "compatible OpenCode SQLite message store",
    kimi_code: "current or legacy wire records",
    qwen_code: "runtime usage directory",
    antigravity: "Vibe Racing wrapper capture",
    gemini_cli: "session JSONL records",
  };
  for (const adapter of adapters) {
    const automatic = detected.filter((source) => source.agentId === adapter.id);
    const configured = localSources.filter((source) => source.agentId === adapter.id);
    output(`${adapter.displayName}:`);
    output(`  Expected source type: ${expectedSources[adapter.id]}`);
    if (adapter.id === "antigravity") {
      output(
        `  Status: wrapper-only${configured.length ? `; ${configured.length} capture source(s) configured` : ""}`,
      );
      output(
        "  Reason: only Antigravity CLI sessions launched through the Vibe Racing wrapper are counted; earlier, direct, and Desktop sessions are not included",
      );
      output("  Manual command: viberacing run antigravity -- ...");
      continue;
    }
    const visible = automatic.length ? automatic : configured;
    if (visible.length) {
      output(
        adapter.id === "opencode"
          ? `  Status: found ${visible.length} compatible SQLite store(s)`
          : `  Status: ${automatic.length ? "detected" : "configured manually"}`,
      );
      for (const source of visible) {
        output(`  Detected token root: ${source.dataPath}`);
        output(`  Collection method: ${source.collectionMethod}`);
      }
      continue;
    }
    const reason = discovery.diagnostics.find((item) => item.agentId === adapter.id)?.error;
    output("  Status: not detected");
    output(`  Reason: ${reason ?? "no exact token store has been created yet"}`);
    output(
      `  Manual command: viberacing source add --agent ${adapter.id} --name <label> --data-dir <usage-root>`,
    );
  }
  try {
    let config = await (repairRequested ? readConfig() : inspectConfig());
    let state = await (repairRequested ? readState() : inspectState());
    let repairedPlugin = null;
    if (repairRequested) {
      let repaired;
      repairStarted = true;
      try {
        repaired = await withOpenCodeLifecycleMutation(async () => {
          const installedRuntime = await prepareRuntime(import.meta.url, { force: true });
          const hooks = await reconcileHooks(import.meta.url, config.sources, await readSources(), {
            installedScript: installedRuntime,
          });
          const browserSyncCapable = defaultState
            ? await registerBrowserSync(installedRuntime)
            : false;
          let plugin;
          try {
            plugin = await reconcilePluginForConfig(config);
          } catch (error) {
            plugin = blockedOpenCodePluginResult(error);
          }
          return { browserSyncCapable, hooks, plugin };
        });
      } catch (error) {
        repairFailed = true;
        repairIncomplete = true;
        warning(
          `Vibe Racing repair error: ${error instanceof Error ? error.message : "unexpected error"}`,
        );
        throw error;
      }
      output(`Runtime: reinstalled ${connectorVersion}`);
      repairedPlugin = repaired.plugin;
      reportOpenCodeCleanupFailures(repairedPlugin?.pluginCleanup);
      reportOpenCodePluginTransition(repairedPlugin, { connected: true });
      if (openCodePluginBlocked(repairedPlugin)) repairIncomplete = true;
      output(
        repaired.hooks.failures.length === 0
          ? "Hooks: repaired"
          : `Hooks: repaired with ${repaired.hooks.failures.length} warning(s)`,
      );
      repairIncomplete ||= repaired.hooks.failures.length > 0;
      for (const failure of repaired.hooks.failures)
        output(`Hook repair warning (${failure.agentId ?? "connector"}): ${failure.message}`);
      if (!defaultState) {
        output("Browser Sync handler: unavailable for custom state root");
        await recordInstalledHandlerAttestation(null, 0, { force: true });
      } else {
        const repairedInspection = await refreshInstalledHandlerAttestation({ force: true });
        if (repairedInspection.inspectionFailed) {
          output("Browser Sync handler: inspection failed");
          warning(
            "Vibe Racing warning: Browser Sync handler inspection failed; installed state was not changed and token Sync remains available.",
          );
          repairIncomplete = true;
        } else {
          output(`Browser Sync handler: ${repairedInspection.observed.status}`);
          if (!repaired.browserSyncCapable || repairedInspection.observed.status !== "current")
            repairIncomplete = true;
        }
      }
    }
    const hooks = await diagnoseHooks(config.sources);
    for (const [agentId, status] of Object.entries(hooks)) output(`${agentId} hook: ${status}`);
    const wantsOpenCodePlugin = configWantsOpenCodePlugin(config, config.installationId);
    let openCodePluginStatus;
    let recordedOpenCodePluginStatus = null;
    if (repairedPlugin)
      openCodePluginStatus =
        !wantsOpenCodePlugin && repairedPlugin.status === "missing"
          ? "not-needed"
          : repairedPlugin.status;
    else {
      try {
        const inspected = await inspectPluginForDoctor(config);
        openCodePluginStatus = inspected.status;
        recordedOpenCodePluginStatus = inspected.recordedStatus;
      } catch {
        openCodePluginStatus = "unreadable";
      }
    }
    output(`OpenCode automatic sync plugin: ${openCodePluginStatus}`);
    if (recordedOpenCodePluginStatus)
      output(`OpenCode recorded plugin cleanup path: ${recordedOpenCodePluginStatus}`);
    const codexGuidance = codexHookGuidance(hooks.codex);
    if (codexGuidance) {
      output(codexGuidance);
      if (repairRequested) repairIncomplete = true;
    }
    output(`Connected origin: ${config.origin}`);
    const reconciliation = repairRequested
      ? await withSyncLock(
          async () => {
            await assertOpenCodeUpgradeReady(stateDirectory);
            if (handlerInspection.deferred) await refreshInstalledHandlerAttestation();
            const lockedConfig = await readConfig();
            let remote;
            try {
              remote = await requestReconciliation(lockedConfig, 1, undefined, {
                beforeResponseMutation: assertOpenCodeRemoteSequenceReady,
              });
            } catch (error) {
              if (await lifecycleMutationActive()) return { status: "lifecycle" };
              if (error?.status === 401 || error?.status === 403) {
                const cleanup = await disableLocalConnection();
                return {
                  status: cleanup.authorizationRemoved ? "revoked" : "revoked-local-failed",
                  cleanup,
                };
              }
              if (error?.status === 426) {
                const lockedState = await readState();
                lockedState.automaticDisabledReason = "unsupported_connector";
                await writeState(lockedState);
                return { status: "unsupported" };
              }
              return { status: "error", error };
            }
            if (await lifecycleMutationActive()) return { status: "lifecycle" };
            await confirmAutomaticCompatibility();
            await reconcileRemoteSources(lockedConfig, remote.sources);
            const lockedState = await rememberServerSequences(
              lockedConfig,
              remote.sources?.map((source) => ({
                sourceId: source.sourceId,
                lastAcceptedSyncSequence: source.lastAcceptedSyncSequence,
              })),
            );
            return { status: "active", config: lockedConfig, state: lockedState, remote };
          },
          { waitMs: automaticSyncLockWaitMs },
        )
      : { status: "inspection", config, state };
    if (reconciliation?.skipped) {
      output("Pairing status: busy; timed out waiting for an active sync.");
    } else if (reconciliation.status === "lifecycle") {
      output("Pairing status: busy; a local lifecycle operation is active.");
    } else if (reconciliation.status === "inspection") {
      output("Pairing status: stored connection; server not contacted");
    } else if (reconciliation.status === "revoked") {
      output("Pairing status: disconnected. Installation authorization was revoked.");
      output("Run `viberacing connect` to reconnect this installation.");
      reportOpenCodeCleanupFailures(reconciliation.cleanup?.pluginCleanup);
      if (reconciliation.cleanup?.warningCount)
        output("One or more auxiliary hook cleanup steps need manual inspection.");
      repairServerPending = true;
      finishRepair();
      return;
    } else if (reconciliation.status === "revoked-local-failed") {
      output(
        "Pairing status: server authorization was revoked, but the local token file could not be removed.",
      );
      reportOpenCodeCleanupFailures(reconciliation.cleanup?.pluginCleanup);
      output("Repair the local state permissions, then run `viberacing disconnect`.");
      repairIncomplete = true;
      repairServerPending = true;
      finishRepair();
      return;
    } else if (reconciliation.status === "unsupported") {
      output("Pairing status: connector update required; automatic sync is disabled.");
      repairServerPending = true;
      finishRepair();
      return;
    } else if (reconciliation.status === "error") {
      output(`Pairing status: error (${reconciliation.error.message})`);
      repairServerPending = true;
    } else {
      config = reconciliation.config;
      state = reconciliation.state;
      const { remote } = reconciliation;
      output("Pairing status: active");
      const localById = new Map(config.sources.map((source) => [source.sourceId, source]));
      for (const source of remote.sources ?? []) {
        const local = localById.get(source.sourceId);
        output(
          `${local?.agentId ?? "source"}/${local?.collectionMethod ?? source.sourceId}: ${source.status}, sequence ${source.lastAcceptedSyncSequence}`,
        );
      }
    }
    for (const source of config.sources) {
      const adapter = adapterFor(source.agentId);
      try {
        const diagnostic = await adapter.diagnose(source);
        output(
          `${source.agentId} diagnostics: ${diagnostic.status}; method ${diagnostic.collectionMethod}; surfaces ${diagnostic.supportedSurfaces.join(",")}; data ${diagnostic.dataLocationAvailable === false ? "unavailable" : "available"}${diagnostic.excluded.length ? `; excluded ${diagnostic.excluded.join(", ")}` : ""}`,
        );
      } catch (error) {
        output(`${source.agentId} (${source.accountLabel}): error, ${error.message}`);
      }
      for (const code of state.collectionWarnings?.[source.sourceId] ?? [])
        output(`${source.agentId} collection warning: ${collectorWarningMessage(code)}`);
    }
    output(`Pending uploads: ${(await pendingPayloads()).length}`);
    const quarantined = await quarantinedPayloads();
    output(`Quarantined uploads: ${quarantined.length}`);
    for (const [sourceId, code] of Object.entries(state.quarantine ?? {}))
      output(`Quarantined ${sourceId}: ${code}`);
    if (state.automaticDisabledReason === "unsupported_connector")
      output("Automatic sync disabled: update the connector.");
    try {
      output(
        `Last hook error: ${(await readFile(join(stateDirectory, "logs", "last-error.log"), "utf8")).trim()}`,
      );
    } catch {}
    finishRepair();
  } catch (error) {
    if (repairRequested) {
      repairIncomplete = true;
      if (!repairFailed)
        warning(
          `Vibe Racing repair error: ${error instanceof Error ? error.message : "unexpected error"}`,
        );
      output(repairStarted ? "Connector repair failed." : "Connector repair not run.");
    } else {
      output("Connector is not paired.");
    }
    finishRepair();
  }
}

async function sourceCommand() {
  const action = arguments_[1];
  if (action === "list") {
    let mappings = new Map();
    try {
      const config = await readConfig();
      mappings = new Map(config.sources.map((source) => [source.clientSourceId, source]));
    } catch {}
    for (const source of await readSources())
      output(
        `${source.clientSourceId}  ${source.agentId}  ${mappings.get(source.clientSourceId)?.accountLabel ?? source.suggestedLabel}`,
      );
    return;
  }
  if (action === "add") {
    const agentId = option("--agent");
    const dataPath = option("--data-dir", option("--path"));
    const label = option("--name", option("--label"))?.trim();
    const adapter = adapterFor(agentId);
    const legacyKimi = arguments_.includes("--legacy");
    const captureBased = agentId === "antigravity";
    if (
      !adapter ||
      (!captureBased && !dataPath) ||
      !label ||
      label.length > 40 ||
      (legacyKimi && agentId !== "kimi_code")
    )
      throw new Error(
        "Usage: viberacing source add --agent AGENT --name NAME [--data-dir PATH] [--legacy]",
      );
    await invalidateAndCancelConnectAttempt();
    const localMetadata =
      typeof adapter.localSourceMetadata === "function" ? await adapter.localSourceMetadata() : {};
    const result = await addSource({
      agentId,
      dataPath,
      ...localMetadata,
      collectionMethod: legacyKimi
        ? "kimi_legacy_wire_jsonl"
        : typeof adapter.collectionMethodForPath === "function" && dataPath
          ? adapter.collectionMethodForPath(dataPath)
          : adapter.collectionMethods[0],
      supportedSurface: adapter.supportedSurfaces[0],
      suggestedLabel: label,
    });
    output(
      result.added ? "Source saved locally." : "That local source was already configured.",
      "Run `viberacing connect` to approve it.",
    );
    return;
  }
  if (action === "remove") {
    const id = arguments_[2];
    const local = (await readSources()).find((source) => source.clientSourceId === id);
    if (!local) {
      output("Source is already absent locally.");
      return;
    }
    await invalidateAndCancelConnectAttempt();
    let config;
    try {
      config = await readConfig();
    } catch {}
    const mapping = config?.sources.find((source) => source.clientSourceId === id);
    try {
      await removeHookForSource(local, { removeLegacy: true });
    } catch (error) {
      throw new Error(`Hook cleanup failed; source metadata was kept for retry: ${error.message}`);
    }
    let remoteWarning = false;
    if (typeof mapping?.sourceId === "string") {
      try {
        await request(
          config.origin,
          `/api/sources/${mapping.sourceId}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${config.deviceToken}` },
          },
          1,
          { kind: "empty" },
        );
      } catch (error) {
        if (error?.status !== 404) remoteWarning = true;
      }
    }
    if (config) {
      config.sources = config.sources.filter((source) => source.clientSourceId !== id);
      await writeConfig(config);
    }
    try {
      reportOpenCodePluginTransition(
        await reconcilePluginForConfig(config, {
          cleanupUnrecorded: (mapping?.agentId ?? local.agentId) === "opencode",
        }),
        {
          connected: Boolean(config),
        },
      );
    } catch (error) {
      reportOpenCodePluginTransition(blockedOpenCodePluginResult(error), {
        connected: Boolean(config),
      });
    }
    if (typeof mapping?.sourceId === "string") await forgetSourceState([mapping.sourceId]);
    await clearDirtyForSources([id]);
    await removeSource(id);
    output("Source disconnected and removed locally.");
    if (remoteWarning)
      warning(
        "Vibe Racing warning: remote source disconnect could not be confirmed; its local hook and automatic state were removed.",
      );
    return;
  }
  throw new Error(
    "Usage: viberacing source list | source add --agent AGENT --name NAME [--data-dir PATH] [--legacy] | source remove ID",
  );
}

async function wrapperSource(agentId) {
  const separator = arguments_.indexOf("--");
  const controls = arguments_.slice(2, separator < 0 ? undefined : separator);
  const sourceOption = controls.indexOf("--source");
  const requested = sourceOption >= 0 ? controls[sourceOption + 1] : undefined;
  if (sourceOption >= 0 && !requested) throw new Error("--source requires a clientSourceId");
  let sources = (await readSources()).filter((source) => source.agentId === agentId);
  if (requested) {
    const selected = (await readSources()).find((source) => source.clientSourceId === requested);
    if (!selected) throw new Error(`Unknown ${agentId} source id`);
    if (selected.agentId !== agentId)
      throw new Error(`Selected source belongs to ${selected.agentId}`);
    return { source: selected, separator, sourceOption };
  }
  if (sources.length === 0) {
    const adapter = adapterFor(agentId);
    const created = await addSource({
      agentId,
      collectionMethod: adapter.collectionMethods[0],
      supportedSurface: adapter.supportedSurfaces[0],
      suggestedLabel: adapter.displayName.replace(/ CLI$/, ""),
    });
    sources = [created.source];
  }
  if (sources.length > 1)
    throw new Error(
      `Multiple ${agentId} sources are configured; choose one with --source <clientSourceId>`,
    );
  return { source: sources[0], separator, sourceOption };
}

async function wrap(agentId) {
  const { source, separator, sourceOption, executable } = await withOpenCodeLifecycleMutation(
    async () => {
      const selected = await wrapperSource(agentId);
      const resolvedExecutable =
        selected.source.executablePath ?? (await resolveAgentExecutable(agentId));
      if (!resolvedExecutable)
        throw new Error(
          `${adapterFor(agentId).displayName} executable was not found in installed apps, package-manager bins, or PATH; set ${executableOverride(agentId)} to its absolute path`,
        );
      if (selected.source.executablePath !== resolvedExecutable)
        await rememberSourceExecutable(selected.source.clientSourceId, resolvedExecutable);
      return { ...selected, executable: resolvedExecutable };
    },
  );
  const passed =
    separator >= 0
      ? arguments_.slice(separator + 1)
      : sourceOption >= 0
        ? arguments_
            .slice(2)
            .filter((_, index) => index !== sourceOption && index !== sourceOption + 1)
        : arguments_.slice(2);
  const { args } = wrapperInvocation(agentId, passed);
  const child = spawnResolvedExecutable(executable, args, {
    stdio: ["inherit", "pipe", "inherit"],
    windowsHide: true,
  });
  const outcomePromise = new Promise((resolve) => {
    child.once("error", (error) => resolve({ error }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const forwardInt = () => child.kill("SIGINT");
  const forwardTerm = () => child.kill("SIGTERM");
  process.once("SIGINT", forwardInt);
  process.once("SIGTERM", forwardTerm);
  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const safe = [];
  const seen = new Set();
  for await (const line of reader) {
    process.stdout.write(`${line}\n`);
    const record = safeCaptureRecord(agentId, line);
    if (record !== null && !seen.has(record.id)) {
      seen.add(record.id);
      safe.push(record);
    }
  }
  const outcome = await outcomePromise;
  if (outcome.error) throw outcome.error;
  process.removeListener("SIGINT", forwardInt);
  process.removeListener("SIGTERM", forwardTerm);
  if (safe.length && (await localSourceRegistryContains(source.clientSourceId))) {
    if (process.env.NODE_ENV === "test" && process.env.VIBERACING_TEST_WRAPPER_CAPTURE_READY)
      await writeFile(process.env.VIBERACING_TEST_WRAPPER_CAPTURE_READY, `${process.pid}\n`, {
        mode: 0o600,
      });
    const launch = await claimSchedulerLaunch({ waitMs: 5_000 });
    if (launch)
      try {
        const shouldSchedule = await withOpenCodeLifecycleMutation(async () => {
          if (!(await localSourceRegistryContains(source.clientSourceId))) return false;
          await appendCapture(source, safe);
          if (!(await connectedSourceMappingExists(source.clientSourceId))) return false;
          await markDirty(source.clientSourceId);
          return true;
        });
        if (shouldSchedule) await launchAutomaticScheduler(launch);
      } catch {
      } finally {
        await releaseSchedulerLaunch(launch);
      }
  }
  if (outcome.signal) process.kill(process.pid, outcome.signal);
  else process.exitCode = outcome.code ?? 1;
}

try {
  if (commandRequiresOpenCodeGuard()) {
    await assertOpenCodeUpgradeReady(stateDirectory);
    await waitForTestOpenCodePreflightBarrier("after_outer");
  }
  if (command === "--version" || command === "version") output(connectorVersion);
  else if (command === "upgrade-preflight") {
    await assertOpenCodeUpgradeReady(stateDirectory);
    output("OpenCode upgrade preflight passed.");
  } else if (command === "connect") await connect();
  else if (command === "sync") {
    await assertOpenCodeUpgradeReady(stateDirectory);
    const result = await sync(await readConnectedConfig(), { waitMs: manualSyncLockWaitMs });
    if (result?.skipped) throw new Error("Another sync is already running.");
  } else if (command === "hook") await hook();
  else if (command === "auto-sync") await automaticSync();
  else if (command === "handle-url") await browserSync(arguments_[1]);
  else if (command === "doctor") await doctor();
  else if (command === "accounts") {
    const config = await readConnectedConfig();
    for (const source of config.sources) output(`${source.agentId}: ${source.accountLabel}`);
  } else if (command === "source" && (arguments_[1] === "add" || arguments_[1] === "remove"))
    await withOpenCodeLifecycleMutation(() => sourceCommand());
  else if (command === "source") await sourceCommand();
  else if (command === "run" && arguments_[1] === "antigravity") await wrap("antigravity");
  else if (command === "disconnect") {
    let remoteError;
    let remotePairingCancellationUnconfirmed = false;
    let localCleanup = { warningCount: 0, plugin: null, pluginCleanup: null };
    await withLifecycleMutation(async () => {
      const pending = await invalidateAndCancelConnectAttempt();
      remotePairingCancellationUnconfirmed = pending.cancellation.status === "unconfirmed";
      try {
        const config = await readConfig();
        await request(
          config.origin,
          "/api/installations/current",
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${config.deviceToken}` },
          },
          1,
          { kind: "empty" },
        );
        if (
          pending.attempt?.origin === config.origin &&
          pending.attempt.installationId === config.installationId
        )
          remotePairingCancellationUnconfirmed = false;
      } catch (error) {
        const cancelledRotatedToken =
          pending.cancellation.status === "confirmed" &&
          (error?.status === 401 || error?.status === 403);
        if (error?.code !== "ENOENT" && !cancelledRotatedToken) remoteError = error;
      } finally {
        localCleanup = await disableLocalConnection(true);
      }
    });
    if (localCleanup.authorizationRemoved)
      output("Installation disconnected locally; provider histories were not changed.");
    else {
      warning(
        "Vibe Racing error: the local token file could not be removed; this installation is not fully disconnected locally.",
      );
      process.exitCode = 1;
    }
    if (remotePairingCancellationUnconfirmed)
      warning(
        "Vibe Racing warning: remote pairing cancellation could not be confirmed; the local connection attempt was invalidated.",
      );
    if (remoteError && localCleanup.authorizationRemoved)
      warning(
        "Vibe Racing warning: remote revoke could not be confirmed; the local token and hooks were removed.",
      );
    else if (remoteError)
      warning(
        "Vibe Racing warning: remote revoke could not be confirmed and the local token file remains.",
      );
    reportOpenCodeCleanupFailures(localCleanup.pluginCleanup);
    if (localCleanup.warningCount && localCleanup.authorizationRemoved)
      warning(
        "Vibe Racing warning: local authorization was removed, but one or more auxiliary cleanup steps need manual inspection.",
      );
  } else if (command === "reset-installation") {
    const cleanup = await withOpenCodeLifecycleMutation(async () => {
      const { cleanupContext, revocationPrepare } = await prepareOpenCodePluginTeardown();
      await invalidateAndCancelConnectAttempt();
      const result = await removeHooks();
      const pluginCleanup = await cleanupOpenCodePluginTargets({
        includeInstallation: true,
        cleanupContext,
        preserveTargetsOnUnreadableJournals: true,
      });
      if (pluginCleanup.preserveInstallationIdentity) await removeConfig();
      else await resetInstallation();
      await clearAutomaticState();
      return { ...result, pluginCleanup, revocationPrepare };
    });
    if (cleanup.pluginCleanup.preserveInstallationIdentity)
      warning(
        cleanup.pluginCleanup.preserveInstallationIdentityReason === "cleanup-metadata-unreadable"
          ? "Vibe Racing error: the installation identity was retained because OpenCode cleanup metadata is unreadable."
          : "Vibe Racing error: the unreadable installation identity was retained because it may contain the only exact OpenCode plugin recovery path.",
      );
    else
      output(
        "Installation identity reset. The prior server installation must be disconnected separately if still active.",
      );
    if (cleanup.failures.length > 0)
      warning(
        `Vibe Racing warning: ${cleanup.failures.length} owned hook root(s) could not be cleaned; local source metadata was retained.`,
      );
    reportOpenCodeCleanupFailures(cleanup.pluginCleanup);
    if (cleanup.pluginCleanup.failures.length > 0) {
      const paths = [
        ...new Set(cleanup.pluginCleanup.failures.map((failure) => failure.path).filter(Boolean)),
      ];
      warning(
        `Vibe Racing warning: OpenCode plugin cleanup is incomplete${paths.length > 0 ? ` at ${paths.join(", ")}` : ""}. Fix XDG_CONFIG_HOME, permissions, or the foreign plugin conflict, then run \`viberacing uninstall\` again.`,
      );
      process.exitCode = 1;
    }
  } else if (command === "uninstall") {
    if (!(await localInstallationStateExists()))
      throw new Error(
        "No Vibe Racing installation was found in the selected state directory. Set VIBERACING_STATE_DIR to the value used during connect.",
      );
    const cleanup = await withLifecycleMutation(async () => {
      const { cleanupContext, revocationPrepare } = await prepareOpenCodePluginTeardown();
      await invalidateAndCancelConnectAttempt();
      let config = null;
      try {
        config = await readConfig();
        await request(
          config.origin,
          "/api/installations/current",
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${config.deviceToken}` },
          },
          1,
          { kind: "empty" },
        );
      } catch {}
      const result = await removeHooks();
      let browserCleanupFailed = false;
      try {
        await unregisterBrowserSync();
      } catch {
        browserCleanupFailed = true;
      }
      const pluginCleanup = await cleanupOpenCodePluginTargets({
        includeInstallation: true,
        cleanupContext,
        preserveTargetsOnUnreadableJournals: true,
      });
      const complete =
        result.failures.length === 0 &&
        !browserCleanupFailed &&
        pluginCleanup.failures.length === 0;
      if (complete) await clearAutomaticState({ afterStopped: removeLocalState });
      else {
        if (pluginCleanup.preserveInstallationIdentity) await removeConfig();
        else await resetInstallation();
        await clearAutomaticState();
      }
      return {
        ...result,
        browserCleanupFailed,
        pluginCleanup,
        revocationPrepare,
        complete,
      };
    });
    reportOpenCodeCleanupFailures(cleanup.pluginCleanup);
    if (cleanup.complete)
      output(
        "Vibe Racing hooks, installed copy, secrets, and local state removed. Provider data was not changed.",
      );
    else if (cleanup.pluginCleanup.preserveInstallationIdentity) {
      output(
        cleanup.pluginCleanup.preserveInstallationIdentityReason === "cleanup-metadata-unreadable"
          ? "Vibe Racing OpenCode cleanup metadata was unreadable; installation identity, cleanup metadata, and runtime were retained for recovery."
          : "Vibe Racing installation identity was unreadable; it, cleanup metadata, and runtime were retained for recovery.",
      );
      warning(
        "Vibe Racing warning: local installation secrets could not be safely separated from plugin recovery evidence. Repair or remove the reported installation state, then run `viberacing uninstall` again.",
      );
      process.exitCode = 1;
    } else {
      output(
        "Vibe Racing network access and secrets were removed; cleanup metadata and runtime were retained for retry.",
      );
      warning(
        `Vibe Racing warning: ${cleanup.failures.length} owned hook root(s), ${cleanup.browserCleanupFailed ? 1 : 0} browser handler(s), and ${cleanup.pluginCleanup.failures.length} OpenCode plugin cleanup target(s) could not be completed. Fix the reported settings and run \`viberacing uninstall\` again.`,
      );
      if (cleanup.pluginCleanup.failures.some((failure) => failure.retentionError))
        warning(
          "Vibe Racing warning: OpenCode cleanup metadata could not be retained; keep the reported plugin path for manual cleanup.",
        );
      for (const failure of cleanup.failures)
        warning(`- ${failure.agentId ?? "sources"}: ${failure.path} (${failure.message})`);
      process.exitCode = 1;
    }
  } else
    output(
      "Usage: viberacing upgrade-preflight | connect [--origin URL] | sync | doctor [--repair] | accounts | source … | disconnect | uninstall | reset-installation | run antigravity [--source ID] -- …",
    );
} catch (error) {
  if (error?.diagnosticCode === "opencode_cutover_required")
    warning(`Vibe Racing: ${error.message}`);
  else if (quiet && !lastHookErrorRecorded) await recordLastHookError();
  if (!quiet && error?.diagnosticCode !== "opencode_cutover_required")
    warning(`Vibe Racing: ${error instanceof Error ? error.message : "unexpected error"}`);
  process.exitCode = 1;
}
