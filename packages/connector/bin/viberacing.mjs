#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
import { parseProtocolResponse } from "../lib/protocol.mjs";
import { normalizeOrigin } from "../lib/origin.mjs";
import {
  adapters,
  adapterFor,
  discoverSources,
  recentEntries,
  safeCaptureRecord,
  wrapperInvocation,
} from "../lib/readers.mjs";
import { openBrowser } from "../lib/browser.mjs";
import {
  browserSyncRegistrationStatus,
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
  clearConnectAttempt,
  commitConnectionState,
  connectedStateExists,
  connectedSourceMappingExists,
  diagnoseHooks,
  invalidateConnectAttempt,
  localSourceRegistryContains,
  prepareRuntime,
  reconcileHooks,
  readConfig,
  readOrCreateInstallation,
  readSources,
  recordConnectAttemptPairing,
  rememberSourceExecutable,
  reconcileDetectedSources,
  removeHookForSource,
  removeHooks,
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
  claimScheduler,
  claimSchedulerLaunch,
  compactCapture,
  clearAutomaticState,
  clearDirty,
  clearDirtyForSources,
  clearQuarantine,
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

const protocolVersion = 2;
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

function collectorWarningMessage(code) {
  if (code === "codex_session_components_incomplete")
    return "local Codex token components are incomplete for one or more requested UTC days; authoritative daily totals remain available";
  return `local usage detail warning: ${code}`;
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

async function reconcilePreviousConnectionBeforePairing(origin, installationId) {
  return withLifecycleMutation(async () => {
    let previousConfig;
    try {
      previousConfig = await readConfig();
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    if (previousConfig.origin !== origin || previousConfig.installationId !== installationId)
      return null;
    let remote;
    try {
      remote = await requestReconciliation(previousConfig);
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        const cleanupWarnings = await disableLocalConnection(true);
        output("Previous installation authorization is no longer valid; reconnecting…");
        if (cleanupWarnings)
          warning(
            "Vibe Racing warning: local authorization was removed, but one or more auxiliary cleanup steps need manual inspection.",
          );
        return null;
      }
      throw error;
    }
    await reconcileRemoteSources(previousConfig, remote.sources, { allowDuringLifecycle: true });
    return previousConfig;
  });
}

async function connect() {
  const origin = normalizeOrigin(option("--origin", "https://viberacing.com"), "--origin");
  output("Detecting supported agent sources…");
  const discovery = await discoverSources();
  const detected = discovery.sources;
  for (const diagnostic of discovery.diagnostics)
    warning(`Vibe Racing warning: ${diagnostic.displayName}: ${diagnostic.error}.`);
  const sourcesBeforeDiscovery = await readSources();
  const localSources = await reconcileDetectedSources(detected, { persist: false });
  const localSourceIds = new Set(localSources.map((source) => source.clientSourceId));
  const supersededClientSourceIds = sourcesBeforeDiscovery
    .filter((source) => !localSourceIds.has(source.clientSourceId))
    .map((source) => source.clientSourceId);
  const exactSources = await exactPairingSources(localSources);
  const sources = new Map(exactSources.map((source) => [source.clientSourceId, source]));
  if (exactSources.length === 0)
    throw new Error(
      "No exact token source was found yet. Run a supported agent at least once, or add its token data root explicitly. Try `viberacing doctor` or `viberacing source add --agent <agent> --name <label> --data-dir <usage-root>`.",
    );
  const installedRuntime = await prepareRuntime(import.meta.url);
  const browserSyncCapable = await registerBrowserSync(installedRuntime);
  if (!browserSyncCapable)
    warning(
      "Vibe Racing warning: browser Sync could not be registered; CLI sync remains available.",
    );
  const installation = await readOrCreateInstallation();
  await invalidateAndCancelConnectAttempt();
  const previousConfig = await reconcilePreviousConnectionBeforePairing(origin, installation.id);
  const pairingLocalSources = new Map(sources);
  if (previousConfig !== null) {
    const localById = new Map(localSources.map((source) => [source.clientSourceId, source]));
    for (const previous of previousConfig.sources) {
      const local = localById.get(previous.clientSourceId);
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
  const initialAttempt = await beginConnectAttempt({
    installationId: installation.id,
    origin,
    expectedSources: sourcesBeforeDiscovery,
  });
  let attempt = initialAttempt;
  let pairing;
  let committed = false;
  try {
    pairing = await request(
      origin,
      "/api/pairing/start",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocolVersion,
          connectorVersion,
          installationId: installation.id,
          installationSecret: installation.secret,
          sources: [...sources.values()].map(publicSource),
          supersededClientSourceIds,
          browserSyncCapable,
        }),
      },
      1,
      { kind: "pairingStart", origin, installationId: installation.id },
    );
    attempt = await recordConnectAttemptPairing(initialAttempt, pairing.pollToken);
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
        const config = await withLifecycleMutation(async () => {
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
          const hooks = await reconcileHooks(import.meta.url, mapped, knownForHookCleanup, {
            installedScript: installedRuntime,
          });
          for (const failure of hooks.failures)
            warning(
              `Vibe Racing warning: ${failure.agentId ?? "connector"} hook: ${failure.message}.`,
            );
          await confirmAutomaticCompatibility();
          return nextConfig;
        });
        committed = true;
        output("Connected. Exact aggregate sync is active.");
        const initial = await sync(config, { waitMs: automaticSyncLockWaitMs });
        if (initial?.skipped) throw new Error("Timed out waiting to start the initial sync");
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
  return { rangeStart: start.toISOString().slice(0, 10), rangeEnd: end.toISOString().slice(0, 10) };
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
      await removeHookForSource(source, { removeLegacy: true });
    } catch (error) {
      warning(
        `Vibe Racing warning: hook cleanup failed for disconnected ${source.agentId} source: ${error.message}`,
      );
    }
  await clearDirtyForSources(mappings.map((source) => source.clientSourceId));
  await forgetSourceState(mappings.map((source) => source.sourceId));
  config.sources = config.sources.filter((source) => !retired.has(source.sourceId));
  await writeConfig(config);
  return mappings;
}

async function requestReconciliation(config, attempts = 1) {
  const sourceIds = config.sources.map((source) => source.sourceId);
  return request(
    config.origin,
    "/api/installations/current",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.deviceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sourceIds }),
    },
    attempts,
    { kind: "reconciliation", sourceIds },
  );
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
  }
  if (changed) {
    await writeState(state);
    await writeConfig(config);
  }
  return state;
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
    await disableLocalConnection(true);
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
  const missing = config.sources.some(
    (source) =>
      typeof source.sourceId === "string" && state.sequences?.[source.sourceId] === undefined,
  );
  const lastReconciliation = state.lastRemoteReconciliationAt;
  if (!missing && lastReconciliation === undefined) {
    state.lastRemoteReconciliationAt = Date.now();
    await writeState(state);
    return state;
  }
  if (
    !missing &&
    Number.isFinite(lastReconciliation) &&
    Date.now() - lastReconciliation < remoteReconciliationIntervalMs
  )
    return state;
  let remote;
  try {
    remote = await requestReconciliation(config, missing ? 3 : 1);
  } catch (error) {
    if (missing || error?.status === 401 || error?.status === 403 || error?.status === 426)
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
  const reconciled = await rememberServerSequences(
    config,
    remote.sources?.map((source) => ({
      sourceId: source.sourceId,
      lastAcceptedSyncSequence: source.lastAcceptedSyncSequence,
    })),
  );
  reconciled.lastRemoteReconciliationAt = Date.now();
  await writeState(reconciled);
  return reconciled;
}

async function deliverPendingGroup(config, items, retired) {
  const eligible = [];
  for (const item of items) {
    if (retired.has(item.sourceId)) await removePending(item.path);
    else eligible.push(item);
  }
  if (eligible.length === 0) return { accepted: 0, staleSources: [], quarantinedSources: [] };
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
    return { accepted: result.acceptedEntries ?? 0, staleSources, quarantinedSources: [] };
  } catch (error) {
    if (error?.status === 400 && eligible.length > 1) {
      const middle = Math.ceil(eligible.length / 2);
      const left = await deliverPendingGroup(config, eligible.slice(0, middle), retired);
      const right = await deliverPendingGroup(config, eligible.slice(middle), retired);
      return {
        accepted: left.accepted + right.accepted,
        staleSources: [...left.staleSources, ...right.staleSources],
        quarantinedSources: [...left.quarantinedSources, ...right.quarantinedSources],
      };
    }
    if (error?.status === 400 && error?.code === "unsupported_source") {
      retired.add(eligible[0].sourceId);
      await removePending(eligible[0].path);
      return { accepted: 0, staleSources: [], quarantinedSources: [] };
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
      return { accepted: 0, staleSources: [], quarantinedSources: [item.sourceId] };
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
      Buffer.byteLength(JSON.stringify(payload)) > 120_000;
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
  for (const path of await pendingPayloads()) {
    let payload;
    try {
      payload = await readPending(path);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const sourceId = pendingSourceId(payload);
    if (sourceId === null) throw new Error("Invalid pending payload");
    if (!configured.has(sourceId)) {
      await removePending(path);
      continue;
    }
    if (allowedSourceIds && !allowedSourceIds.has(sourceId)) continue;
    items.push({ path, payload, sourceId });
  }
  const retired = new Set();
  let accepted = 0;
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
    for (const sourceId of retried.retiredSources) retired.add(sourceId);
    for (const sourceId of retried.quarantinedSources) quarantinedSources.add(sourceId);
  }
  return {
    accepted,
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

async function sync(providedConfig, options = {}) {
  return withSyncLock(
    async () => {
      const config = providedConfig ?? (await readConfig());
      const requestedSourceIds = Array.isArray(options.sourceIds)
        ? new Set(options.sourceIds)
        : undefined;
      const previous = await drainPending(config, true, requestedSourceIds);
      let accepted = previous.accepted;
      let state = await readState();
      state = await reconcileServerState(config, state);
      const range = snapshotRange();
      state.adapters ??= {};
      state.fingerprints ??= {};
      state.collectionWarnings ??= {};
      const mappedSources = config.sources.filter((source) => typeof source.sourceId === "string");
      const dirty = await readDirty();
      const dirtyIds = new Set(dirtyEntries(dirty).map(([clientSourceId]) => clientSourceId));
      const syncSources = requestedSourceIds
        ? mappedSources.filter((source) => requestedSourceIds.has(source.sourceId))
        : options.automatic
          ? mappedSources.filter((source) => dirtyIds.has(source.clientSourceId))
          : mappedSources;
      if (requestedSourceIds && syncSources.length !== requestedSourceIds.size)
        throw new Error("Browser sync requested an unavailable source");
      const activeIds = new Set(mappedSources.map((source) => source.clientSourceId));
      const unmappedDirtyIds = [...dirtyIds].filter(
        (clientSourceId) => !activeIds.has(clientSourceId),
      );
      if (unmappedDirtyIds.length > 0) await clearDirtyForSources(unmappedDirtyIds);
      const claims = dirtyClaims(
        dirty,
        syncSources.map((source) => source.clientSourceId),
      );
      if (options.automatic && syncSources.length > 0) {
        state.lastAutomaticSyncAt = Date.now();
        await writeState(state);
      }
      const collected = await settleLimited(syncSources, async (source) => {
        if (process.env.NODE_ENV === "test" && process.env.VIBERACING_TEST_COLLECTOR_TRACE)
          await appendFile(
            process.env.VIBERACING_TEST_COLLECTOR_TRACE,
            `${source.clientSourceId}\n`,
          );
        const adapter = adapterFor(source.agentId);
        if (!adapter || !adapter.collectionMethods.includes(source.collectionMethod))
          throw new Error(`Unsupported configured source ${source.agentId}`);
        return {
          source,
          result: await adapter.collect(source, range, state.adapters[source.sourceId] ?? {}),
        };
      });
      const snapshots = [];
      const sourceErrors = [];
      const failures = [];
      const failedClientSourceIds = [];
      const collectionWarnings = [];
      const successfullyChecked = [];
      const successfullyCheckedSourceIds = [];
      for (let index = 0; index < collected.length; index += 1) {
        const outcome = collected[index];
        const source = syncSources[index];
        if (outcome.status === "rejected") {
          failedClientSourceIds.push(source.clientSourceId);
          failures.push(`${source.agentId}: ${outcome.reason?.message ?? "collector failed"}`);
          const nextFingerprint = fingerprint({ error: "collector_failed" });
          if (state.fingerprints[source.sourceId] !== nextFingerprint) {
            sourceErrors.push({ sourceId: source.sourceId, code: "collector_failed" });
            state.fingerprints[source.sourceId] = nextFingerprint;
          }
          reconcileDiagnosticPhase(state, source.sourceId, "collect", [
            collectorDiagnostic(outcome.reason),
          ]);
          continue;
        }
        successfullyChecked.push(source.clientSourceId);
        successfullyCheckedSourceIds.push(source.sourceId);
        state.adapters[source.sourceId] = outcome.value.result.nextState ?? {};
        reconcileDiagnosticPhase(
          state,
          source.sourceId,
          "collect",
          normalizeAdapterDiagnostics(outcome.value.result.diagnostics),
        );
        const resultWarnings = [...new Set(outcome.value.result.warnings ?? [])].sort();
        if (resultWarnings.length) state.collectionWarnings[source.sourceId] = resultWarnings;
        else delete state.collectionWarnings[source.sourceId];
        for (const code of resultWarnings)
          collectionWarnings.push(`${source.agentId}: ${collectorWarningMessage(code)}`);
        const entries = recentEntries(outcome.value.result.entries);
        const nextFingerprint = fingerprint({
          ...range,
          completeness: outcome.value.result.completeness,
          entries,
          warnings: resultWarnings,
        });
        if (state.fingerprints[source.sourceId] === nextFingerprint) continue;
        const previous = BigInt(state.sequences[source.sourceId] ?? "0");
        const sequence = (previous + 1n).toString();
        state.sequences[source.sourceId] = sequence;
        state.fingerprints[source.sourceId] = nextFingerprint;
        snapshots.push({
          sourceId: source.sourceId,
          syncSequence: sequence,
          ...range,
          completeness: outcome.value.result.completeness,
          entries,
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
        if (failures.length === 0 && syncSources.length > 0)
          await compactSuccessfulCaptures({ ...config, sources: syncSources });
        const diagnosticDelivery = await finishSuccessfulSourceDiagnostics(
          config,
          successfullyCheckedSourceIds,
          requestedSourceIds,
        );
        output(
          diagnosticDelivery.attempted
            ? "No usage changes; a diagnostics request was attempted."
            : "No usage changes; no request was sent.",
        );
        for (const message of collectionWarnings) warning(`Vibe Racing warning: ${message}.`);
        if (failures.length) warning(`Vibe Racing partial sync: ${failures.join("; ")}`);
        return { accepted, failures, unchanged: true };
      }
      const payload = { protocolVersion, snapshots, sourceErrors };
      if (await lifecycleMutationActive())
        throw new Error("Sync persistence stopped by a local lifecycle operation");
      await savePending(payload);
      const delivered = await drainPending(config, true, requestedSourceIds);
      accepted += delivered.accepted;
      await clearSuccessfulDirty();
      await finishSuccessfulSourceDiagnostics(
        config,
        successfullyCheckedSourceIds,
        requestedSourceIds,
      );
      if (successfullyCheckedSourceIds.length === 0) {
        const error = new Error(failures.join("; ") || "No configured collectors succeeded");
        error.automaticDiagnosticClientSourceIds = failedClientSourceIds;
        throw error;
      }
      output(`Synced ${accepted} daily totals from ${snapshots.length} source(s).`);
      for (const message of collectionWarnings) warning(`Vibe Racing warning: ${message}.`);
      for (const sourceId of [...previous.retiredSources, ...delivered.retiredSources])
        failures.push(`server disconnected source ${sourceId}`);
      for (const sourceId of [...previous.quarantinedSources, ...delivered.quarantinedSources])
        failures.push(`server rejected source ${sourceId}; payload quarantined`);
      if (failures.length === 0)
        await compactSuccessfulCaptures({ ...config, sources: syncSources });
      if (failures.length) warning(`Vibe Racing partial sync: ${failures.join("; ")}`);
      return { accepted, failures };
    },
    { waitMs: options.waitMs ?? (options.automatic ? automaticSyncLockWaitMs : 0) },
  );
}

function parseBrowserSyncUrl(value) {
  if (typeof value !== "string" || value.length > 1_024)
    throw new Error("Invalid browser Sync URL");
  const url = new URL(value);
  const keys = [...url.searchParams.keys()].sort();
  if (
    url.protocol !== "viberacing:" ||
    url.hostname !== "sync" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.hash !== "" ||
    JSON.stringify(keys) !== JSON.stringify(["accountId", "grant", "requestId"]) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      url.searchParams.get("requestId") ?? "",
    ) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      url.searchParams.get("accountId") ?? "",
    ) ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(url.searchParams.get("grant") ?? "")
  )
    throw new Error("Invalid browser Sync URL");
  return {
    requestId: url.searchParams.get("requestId"),
    accountId: url.searchParams.get("accountId"),
    grant: url.searchParams.get("grant"),
  };
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
  const link = parseBrowserSyncUrl(value);
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
  const requested = new Set(claim.sourceIds);
  const local = config.sources.filter(
    (source) => requested.has(source.sourceId) && source.agentAccountId === link.accountId,
  );
  if (local.length !== requested.size) {
    await reportBrowserSync(config, link.requestId, "failed", "invalid_request").catch(() => {});
    throw new Error("Browser sync source mapping changed");
  }
  try {
    const result = await sync(config, { sourceIds: claim.sourceIds, waitMs: manualSyncLockWaitMs });
    if (result?.skipped) await reportBrowserSync(config, link.requestId, "failed", "busy");
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
        : error?.message?.includes("collector")
          ? "collector_failed"
          : "network_failed";
    await reportBrowserSync(config, link.requestId, "failed", resultCode).catch(() => {});
    throw error;
  }
}

async function launchAutomaticScheduler(existingLaunch) {
  if ((await lifecycleMutationActive()) || !(await connectedStateExists())) return false;
  const launch = existingLaunch ?? (await claimSchedulerLaunch());
  if (!launch) return false;
  const ownsLaunch = existingLaunch === undefined;
  try {
    if ((await lifecycleMutationActive()) || !(await connectedStateExists())) return false;
    const state = await readState();
    if (state.automaticDisabledReason) return false;
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), "auto-sync", "--quiet"],
      {
        detached: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
      },
    );
    const status = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };
      const timeout = setTimeout(
        () => {
          child.kill();
          finish("lost");
        },
        process.env.NODE_ENV === "test" ? 5_000 : 2_000,
      );
      child.once("message", (message) =>
        finish(message?.type === "viberacing-scheduler" ? message.status : "lost"),
      );
      child.once("error", () => finish("lost"));
      child.once("exit", () => finish("lost"));
    });
    child.unref();
    return status === "acquired";
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
  if (typeof process.send !== "function") return;
  await new Promise((resolve) =>
    process.send({ type: "viberacing-scheduler", status }, () => resolve()),
  );
  process.disconnect?.();
}

async function recordAutomaticSyncFailure(clientSourceIds) {
  const selected = new Set(clientSourceIds);
  if (selected.size === 0) return;
  const recorded = await withSyncLock(
    async () => {
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

async function hook() {
  try {
    if (process.env.NODE_ENV === "test" && process.env.VIBERACING_TEST_HOOK_READY)
      await writeFile(process.env.VIBERACING_TEST_HOOK_READY, `${process.pid}\n`, { mode: 0o600 });
    for await (const _chunk of process.stdin) {
      // Hook input can contain private agent context. Discard it without parsing or logging.
    }
    const clientSourceId = option("--source");
    const agentId = option("--agent");
    if (await markDirtyIfConnected(clientSourceId, agentId)) {
      const launch = await claimSchedulerLaunch({ waitMs: 0 });
      if (launch)
        try {
          await launchAutomaticScheduler(launch);
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
  if (process.env.NODE_ENV === "test" && process.env.VIBERACING_TEST_SCHEDULER_TRACE)
    await appendFile(process.env.VIBERACING_TEST_SCHEDULER_TRACE, `started:${process.pid}\n`);
  await waitForTestSchedulerClaimBarrier();
  if (await lifecycleMutationActive()) {
    await sendSchedulerHandshake("lost");
    return;
  }
  const scheduler = await claimScheduler();
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
  const discovery = await discoverSources();
  const detected = discovery.sources;
  const localSources = await readSources().catch(() => []);
  output(`Connector: ${connectorVersion}; protocol: ${protocolVersion}`);
  output(`Browser Sync handler: ${await browserSyncRegistrationStatus()}`);
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
    let config = await readConfig();
    let state = await readState();
    if (arguments_.includes("--repair")) {
      const repaired = await reconcileHooks(import.meta.url, config.sources, await readSources());
      output(
        repaired.failures.length === 0
          ? "Installed connector copy and owned hooks repaired."
          : `Hook repair completed with ${repaired.failures.length} warning(s).`,
      );
      for (const failure of repaired.failures)
        output(`Hook repair warning (${failure.agentId ?? "connector"}): ${failure.message}`);
    }
    const hooks = await diagnoseHooks(config.sources);
    for (const [agentId, status] of Object.entries(hooks)) output(`${agentId} hook: ${status}`);
    output(`Connected origin: ${config.origin}`);
    const reconciliation = await withSyncLock(
      async () => {
        const lockedConfig = await readConfig();
        let remote;
        try {
          remote = await requestReconciliation(lockedConfig);
        } catch (error) {
          if (await lifecycleMutationActive()) return { status: "lifecycle" };
          if (error?.status === 401 || error?.status === 403) {
            const cleanupWarnings = await disableLocalConnection();
            return { status: "revoked", cleanupWarnings };
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
    );
    if (reconciliation?.skipped) {
      output("Pairing status: busy; timed out waiting for an active sync.");
    } else if (reconciliation.status === "lifecycle") {
      output("Pairing status: busy; a local lifecycle operation is active.");
    } else if (reconciliation.status === "revoked") {
      output("Pairing status: disconnected. Installation authorization was revoked.");
      output("Run `viberacing connect` to reconnect this installation.");
      if (reconciliation.cleanupWarnings)
        output("One or more auxiliary hook cleanup steps need manual inspection.");
      return;
    } else if (reconciliation.status === "unsupported") {
      output("Pairing status: connector update required; automatic sync is disabled.");
      return;
    } else if (reconciliation.status === "error") {
      output(`Pairing status: error (${reconciliation.error.message})`);
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
  } catch {
    output("Connector is not paired.");
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
  const { source, separator, sourceOption } = await wrapperSource(agentId);
  const passed =
    separator >= 0
      ? arguments_.slice(separator + 1)
      : sourceOption >= 0
        ? arguments_
            .slice(2)
            .filter((_, index) => index !== sourceOption && index !== sourceOption + 1)
        : arguments_.slice(2);
  const { args } = wrapperInvocation(agentId, passed);
  const executable = source.executablePath ?? (await resolveAgentExecutable(agentId));
  if (!executable)
    throw new Error(
      `${adapterFor(agentId).displayName} executable was not found in installed apps, package-manager bins, or PATH; set ${executableOverride(agentId)} to its absolute path`,
    );
  if (source.executablePath !== executable)
    await rememberSourceExecutable(source.clientSourceId, executable);
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
        if (
          !(await lifecycleMutationActive()) &&
          (await localSourceRegistryContains(source.clientSourceId))
        ) {
          await appendCapture(source, safe);
          if (await connectedSourceMappingExists(source.clientSourceId)) {
            await markDirty(source.clientSourceId);
            await launchAutomaticScheduler(launch);
          }
        }
      } catch {
      } finally {
        await releaseSchedulerLaunch(launch);
      }
  }
  if (outcome.signal) process.kill(process.pid, outcome.signal);
  else process.exitCode = outcome.code ?? 1;
}

try {
  if (command === "--version" || command === "version") output(connectorVersion);
  else if (command === "connect") await connect();
  else if (command === "sync") {
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
    await withLifecycleMutation(() => sourceCommand());
  else if (command === "source") await sourceCommand();
  else if (command === "run" && arguments_[1] === "antigravity") await wrap("antigravity");
  else if (command === "disconnect") {
    let remoteError;
    let remotePairingCancellationUnconfirmed = false;
    let localWarnings = 0;
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
        localWarnings = await disableLocalConnection(true);
      }
    });
    output("Installation disconnected locally; provider histories were not changed.");
    if (remotePairingCancellationUnconfirmed)
      warning(
        "Vibe Racing warning: remote pairing cancellation could not be confirmed; the local connection attempt was invalidated.",
      );
    if (remoteError)
      warning(
        "Vibe Racing warning: remote revoke could not be confirmed; the local token and hooks were removed.",
      );
    if (localWarnings)
      warning(
        "Vibe Racing warning: local authorization was removed, but one or more auxiliary cleanup steps need manual inspection.",
      );
  } else if (command === "reset-installation") {
    const cleanup = await withLifecycleMutation(async () => {
      await invalidateAndCancelConnectAttempt();
      const result = await removeHooks();
      await resetInstallation();
      await clearAutomaticState();
      return result;
    });
    output(
      "Installation identity reset. The prior server installation must be disconnected separately if still active.",
    );
    if (cleanup.failures.length > 0)
      warning(
        `Vibe Racing warning: ${cleanup.failures.length} owned hook root(s) could not be cleaned; local source metadata was retained.`,
      );
  } else if (command === "uninstall") {
    const cleanup = await withLifecycleMutation(async () => {
      await invalidateAndCancelConnectAttempt();
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
      } catch {}
      const result = await removeHooks();
      let browserCleanupFailed = false;
      try {
        await unregisterBrowserSync();
      } catch {
        browserCleanupFailed = true;
      }
      if (result.failures.length === 0 && !browserCleanupFailed)
        await clearAutomaticState({ afterStopped: removeLocalState });
      else {
        await resetInstallation();
        await clearAutomaticState();
      }
      return { ...result, browserCleanupFailed };
    });
    if (cleanup.failures.length === 0 && !cleanup.browserCleanupFailed)
      output(
        "Vibe Racing hooks, installed copy, secrets, and local state removed. Provider data was not changed.",
      );
    else {
      output(
        "Vibe Racing network access and secrets were removed; cleanup metadata and runtime were retained for retry.",
      );
      warning(
        `Vibe Racing warning: ${cleanup.failures.length} owned hook root(s) and ${cleanup.browserCleanupFailed ? 1 : 0} browser handler(s) could not be cleaned. Fix the reported settings and run \`viberacing uninstall\` again.`,
      );
      for (const failure of cleanup.failures)
        warning(`- ${failure.agentId ?? "sources"}: ${failure.path} (${failure.message})`);
      process.exitCode = 1;
    }
  } else
    output(
      "Usage: viberacing connect [--origin URL] | sync | doctor [--repair] | accounts | source … | disconnect | uninstall | reset-installation | run antigravity [--source ID] -- …",
    );
} catch (error) {
  if (quiet) {
    const directory = join(stateDirectory, "logs");
    await mkdir(directory, { recursive: true, mode: 0o700 }).catch(() => {});
    await writeFile(
      join(directory, "last-error.log"),
      `${new Date().toISOString()} ${command === "auto-sync" ? "automatic_sync_failed" : "connector_command_failed"}\n`,
      { mode: 0o600 },
    ).catch(() => {});
  }
  if (!quiet)
    warning(`Vibe Racing: ${error instanceof Error ? error.message : "unexpected error"}`);
  process.exitCode = 1;
}
