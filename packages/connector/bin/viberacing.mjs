#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { adapterFor, defaultSources, recentEntries, safeCaptureRecord } from "../lib/readers.mjs";
import { openBrowser } from "../lib/browser.mjs";
import {
  installHooks,
  diagnoseHooks,
  readConfig,
  readOrCreateInstallation,
  removeConfig,
  removeHooks,
  removeLocalState,
  resetInstallation,
  stateDirectory,
  writeConfig,
} from "../lib/config.mjs";
import {
  pendingPayloads,
  readPending,
  readState,
  mergePendingPayloads,
  removePending,
  removePendingForSource,
  savePending,
  withSyncLock,
  writeState,
} from "../lib/runtime.mjs";

const connectorVersion = "0.2.0";
const protocolVersion = 2;
const arguments_ = process.argv.slice(2);
const command = arguments_[0] ?? "help";
const quiet = arguments_.includes("--quiet");
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
  let existing;
  try {
    existing = await readConfig();
  } catch {}
  const detected = await defaultSources();
  const sources = new Map();
  for (const source of [...(existing?.sources ?? []), ...detected])
    sources.set(source.clientSourceId, source);
  if (sources.size === 0)
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
      await installHooks(import.meta.url, mapped);
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

async function deliver(config, payload) {
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
    5,
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
  for (const sourceId of sourceIds) {
    delete state.sequences[sourceId];
    delete state.adapters[sourceId];
    await removePendingForSource(sourceId);
  }
  await writeState(state);
}

async function deliverPendingGroup(config, items, retired) {
  const eligible = [];
  for (const item of items) {
    if (retired.has(item.sourceId)) await removePending(item.path);
    else eligible.push(item);
  }
  if (eligible.length === 0) return 0;
  try {
    const result = await deliver(
      config,
      mergePendingPayloads(eligible.map((item) => item.payload)),
    );
    for (const item of eligible) await removePending(item.path);
    return result.acceptedEntries ?? 0;
  } catch (error) {
    if (error?.status !== 400 || error?.code !== "unsupported_source") throw error;
    if (eligible.length > 1) {
      const middle = Math.ceil(eligible.length / 2);
      return (
        (await deliverPendingGroup(config, eligible.slice(0, middle), retired)) +
        (await deliverPendingGroup(config, eligible.slice(middle), retired))
      );
    }
    retired.add(eligible[0].sourceId);
    await removePending(eligible[0].path);
    return 0;
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

async function drainPending(config) {
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
  const groups = [
    items.filter((item) => (item.payload.snapshots?.length ?? 0) > 0),
    items.filter((item) => (item.payload.sourceErrors?.length ?? 0) > 0),
  ];
  for (const selected of groups) {
    for (const group of pendingGroups(selected))
      accepted += await deliverPendingGroup(config, group, retired);
  }
  if (retired.size > 0) {
    config.sources = config.sources.filter((source) => !retired.has(source.sourceId));
    await writeConfig(config);
    await forgetSourceState(retired);
  }
  return { accepted, retiredSources: [...retired] };
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

async function sync(providedConfig) {
  return withSyncLock(async () => {
    const config = providedConfig ?? (await readConfig());
    const previous = await drainPending(config);
    let accepted = previous.accepted;
    const state = await readState();
    const range = snapshotRange();
    state.adapters ??= {};
    const syncSources = config.sources.filter((source) => typeof source.sourceId === "string");
    const collected = await settleLimited(syncSources, async (source) => {
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
    for (let index = 0; index < collected.length; index += 1) {
      const outcome = collected[index];
      const source = syncSources[index];
      if (outcome.status === "rejected") {
        failures.push(`${source.agentId}: ${outcome.reason?.message ?? "collector failed"}`);
        sourceErrors.push({ sourceId: source.sourceId, code: "collector_failed" });
        continue;
      }
      const previous = BigInt(state.sequences[source.sourceId] ?? "0");
      const sequence = (previous + 1n).toString();
      state.sequences[source.sourceId] = sequence;
      state.adapters[source.sourceId] = outcome.value.result.nextState ?? {};
      snapshots.push({
        sourceId: source.sourceId,
        syncSequence: sequence,
        ...range,
        completeness: outcome.value.result.completeness,
        entries: recentEntries(outcome.value.result.entries),
      });
    }
    await writeState(state);
    const payload = { protocolVersion, snapshots, sourceErrors };
    await savePending(payload);
    const delivered = await drainPending(config);
    accepted += delivered.accepted;
    if (snapshots.length === 0)
      throw new Error(failures.join("; ") || "No configured collectors succeeded");
    output(`Synced ${accepted} daily totals from ${snapshots.length} source(s).`);
    for (const sourceId of [...previous.retiredSources, ...delivered.retiredSources])
      failures.push(`server disconnected source ${sourceId}`);
    if (failures.length) process.stderr.write(`Vibe Racing partial sync: ${failures.join("; ")}\n`);
    return { accepted, failures };
  });
}

function launchSync() {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "sync", "--quiet"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => {});
  child.unref();
}

async function doctor() {
  const detected = await defaultSources();
  output(`Connector: ${connectorVersion}; protocol: ${protocolVersion}`);
  output(
    `Detected exact sources: ${detected.length ? detected.map((source) => `${source.agentId}/${source.collectionMethod}`).join(", ") : "none"}`,
  );
  try {
    const config = await readConfig();
    const state = await readState();
    const range = snapshotRange();
    if (arguments_.includes("--repair")) {
      await installHooks(import.meta.url, config.sources);
      output("Installed connector copy and owned hooks repaired.");
    }
    const hooks = await diagnoseHooks(config.sources);
    for (const [agentId, status] of Object.entries(hooks)) output(`${agentId} hook: ${status}`);
    output(`Connected origin: ${config.origin}`);
    try {
      const remote = await request(config.origin, "/api/installations/current", {
        headers: { Authorization: `Bearer ${config.deviceToken}` },
      });
      output(`Pairing status: ${remote.status}; server last sync: ${remote.lastSyncAt ?? "never"}`);
      for (const source of remote.sources)
        output(
          `${source.agentId}/${source.collectionMethod}: ${source.status}, ${source.completeness ?? "not synced"}${source.warning ? `, warning: ${source.warning}` : ""}${source.error ? `, error: ${source.error}` : ""}`,
        );
    } catch (error) {
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
  const config = await readConfig();
  if (action === "list") {
    for (const source of config.sources)
      output(`${source.clientSourceId}  ${source.agentId}  ${source.accountLabel}`);
    return;
  }
  if (action === "add") {
    const agentId = option("--agent");
    const dataPath = option("--data-dir", option("--path"));
    const label = option("--name", option("--label"))?.trim();
    const adapter = adapterFor(agentId);
    if (!adapter || !dataPath || !label || label.length > 40)
      throw new Error("Usage: viberacing source add --agent AGENT --name NAME --data-dir PATH");
    config.sources.push({
      clientSourceId: `${agentId}:${randomUUID()}`,
      agentId,
      dataPath,
      collectionMethod: adapter.collectionMethods[0],
      supportedSurface: adapter.supportedSurfaces[0],
      suggestedLabel: label,
    });
    await writeConfig(config);
    output(
      "Source saved locally. Run `viberacing connect --origin",
      `${config.origin}\` to approve it.`,
    );
    return;
  }
  if (action === "remove") {
    const id = arguments_[2];
    const before = config.sources.length;
    const removed = config.sources.find((source) => source.clientSourceId === id);
    config.sources = config.sources.filter((source) => source.clientSourceId !== id);
    if (before === config.sources.length) throw new Error("Unknown source id");
    if (typeof removed.sourceId === "string") {
      try {
        await request(config.origin, `/api/sources/${removed.sourceId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${config.deviceToken}` },
        });
      } catch (error) {
        if (error?.status !== 404) throw error;
      }
    }
    await writeConfig(config);
    if (typeof removed.sourceId === "string") await forgetSourceState([removed.sourceId]);
    output("Source disconnected and removed locally.");
    return;
  }
  throw new Error(
    "Usage: viberacing source list | source add --agent AGENT --name NAME --data-dir PATH | source remove ID",
  );
}

async function wrap(agentId) {
  const executable = agentId === "cursor" ? "agent" : "agy";
  const separator = arguments_.indexOf("--");
  const passed = separator < 0 ? arguments_.slice(2) : arguments_.slice(separator + 1);
  const args = [...passed, "--output-format", "stream-json"];
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
    const directory = join(stateDirectory, "captures");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await appendFile(
      join(directory, `${agentId}.jsonl`),
      `${safe.map(JSON.stringify).join("\n")}\n`,
      { mode: 0o600 },
    );
    launchSync();
  }
  if (outcome.signal) process.kill(process.pid, outcome.signal);
  else process.exitCode = outcome.code ?? 1;
}

try {
  if (command === "connect") await connect();
  else if (command === "sync") await sync();
  else if (command === "hook") launchSync();
  else if (command === "doctor") await doctor();
  else if (command === "accounts") {
    const config = await readConfig();
    for (const source of config.sources) output(`${source.agentId}: ${source.accountLabel}`);
  } else if (command === "source") await sourceCommand();
  else if (command === "run" && ["cursor", "antigravity"].includes(arguments_[1]))
    await wrap(arguments_[1]);
  else if (command === "disconnect") {
    const config = await readConfig();
    await request(config.origin, "/api/installations/current", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${config.deviceToken}` },
    });
    await removeHooks();
    await removeConfig();
    output("Installation disconnected; local provider histories were not changed.");
  } else if (command === "reset-installation") {
    await removeHooks();
    await resetInstallation();
    output(
      "Installation identity reset. The prior server installation must be disconnected separately if still active.",
    );
  } else if (command === "uninstall") {
    try {
      const config = await readConfig();
      await request(config.origin, "/api/installations/current", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${config.deviceToken}` },
      });
    } catch {}
    await removeHooks();
    await removeLocalState();
    output(
      "Vibe Racing hooks, installed copy, secrets, and local state removed. Provider data was not changed.",
    );
  } else
    output(
      "Usage: viberacing connect [--origin URL] | sync | doctor [--repair] | accounts | source … | disconnect | uninstall | reset-installation | run cursor|antigravity -- …",
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
