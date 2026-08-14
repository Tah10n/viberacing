#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  adapterFor,
  defaultSources,
  recentEntries,
  safeCaptureRecord,
  wrapperInvocation,
} from "../lib/readers.mjs";
import { openBrowser } from "../lib/browser.mjs";
import {
  addSource,
  diagnoseHooks,
  reconcileHooks,
  readConfig,
  readOrCreateInstallation,
  readSources,
  reconcileDetectedSources,
  removeConfig,
  removeHookForSource,
  removeHooks,
  removeLocalState,
  removeSource,
  resetInstallation,
  stateDirectory,
  writeConfig,
} from "../lib/config.mjs";
import {
  automaticDueAt,
  configuredAutomaticSyncTimings,
  appendCapture,
  claimScheduler,
  compactCapture,
  clearAutomaticState,
  clearDirty,
  clearDirtyForSources,
  clearPendingPayloads,
  clearQuarantine,
  markDirty,
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
  mergePendingPayloads,
  removePending,
  removePendingForSource,
  savePending,
  withLifecycleMutation,
  withSyncLock,
  writeState,
} from "../lib/runtime.mjs";

const connectorVersion = "0.2.0";
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
const option = (name, fallback) => {
  const index = arguments_.indexOf(name);
  return index >= 0 && arguments_[index + 1] ? arguments_[index + 1] : fallback;
};
const output = (...values) => {
  if (!quiet) process.stdout.write(`${values.join(" ")}\n`);
};

function normalizedOrigin(value) {
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash || !["https:", "http:"].includes(url.protocol))
    throw new Error("--origin must be an HTTP(S) origin");
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname))
    throw new Error("Non-local origins must use HTTPS");
  return url.origin;
}

async function request(origin, path, options = {}, attempts = 1) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${origin}${path}`, {
        ...options,
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(
          `Vibe Racing returned ${response.status}: ${payload.error ?? "request failed"}`,
        );
        error.status = response.status;
        error.code = payload.error;
        if (response.status < 500 && response.status !== 429) throw error;
        lastError = error;
      } else return payload;
    } catch (error) {
      lastError = error;
      if (error?.status && error.status < 500 && error.status !== 429) throw error;
    }
    if (attempt + 1 < attempts)
      await delay(Math.min(8_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250));
  }
  throw lastError;
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

async function connect() {
  const origin = normalizedOrigin(option("--origin", "https://viberacing.com"));
  output("Detecting supported agent sources…");
  const detected = await defaultSources();
  const localSources = await reconcileDetectedSources(detected);
  const sources = new Map(localSources.map((source) => [source.clientSourceId, source]));
  if (localSources.length === 0)
    throw new Error(
      "No exact supported source was found. Run an agent once or add a source explicitly.",
    );
  const installation = await readOrCreateInstallation();
  output(`Found: ${[...sources.values()].map((source) => source.suggestedLabel).join(", ")}`);
  const pairing = await request(origin, "/api/pairing/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      protocolVersion,
      connectorVersion,
      installationId: installation.id,
      installationSecret: installation.secret,
      sources: [...sources.values()].map(publicSource),
    }),
  });
  output(`Open ${pairing.verificationUrl}`);
  output(`Pairing code: ${pairing.code}`);
  openBrowser(pairing.verificationUrl);
  const deadline = Date.now() + pairing.expiresInSeconds * 1_000;
  while (Date.now() < deadline) {
    await delay(2_000);
    const result = await request(origin, "/api/pairing/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installationId: pairing.installationId,
        pollToken: pairing.pollToken,
      }),
    });
    if (result.status === "active") {
      const localById = sources;
      const mapped = result.sources.map((mapping) => ({
        ...localById.get(mapping.clientSourceId),
        ...mapping,
      }));
      const config = {
        version: 2,
        origin,
        installationId: pairing.installationId,
        deviceToken: result.deviceToken,
        sources: mapped,
        protocol: result.protocol,
      };
      await writeConfig(config);
      await reconcileHooks(import.meta.url, mapped, localSources);
      output("Connected. Exact aggregate sync is active.");
      await sync(config);
      return;
    }
    if (result.status !== "pending") throw new Error("Pairing was revoked");
  }
  throw new Error("Pairing expired");
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
  );
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
  for (const sourceId of sourceIds) {
    delete state.sequences[sourceId];
    delete state.adapters[sourceId];
    delete state.fingerprints[sourceId];
    delete state.quarantine[sourceId];
    await removePendingForSource(sourceId);
    await clearQuarantine(sourceId);
  }
  await writeState(state);
}

async function retireMappedSources(config, sourceIds) {
  if (await lifecycleMutationActive())
    throw new Error("Source retirement stopped by a local lifecycle operation");
  const retired = new Set(sourceIds);
  const mappings = config.sources.filter((source) => retired.has(source.sourceId));
  for (const source of mappings)
    try {
      await removeHookForSource(source, { removeLegacy: true });
    } catch (error) {
      process.stderr.write(
        `Vibe Racing warning: hook cleanup failed for disconnected ${source.agentId} source: ${error.message}\n`,
      );
    }
  await clearDirtyForSources(mappings.map((source) => source.clientSourceId));
  await forgetSourceState(mappings.map((source) => source.sourceId));
  config.sources = config.sources.filter((source) => !retired.has(source.sourceId));
  await writeConfig(config);
  return mappings;
}

async function reconcileRemoteSources(config, remoteSources) {
  const active = new Set(
    (remoteSources ?? [])
      .filter((source) => source.status === "active")
      .map((source) => source.sourceId),
  );
  const retired = config.sources
    .filter((source) => typeof source.sourceId === "string" && !active.has(source.sourceId))
    .map((source) => source.sourceId);
  if (retired.length > 0) await retireMappedSources(config, retired);
}

async function disableLocalConnection(clearPending = false) {
  const operations = [removeHooks(), removeConfig(), clearAutomaticState()];
  if (clearPending) operations.push(clearPendingPayloads());
  const results = await Promise.allSettled(operations);
  if (results[1].status === "rejected") throw results[1].reason;
  const hookFailures = results[0].status === "fulfilled" ? results[0].value.failures.length : 1;
  return hookFailures + results.slice(1).filter((result) => result.status === "rejected").length;
}

async function compactSuccessfulCaptures(config) {
  const state = await readState();
  const pending = new Set(
    (await pendingPayloads()).map((path) => path.split(/[\\/]/).at(-1)?.split(".")[0]),
  );
  for (const source of config.sources) {
    if (
      !["cursor_cli_capture", "antigravity_cli_capture"].includes(source.collectionMethod) ||
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
    remote = await request(
      config.origin,
      "/api/installations/current",
      { headers: { Authorization: `Bearer ${config.deviceToken}` } },
      missing ? 3 : 1,
    );
  } catch (error) {
    if (missing || error?.status === 401 || error?.status === 403 || error?.status === 426)
      await lifecycleFailure(error);
    const fresh = await readState();
    fresh.lastRemoteReconciliationAt = Date.now();
    await writeState(fresh);
    return fresh;
  }
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
            await writeState(state);
          }
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

async function drainPending(config, retryStale = true) {
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
    const retried = await drainPending(config, false);
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
  return withSyncLock(async () => {
    const config = providedConfig ?? (await readConfig());
    const previous = await drainPending(config);
    let accepted = previous.accepted;
    let state = await readState();
    state = await reconcileServerState(config, state);
    const range = snapshotRange();
    state.adapters ??= {};
    state.fingerprints ??= {};
    const mappedSources = config.sources.filter((source) => typeof source.sourceId === "string");
    const dirty = await readDirty();
    const dirtyIds = new Set(dirtyEntries(dirty).map(([clientSourceId]) => clientSourceId));
    const syncSources = options.automatic
      ? mappedSources.filter((source) => dirtyIds.has(source.clientSourceId))
      : mappedSources;
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
        await appendFile(process.env.VIBERACING_TEST_COLLECTOR_TRACE, `${source.clientSourceId}\n`);
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
    const successfullyChecked = [];
    for (let index = 0; index < collected.length; index += 1) {
      const outcome = collected[index];
      const source = syncSources[index];
      if (outcome.status === "rejected") {
        failures.push(`${source.agentId}: ${outcome.reason?.message ?? "collector failed"}`);
        const nextFingerprint = fingerprint({ error: "collector_failed" });
        if (state.fingerprints[source.sourceId] !== nextFingerprint) {
          sourceErrors.push({ sourceId: source.sourceId, code: "collector_failed" });
          state.fingerprints[source.sourceId] = nextFingerprint;
        }
        continue;
      }
      successfullyChecked.push(source.clientSourceId);
      state.adapters[source.sourceId] = outcome.value.result.nextState ?? {};
      const entries = recentEntries(outcome.value.result.entries);
      const nextFingerprint = fingerprint({
        ...range,
        completeness: outcome.value.result.completeness,
        entries,
        warnings: [...(outcome.value.result.warnings ?? [])].sort(),
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
      output("No usage changes; no request was sent.");
      if (failures.length)
        process.stderr.write(`Vibe Racing partial sync: ${failures.join("; ")}\n`);
      return { accepted, failures, unchanged: true };
    }
    const payload = { protocolVersion, snapshots, sourceErrors };
    if (await lifecycleMutationActive())
      throw new Error("Sync persistence stopped by a local lifecycle operation");
    await savePending(payload);
    const delivered = await drainPending(config);
    accepted += delivered.accepted;
    await clearSuccessfulDirty();
    if (snapshots.length === 0)
      throw new Error(failures.join("; ") || "No configured collectors succeeded");
    output(`Synced ${accepted} daily totals from ${snapshots.length} source(s).`);
    for (const sourceId of [...previous.retiredSources, ...delivered.retiredSources])
      failures.push(`server disconnected source ${sourceId}`);
    for (const sourceId of [...previous.quarantinedSources, ...delivered.quarantinedSources])
      failures.push(`server rejected source ${sourceId}; payload quarantined`);
    if (failures.length === 0) await compactSuccessfulCaptures({ ...config, sources: syncSources });
    if (failures.length) process.stderr.write(`Vibe Racing partial sync: ${failures.join("; ")}\n`);
    return { accepted, failures };
  });
}

async function launchAutomaticScheduler() {
  const state = await readState();
  if (state.automaticDisabledReason) return false;
  const scheduler = await claimScheduler();
  if (!scheduler) return false;
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(import.meta.url),
      "auto-sync",
      "--quiet",
      "--scheduler-owner",
      scheduler.ownershipToken,
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  child.on("error", () => releaseScheduler(scheduler.ownershipToken).catch(() => {}));
  child.unref();
  return true;
}

async function hook() {
  try {
    for await (const _chunk of process.stdin) {
      // Hook input can contain private agent context. Discard it without parsing or logging.
    }
    const clientSourceId = option("--source");
    const agentId = option("--agent");
    const config = await readConfig();
    const active = config.sources.some(
      (source) =>
        source.clientSourceId === clientSourceId &&
        source.agentId === agentId &&
        typeof source.sourceId === "string",
    );
    if (active) {
      await markDirty(clientSourceId);
      await launchAutomaticScheduler();
    }
  } catch {
    // Provider hooks are fail-open: local scheduling failures must never affect the agent.
  }
  const agentId = option("--agent");
  if (agentId === "gemini_cli" || agentId === "qwen_code") process.stdout.write("{}\n");
}

async function automaticSync() {
  const schedulerOwner = option("--scheduler-owner");
  let attemptedClaims = {};
  let attempted = false;
  try {
    for (;;) {
      if (!(await ownsScheduler(schedulerOwner))) return;
      const dirty = await readDirty();
      if (!dirty) return;
      let state = await readState();
      const dueAt = automaticDueAt(dirty, state.lastAutomaticSyncAt ?? 0, automaticTimings);
      const waitMs = Math.max(0, dueAt - Date.now());
      if (waitMs > 0) await delay(waitMs);
      if (!(await ownsScheduler(schedulerOwner))) return;
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
      const result = await sync(undefined, { automatic: true });
      if (result?.skipped) attempted = false;
      return;
    }
  } finally {
    if (attempted) await clearDirty(attemptedClaims).catch(() => {});
    await releaseScheduler(schedulerOwner);
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
  const detected = await defaultSources();
  output(`Connector: ${connectorVersion}; protocol: ${protocolVersion}`);
  output(
    `Detected exact sources: ${detected.length ? detected.map((source) => `${source.agentId}/${source.collectionMethod}`).join(", ") : "none"}`,
  );
  try {
    const config = await readConfig();
    let state = await readState();
    const range = snapshotRange();
    if (arguments_.includes("--repair")) {
      await reconcileHooks(import.meta.url, config.sources, await readSources());
      output("Installed connector copy and owned hooks repaired.");
    }
    const hooks = await diagnoseHooks(config.sources);
    for (const [agentId, status] of Object.entries(hooks)) output(`${agentId} hook: ${status}`);
    output(`Connected origin: ${config.origin}`);
    try {
      const remote = await request(config.origin, "/api/installations/current", {
        headers: { Authorization: `Bearer ${config.deviceToken}` },
      });
      await reconcileRemoteSources(config, remote.sources);
      state = await rememberServerSequences(
        config,
        remote.sources?.map((source) => ({
          sourceId: source.sourceId,
          lastAcceptedSyncSequence: source.lastAcceptedSyncSequence,
        })),
      );
      output(`Pairing status: ${remote.status}; server last sync: ${remote.lastSyncAt ?? "never"}`);
      for (const source of remote.sources)
        output(
          `${source.agentId}/${source.collectionMethod}: ${source.status}, ${source.completeness ?? "not synced"}${source.warning ? `, warning: ${source.warning}` : ""}${source.error ? `, error: ${source.error}` : ""}`,
        );
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        const cleanupWarnings = await disableLocalConnection();
        output("Pairing status: disconnected. Installation authorization was revoked.");
        output("Run `viberacing connect` to reconnect this installation.");
        if (cleanupWarnings)
          output("One or more auxiliary hook cleanup steps need manual inspection.");
        return;
      }
      if (error?.status === 426) {
        state.automaticDisabledReason = "unsupported_connector";
        await writeState(state);
        output("Pairing status: connector update required; automatic sync is disabled.");
        return;
      }
      output(`Pairing status: error (${error.message})`);
    }
    for (const source of config.sources) {
      const adapter = adapterFor(source.agentId);
      try {
        const diagnostic = await adapter.diagnose(source);
        output(
          `${source.agentId} diagnostics: ${diagnostic.status}; method ${diagnostic.collectionMethod}; surfaces ${diagnostic.supportedSurfaces.join(",")}; data ${diagnostic.dataLocationAvailable === false ? "unavailable" : "available"}${diagnostic.excluded.length ? `; excluded ${diagnostic.excluded.join(", ")}` : ""}`,
        );
        const result = await adapter.collect(
          source,
          range,
          state.adapters?.[source.sourceId] ?? {},
        );
        output(
          `${source.agentId} (${source.accountLabel}): ok, ${result.entries.length} UTC day(s), ${result.completeness}${result.warnings.length ? `; warnings ${result.warnings.join(", ")}` : ""}`,
        );
      } catch (error) {
        output(`${source.agentId} (${source.accountLabel}): error, ${error.message}`);
      }
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
    const captureBased = ["cursor", "antigravity"].includes(agentId);
    if (!adapter || (!captureBased && !dataPath) || !label || label.length > 40)
      throw new Error("Usage: viberacing source add --agent AGENT --name NAME [--data-dir PATH]");
    const result = await addSource({
      agentId,
      dataPath,
      collectionMethod: adapter.collectionMethods[0],
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
        await request(config.origin, `/api/sources/${mapping.sourceId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${config.deviceToken}` },
        });
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
      process.stderr.write(
        "Vibe Racing warning: remote source disconnect could not be confirmed; its local hook and automatic state were removed.\n",
      );
    return;
  }
  throw new Error(
    "Usage: viberacing source list | source add --agent AGENT --name NAME [--data-dir PATH] | source remove ID",
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
  const { executable, args } = wrapperInvocation(agentId, passed);
  const child = spawn(executable, args, {
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
  if (safe.length) {
    await appendCapture(source, safe);
    try {
      const config = await readConfig();
      if (config.sources.some((mapping) => mapping.clientSourceId === source.clientSourceId)) {
        await markDirty(source.clientSourceId);
        await launchAutomaticScheduler();
      }
    } catch {}
  }
  if (outcome.signal) process.kill(process.pid, outcome.signal);
  else process.exitCode = outcome.code ?? 1;
}

try {
  if (command === "connect") await connect();
  else if (command === "sync") await sync();
  else if (command === "hook") await hook();
  else if (command === "auto-sync") await automaticSync();
  else if (command === "doctor") await doctor();
  else if (command === "accounts") {
    const config = await readConfig();
    for (const source of config.sources) output(`${source.agentId}: ${source.accountLabel}`);
  } else if (command === "source" && arguments_[1] === "remove")
    await withLifecycleMutation(() => sourceCommand());
  else if (command === "source") await sourceCommand();
  else if (command === "run" && ["cursor", "antigravity"].includes(arguments_[1]))
    await wrap(arguments_[1]);
  else if (command === "disconnect") {
    let remoteError;
    let localWarnings = 0;
    await withLifecycleMutation(async () => {
      try {
        const config = await readConfig();
        await request(config.origin, "/api/installations/current", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${config.deviceToken}` },
        });
      } catch (error) {
        remoteError = error;
      } finally {
        localWarnings = await disableLocalConnection(true);
      }
    });
    output("Installation disconnected locally; provider histories were not changed.");
    if (remoteError)
      process.stderr.write(
        "Vibe Racing warning: remote revoke could not be confirmed; the local token and hooks were removed.\n",
      );
    if (localWarnings)
      process.stderr.write(
        "Vibe Racing warning: local authorization was removed, but one or more auxiliary cleanup steps need manual inspection.\n",
      );
  } else if (command === "reset-installation") {
    const cleanup = await withLifecycleMutation(async () => {
      const result = await removeHooks();
      await resetInstallation();
      await clearAutomaticState();
      return result;
    });
    output(
      "Installation identity reset. The prior server installation must be disconnected separately if still active.",
    );
    if (cleanup.failures.length > 0)
      process.stderr.write(
        `Vibe Racing warning: ${cleanup.failures.length} owned hook root(s) could not be cleaned; local source metadata was retained.\n`,
      );
  } else if (command === "uninstall") {
    const cleanup = await withLifecycleMutation(async () => {
      try {
        const config = await readConfig();
        await request(config.origin, "/api/installations/current", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${config.deviceToken}` },
        });
      } catch {}
      const result = await removeHooks();
      if (result.failures.length === 0) await removeLocalState();
      else {
        await resetInstallation();
        await clearAutomaticState();
      }
      return result;
    });
    if (cleanup.failures.length === 0)
      output(
        "Vibe Racing hooks, installed copy, secrets, and local state removed. Provider data was not changed.",
      );
    else {
      output(
        "Vibe Racing network access and secrets were removed; cleanup metadata and runtime were retained for retry.",
      );
      process.stderr.write(
        `Vibe Racing warning: ${cleanup.failures.length} owned hook root(s) could not be cleaned. Fix the reported provider settings and run \`viberacing uninstall\` again.\n`,
      );
      for (const failure of cleanup.failures)
        process.stderr.write(
          `- ${failure.agentId ?? "sources"}: ${failure.path} (${failure.message})\n`,
        );
      process.exitCode = 1;
    }
  } else
    output(
      "Usage: viberacing connect [--origin URL] | sync | doctor [--repair] | accounts | source … | disconnect | uninstall | reset-installation | run cursor|antigravity [--source ID] -- …",
    );
} catch (error) {
  if (quiet) {
    const directory = join(stateDirectory, "logs");
    await mkdir(directory, { recursive: true, mode: 0o700 }).catch(() => {});
    await writeFile(
      join(directory, "last-error.log"),
      `${new Date().toISOString()} ${error instanceof Error ? error.message : "unexpected error"}\n`,
      { mode: 0o600 },
    ).catch(() => {});
  }
  if (!quiet)
    process.stderr.write(
      `Vibe Racing: ${error instanceof Error ? error.message : "unexpected error"}\n`,
    );
  process.exitCode = 1;
}
