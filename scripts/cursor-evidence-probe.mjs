#!/usr/bin/env node

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const probeStateName = "cursor-evidence-state.json";
const observationsDirectoryName = "observations";
const maximumInputBytes = 1_048_576;
const maximumFileBytes = 100_000_000;
const maximumObservations = 10_000;
const markerOption = "--viberacing-cursor-evidence-probe";
const eventNames = Object.freeze(["afterAgentResponse", "stop", "sessionEnd"]);
const surfaces = new Set(["desktop", "cli-interactive", "cli-headless"]);
const scenarios = new Set([
  "desktop-one-turn",
  "cli-interactive-one-turn",
  "cli-headless-one-turn",
  "desktop-cli-same-account",
  "desktop-cli-different-accounts",
  "cli-a-b-a",
  "desktop-a-b-a",
  "subagent",
  "aborted-error",
  "utc-midnight",
]);
const counterNames = new Map([
  ["inputTokens", "inputTokens"],
  ["input_tokens", "inputTokens"],
  ["outputTokens", "outputTokens"],
  ["output_tokens", "outputTokens"],
  ["cacheReadTokens", "cacheReadTokens"],
  ["cache_read_tokens", "cacheReadTokens"],
  ["cacheWriteTokens", "cacheWriteTokens"],
  ["cache_write_tokens", "cacheWriteTokens"],
  ["reasoningTokens", "reasoningTokens"],
  ["reasoning_tokens", "reasoningTokens"],
  ["totalTokens", "totalTokens"],
  ["total_tokens", "totalTokens"],
]);
const identityNames = new Map([
  ["event_id", "event_id"],
  ["eventId", "event_id"],
  ["request_id", "request_id"],
  ["requestId", "request_id"],
  ["generation_id", "generation_id"],
  ["generationId", "generation_id"],
  ["conversation_id", "conversation_id"],
  ["conversationId", "conversation_id"],
  ["session_id", "session_id"],
  ["sessionId", "session_id"],
]);
const accountIdentityNames = new Map([
  ["account_id", "account_id"],
  ["accountId", "account_id"],
  ["user_email", "user_email"],
  ["userEmail", "user_email"],
]);
const contentKeys = new Set([
  "args",
  "attachments",
  "accessToken",
  "access_token",
  "apiKey",
  "api_key",
  "code",
  "content",
  "cost",
  "credential",
  "cwd",
  "error_message",
  "errorMessage",
  "file_path",
  "filePath",
  "message",
  "model",
  "model_id",
  "model_params",
  "path",
  "prompt",
  "repository",
  "response",
  "text",
  "tool_call",
  "tool_calls",
  "toolCall",
  "toolCalls",
  "transcript_path",
  "transcriptPath",
  "workspace_roots",
  "workspaceRoots",
]);
const safeKeyPattern = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const safeVersionPattern = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function usage() {
  return `Usage:
  node scripts/cursor-evidence-probe.mjs install-hooks --output-dir DIR --surface SURFACE --scenario SCENARIO
  node scripts/cursor-evidence-probe.mjs remove-hooks --output-dir DIR
  node scripts/cursor-evidence-probe.mjs capture-hook --output-dir DIR --surface SURFACE --scenario SCENARIO --event EVENT --viberacing-probe-id UUID
  node scripts/cursor-evidence-probe.mjs run-cli --output-dir DIR --agent ABSOLUTE_PATH --scenario SCENARIO -- [agent arguments]
  node scripts/cursor-evidence-probe.mjs inspect-jsonl --output-dir DIR --input ABSOLUTE_PATH --surface SURFACE --scenario SCENARIO
  node scripts/cursor-evidence-probe.mjs report --output-dir DIR

SURFACE is desktop, cli-interactive, or cli-headless. Probe output must be outside the repository.
The probe never stores raw Cursor payloads, prompts, responses, code, paths, models, costs, or provider identities.`;
}

function parseArguments(arguments_) {
  const separator = arguments_.indexOf("--");
  const optionsPart = separator === -1 ? arguments_ : arguments_.slice(0, separator);
  const passthrough = separator === -1 ? [] : arguments_.slice(separator + 1);
  const options = {};
  for (let index = 0; index < optionsPart.length; index += 1) {
    const name = optionsPart[index];
    if (!name.startsWith("--")) throw new Error(`Unexpected argument: ${name}`);
    const value = optionsPart[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
    options[name.slice(2)] = value;
    index += 1;
  }
  return { options, passthrough };
}

function pathInside(parent, candidate) {
  const child = relative(parent, candidate);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

async function assertPrivateDirectory(path, { create = false } = {}) {
  if (!isAbsolute(path)) throw new Error("Probe output directory must be absolute");
  let created = false;
  try {
    await lstat(path);
  } catch (error) {
    if (!create || error?.code !== "ENOENT") throw error;
    await mkdir(path, { recursive: true, mode: 0o700 });
    created = true;
  }
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (typeof process.getuid === "function" && info.uid !== process.getuid())
  )
    throw new Error("Probe output directory must be a current-user real directory");
  const [actualPath, actualRepositoryRoot] = await Promise.all([
    realpath(path),
    realpath(repositoryRoot),
  ]);
  if (pathInside(actualRepositoryRoot, actualPath))
    throw new Error("Probe output must stay outside the repository");
  if (process.platform !== "win32") {
    if ((info.mode & 0o077) !== 0) throw new Error("Probe output directory is not owner-only");
    if (created) await chmod(path, 0o700);
  }
  return actualPath;
}

async function assertSafeRegularFile(
  path,
  { allowMissing = false, maximumBytes = maximumInputBytes } = {},
) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return null;
    throw error;
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size > maximumBytes ||
    (typeof process.getuid === "function" && info.uid !== process.getuid())
  )
    throw new Error("Probe input must be a bounded current-user regular file with one link");
  return info;
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
    if (process.platform !== "win32") await chmod(path, 0o600);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function readProbeState(outputDirectory, { create = false } = {}) {
  const output = await assertPrivateDirectory(resolve(outputDirectory), { create });
  const path = join(output, probeStateName);
  let state;
  try {
    await assertSafeRegularFile(path);
    state = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (!create || error?.code !== "ENOENT") throw error;
    state = {
      schemaVersion: 1,
      probeId: randomUUID(),
      hmacKey: randomBytes(32).toString("base64url"),
      createdAt: new Date().toISOString(),
    };
    await atomicJson(path, state);
  }
  if (
    state?.schemaVersion !== 1 ||
    !uuidPattern.test(state.probeId ?? "") ||
    !/^[A-Za-z0-9_-]{43}$/.test(state.hmacKey ?? "") ||
    typeof state.createdAt !== "string" ||
    !Number.isFinite(Date.parse(state.createdAt))
  )
    throw new Error("Cursor evidence probe state is invalid");
  return { output, state };
}

function requireSurface(value) {
  if (!surfaces.has(value)) throw new Error("Unknown Cursor probe surface");
  return value;
}

function requireScenario(value) {
  if (!scenarios.has(value)) throw new Error("Unknown Cursor evidence scenario");
  return value;
}

function requireEvent(value) {
  if (!eventNames.includes(value) && value !== "stream-json" && value !== "local-jsonl")
    throw new Error("Unknown Cursor probe event");
  return value;
}

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function canonicalInteger(value) {
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  return typeof value === "string" && value.length <= 78 && /^(?:0|[1-9]\d*)$/.test(value)
    ? value
    : null;
}

function normalizedStatus(value) {
  return ["completed", "aborted", "error", "success", "failure"].includes(value) ? value : null;
}

function normalizedVersion(value) {
  return typeof value === "string" && safeVersionPattern.test(value) ? value : null;
}

function normalizedTimestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  )
    return null;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
}

function hmacIdentity(key, domain, value, prefix) {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) return null;
  return `${prefix}_${createHmac("sha256", key).update(domain).update("\0").update(value).digest("base64url")}`;
}

function formulaEvidence(counters) {
  const required = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"];
  if (!required.every((name) => counters[name] !== undefined)) return "not_observable";
  const base = required.reduce((sum, name) => sum + BigInt(counters[name]), 0n);
  if (counters.totalTokens === undefined) return "components_only";
  return BigInt(counters.totalTokens) === base ? "matches_four_component_sum" : "mismatch";
}

export function sanitizeCursorObservation(payload, context) {
  const surface = requireSurface(context.surface);
  const scenario = requireScenario(context.scenario);
  const eventName = requireEvent(context.eventName);
  const schemaPaths = new Set();
  const counterGroups = new Map();
  const invalidCounterPaths = new Set();
  const identities = [];
  const accountCandidates = [];
  const timestamps = [];
  let cursorVersion = normalizedVersion(context.cursorVersion);
  let status = null;
  const visit = (value, path = "$", depth = 0) => {
    if (depth > 8 || schemaPaths.size >= 512) return;
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      schemaPaths.add(`${path}:array`);
      for (const item of value.slice(0, 16)) visit(item, `${path}[]`, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value).slice(0, 256)) {
      if (!safeKeyPattern.test(key)) continue;
      const childPath = `${path}.${key}`;
      schemaPaths.add(`${childPath}:${valueType(child)}`);
      if (counterNames.has(key)) {
        const counter = canonicalInteger(child);
        if (counter === null) invalidCounterPaths.add(childPath);
        else {
          const group = counterGroups.get(path) ?? {};
          const canonical = counterNames.get(key);
          if (group[canonical] !== undefined && group[canonical] !== counter)
            invalidCounterPaths.add(childPath);
          else group[canonical] = counter;
          counterGroups.set(path, group);
        }
      }
      if (identityNames.has(key)) {
        const canonicalField = identityNames.get(key);
        const hash = hmacIdentity(context.hmacKey, `cursor-event:${canonicalField}`, child, "evt1");
        if (hash !== null) identities.push({ field: canonicalField, hash });
      }
      if (accountIdentityNames.has(key) && typeof child === "string")
        accountCandidates.push({ field: accountIdentityNames.get(key), value: child });
      if (["timestamp", "created_at", "createdAt", "started_at", "startedAt"].includes(key)) {
        const timestamp = normalizedTimestamp(child);
        if (timestamp !== null) timestamps.push(timestamp);
      }
      if (key === "cursor_version" || key === "cursorVersion")
        cursorVersion ??= normalizedVersion(child);
      if (key === "status" || key === "reason" || key === "subtype")
        status ??= normalizedStatus(child);
      if (!contentKeys.has(key)) visit(child, childPath, depth + 1);
    }
  };
  visit(payload);
  const preferredAccount = [...new Set(accountIdentityNames.values())]
    .map((field) => accountCandidates.find((candidate) => candidate.field === field))
    .find(Boolean);
  const accountKey = preferredAccount
    ? hmacIdentity(
        context.hmacKey,
        `cursor-account:${preferredAccount.field}`,
        preferredAccount.value.trim().normalize("NFC").toLowerCase(),
        "acct1",
      )
    : null;
  const tokenGroups = [...counterGroups.entries()]
    .map(([path, counters]) => ({ path, counters, formulaEvidence: formulaEvidence(counters) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    schemaVersion: 1,
    observationId: randomUUID(),
    observedAt: new Date().toISOString(),
    surface,
    scenario,
    eventName,
    parseStatus: payload === null || typeof payload !== "object" ? "invalid" : "parsed",
    cursorVersion,
    status,
    providerTimestamp: timestamps.sort()[0] ?? null,
    accountIdentitySource: preferredAccount?.field ?? null,
    accountKey,
    eventIdentities: identities
      .filter(
        (identity, index, values) =>
          values.findIndex(
            (candidate) => candidate.field === identity.field && candidate.hash === identity.hash,
          ) === index,
      )
      .slice(0, 32),
    tokenGroups,
    invalidCounterPaths: [...invalidCounterPaths].sort(),
    schemaPaths: [...schemaPaths].sort(),
  };
}

async function saveObservation(output, observation) {
  const directory = join(output, observationsDirectoryName);
  await assertPrivateDirectory(directory, { create: true });
  const names = await readdir(directory).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  if (names.length >= maximumObservations)
    throw new Error("Cursor evidence observation limit reached");
  await atomicJson(join(directory, `${observation.observationId}.json`), observation);
}

export async function readBoundedJson(stream, maximumBytes = maximumInputBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maximumBytes) throw new Error("Cursor probe input exceeded the byte limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function quoteCommandArgument(value, platform = process.platform) {
  if (typeof value !== "string" || /[\0\r\n]/.test(value))
    throw new Error("Hook command arguments cannot contain control characters");
  if (platform === "win32") {
    if (value === "") return '""';
    if (!/[\s"]/u.test(value)) return value;
    let result = '"';
    let slashes = 0;
    for (const character of value) {
      if (character === "\\") {
        slashes += 1;
        continue;
      }
      if (character === '"') result += "\\".repeat(slashes * 2 + 1) + '"';
      else result += "\\".repeat(slashes) + character;
      slashes = 0;
    }
    return `${result}${"\\".repeat(slashes * 2)}"`;
  }
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function hookCommand(output, state, surface, scenario, eventName, platform = process.platform) {
  return [
    process.execPath,
    scriptPath,
    "capture-hook",
    "--output-dir",
    output,
    "--surface",
    surface,
    "--scenario",
    scenario,
    "--event",
    eventName,
    "--viberacing-probe-id",
    state.probeId,
    markerOption,
    state.probeId,
  ]
    .map((value) => quoteCommandArgument(value, platform))
    .join(" ");
}

function isOwnedHook(entry, probeId) {
  return (
    typeof entry?.command === "string" &&
    entry.command.includes(markerOption) &&
    entry.command.includes(probeId)
  );
}

function validatedHooksDocument(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Cursor hooks.json must contain an object");
  if (value.version !== undefined && value.version !== 1)
    throw new Error("Cursor hooks.json has an unsupported version");
  if (
    value.hooks !== undefined &&
    (value.hooks === null || typeof value.hooks !== "object" || Array.isArray(value.hooks))
  )
    throw new Error("Cursor hooks.json has an invalid hooks field");
  return value;
}

async function readHooksDocument(hooksFile) {
  const info = await assertSafeRegularFile(hooksFile, { allowMissing: true });
  if (info === null) return { version: 1, hooks: {} };
  return validatedHooksDocument(JSON.parse(await readFile(hooksFile, "utf8")));
}

export async function installProbeHooks({ outputDirectory, surface, scenario, hooksFile }) {
  const { output, state } = await readProbeState(outputDirectory, { create: true });
  requireSurface(surface);
  requireScenario(scenario);
  const path = resolve(hooksFile ?? join(homedir(), ".cursor", "hooks.json"));
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const parentInfo = await lstat(parent);
  if (
    !parentInfo.isDirectory() ||
    parentInfo.isSymbolicLink() ||
    (typeof process.getuid === "function" && parentInfo.uid !== process.getuid())
  )
    throw new Error("Cursor hooks directory must be a current-user real directory");
  const document = await readHooksDocument(path);
  document.version ??= 1;
  document.hooks ??= {};
  let changed = false;
  for (const eventName of eventNames) {
    const entries = document.hooks[eventName] ?? [];
    if (!Array.isArray(entries)) throw new Error(`Cursor ${eventName} hooks must be an array`);
    const retained = entries.filter((entry) => !isOwnedHook(entry, state.probeId));
    const entry = { command: hookCommand(output, state, surface, scenario, eventName) };
    document.hooks[eventName] = [...retained, entry];
    if (JSON.stringify(document.hooks[eventName]) !== JSON.stringify(entries)) changed = true;
  }
  if (changed) await atomicJson(path, document);
  return { changed, probeId: state.probeId, hooks: [...eventNames] };
}

export async function removeProbeHooks({ outputDirectory, hooksFile }) {
  const { state } = await readProbeState(outputDirectory);
  const path = resolve(hooksFile ?? join(homedir(), ".cursor", "hooks.json"));
  const info = await assertSafeRegularFile(path, { allowMissing: true });
  if (info === null) return { changed: false };
  const document = await readHooksDocument(path);
  let changed = false;
  for (const eventName of eventNames) {
    if (!Array.isArray(document.hooks?.[eventName])) continue;
    const retained = document.hooks[eventName].filter(
      (entry) => !isOwnedHook(entry, state.probeId),
    );
    if (retained.length !== document.hooks[eventName].length) changed = true;
    if (retained.length === 0) delete document.hooks[eventName];
    else document.hooks[eventName] = retained;
  }
  if (changed) await atomicJson(path, document);
  return { changed };
}

async function captureHook(options) {
  const { output, state } = await readProbeState(options["output-dir"]);
  if (options["viberacing-probe-id"] !== state.probeId)
    throw new Error("Stale Cursor evidence hook");
  const surface = requireSurface(options.surface);
  const scenario = requireScenario(options.scenario);
  const eventName = requireEvent(options.event);
  let payload;
  try {
    payload = await readBoundedJson(process.stdin);
  } catch {
    payload = null;
  }
  const observation = sanitizeCursorObservation(payload, {
    surface,
    scenario,
    eventName,
    hmacKey: state.hmacKey,
  });
  await saveObservation(output, observation);
  process.stdout.write("{}\n");
}

async function inspectJsonl(options) {
  const { output, state } = await readProbeState(options["output-dir"], { create: true });
  const input = resolve(options.input ?? "");
  if (!isAbsolute(options.input ?? "")) throw new Error("Cursor JSONL input path must be absolute");
  const info = await assertSafeRegularFile(input, { maximumBytes: maximumFileBytes });
  if (info.size > maximumFileBytes) throw new Error("Cursor JSONL input exceeded the byte limit");
  const surface = requireSurface(options.surface);
  const scenario = requireScenario(options.scenario);
  const handle = await open(input, "r");
  let pending = "";
  let count = 0;
  try {
    for await (const chunk of handle.createReadStream({ encoding: "utf8", autoClose: false })) {
      pending += chunk;
      if (Buffer.byteLength(pending) > maximumInputBytes)
        throw new Error("Cursor JSONL record exceeded the byte limit");
      for (;;) {
        const newline = pending.indexOf("\n");
        if (newline < 0) break;
        const line = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        if (!line.trim()) continue;
        const payload = JSON.parse(line);
        await saveObservation(
          output,
          sanitizeCursorObservation(payload, {
            surface,
            scenario,
            eventName: "local-jsonl",
            hmacKey: state.hmacKey,
          }),
        );
        count += 1;
        if (count >= maximumObservations)
          throw new Error("Cursor evidence observation limit reached");
      }
    }
    if (pending.trim()) throw new Error("Cursor JSONL input has an unterminated record");
  } finally {
    await handle.close();
  }
  return { observations: count };
}

async function runCli(options, passthrough) {
  const { output, state } = await readProbeState(options["output-dir"], { create: true });
  const executable = options.agent;
  if (!isAbsolute(executable ?? "")) throw new Error("Cursor agent path must be absolute");
  await assertSafeRegularFile(resolve(executable), { maximumBytes: Number.MAX_SAFE_INTEGER });
  const scenario = requireScenario(options.scenario);
  const version = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 10_000 });
  const cursorVersion = normalizedVersion(version.stdout?.trim()) ?? null;
  const arguments_ = [...passthrough];
  if (!arguments_.includes("--print") && !arguments_.includes("-p")) arguments_.unshift("--print");
  const formatIndex = arguments_.findIndex(
    (argument) => argument === "--output-format" || argument.startsWith("--output-format="),
  );
  if (formatIndex === -1) arguments_.unshift("--output-format", "stream-json");
  else {
    const value = arguments_[formatIndex].includes("=")
      ? arguments_[formatIndex].split("=").slice(1).join("=")
      : arguments_[formatIndex + 1];
    if (value !== "stream-json") throw new Error("Cursor probe requires stream-json output");
  }
  const child = spawn(executable, arguments_, { stdio: ["inherit", "pipe", "pipe"] });
  child.stderr.pipe(process.stderr);
  let pending = "";
  let observations = 0;
  let streamInvalid = false;
  const writes = [];
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    pending += chunk.toString("utf8");
    if (Buffer.byteLength(pending) > maximumInputBytes) {
      pending = "";
      streamInvalid = true;
      return;
    }
    for (;;) {
      const newline = pending.indexOf("\n");
      if (newline < 0) break;
      const line = pending.slice(0, newline).replace(/\r$/, "");
      pending = pending.slice(newline + 1);
      if (!line.trim()) continue;
      try {
        const payload = JSON.parse(line);
        if (observations >= maximumObservations) {
          streamInvalid = true;
          continue;
        }
        observations += 1;
        writes.push(
          saveObservation(
            output,
            sanitizeCursorObservation(payload, {
              surface: "cli-headless",
              scenario,
              eventName: "stream-json",
              cursorVersion,
              hmacKey: state.hmacKey,
            }),
          ),
        );
      } catch {
        streamInvalid = true;
      }
    }
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  });
  if (pending.trim()) streamInvalid = true;
  await Promise.all(writes);
  if (streamInvalid || observations === 0)
    await saveObservation(
      output,
      sanitizeCursorObservation(null, {
        surface: "cli-headless",
        scenario,
        eventName: "stream-json",
        cursorVersion,
        hmacKey: state.hmacKey,
      }),
    );
  return exitCode;
}

export async function buildEvidenceReport(outputDirectory) {
  const { output } = await readProbeState(outputDirectory);
  const directory = join(output, observationsDirectoryName);
  const names = (
    await readdir(directory).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    })
  )
    .filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name))
    .sort();
  const observations = [];
  for (const name of names.slice(0, maximumObservations)) {
    const path = join(directory, name);
    await assertSafeRegularFile(path);
    observations.push(JSON.parse(await readFile(path, "utf8")));
  }
  const observedScenarios = [...new Set(observations.map((entry) => entry.scenario))].sort();
  const observedSurfaces = [...new Set(observations.map((entry) => entry.surface))].sort();
  const observedEvents = [...new Set(observations.map((entry) => entry.eventName))].sort();
  const versions = [
    ...new Set(observations.map((entry) => entry.cursorVersion).filter(Boolean)),
  ].sort();
  const accountKeys = [...new Set(observations.map((entry) => entry.accountKey).filter(Boolean))];
  const usageObservations = observations.filter((entry) => (entry.tokenGroups?.length ?? 0) > 0);
  const eventIdentityObservations = observations.filter(
    (entry) => (entry.eventIdentities?.length ?? 0) > 0,
  );
  const scenarioCoverage = Object.fromEntries(
    [...scenarios].map((scenario) => [scenario, observedScenarios.includes(scenario)]),
  );
  const coreSurfaceUsage = Object.fromEntries(
    [...surfaces].map((surface) => [
      surface,
      usageObservations.some((entry) => entry.surface === surface),
    ]),
  );
  const formulaEvidence = [
    ...new Set(
      usageObservations.flatMap((entry) => entry.tokenGroups.map((group) => group.formulaEvidence)),
    ),
  ].sort();
  const invalidCounters = observations.reduce(
    (total, entry) => total + (entry.invalidCounterPaths?.length ?? 0),
    0,
  );
  const gatePassed =
    Object.values(scenarioCoverage).every(Boolean) &&
    Object.values(coreSurfaceUsage).every(Boolean) &&
    usageObservations.length > 0 &&
    eventIdentityObservations.length > 0 &&
    accountKeys.length >= 2 &&
    observations.some((entry) => entry.providerTimestamp !== null) &&
    invalidCounters === 0 &&
    formulaEvidence.length === 1 &&
    formulaEvidence[0] === "matches_four_component_sum";
  return {
    schemaVersion: 1,
    gatePassed,
    observationCount: observations.length,
    observedScenarios,
    observedSurfaces,
    observedEvents,
    versions,
    distinctLocalAccountKeys: accountKeys.length,
    usageObservationCount: usageObservations.length,
    eventIdentityObservationCount: eventIdentityObservations.length,
    observationsWithProviderTimestamp: observations.filter(
      (entry) => entry.providerTimestamp !== null,
    ).length,
    invalidCounterCount: invalidCounters,
    formulaEvidence,
    scenarioCoverage,
    coreSurfaceUsage,
    limitations: gatePassed
      ? []
      : [
          "cursor_exact_source_not_proven",
          "cursor_account_scenarios_incomplete",
          "cursor_subagent_coverage_not_proven",
          "cursor_history_not_proven",
        ],
  };
}

async function main() {
  const [command, ...arguments_] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { options, passthrough } = parseArguments(arguments_);
  if (command === "install-hooks") {
    const result = await installProbeHooks({
      outputDirectory: options["output-dir"],
      surface: options.surface,
      scenario: options.scenario,
      hooksFile: options["hooks-file"],
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === "remove-hooks") {
    const result = await removeProbeHooks({
      outputDirectory: options["output-dir"],
      hooksFile: options["hooks-file"],
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === "capture-hook") {
    await captureHook(options);
    return;
  }
  if (command === "inspect-jsonl") {
    process.stdout.write(`${JSON.stringify(await inspectJsonl(options))}\n`);
    return;
  }
  if (command === "run-cli") {
    process.exitCode = await runCli(options, passthrough);
    return;
  }
  if (command === "report") {
    process.stdout.write(
      `${JSON.stringify(await buildEvidenceReport(options["output-dir"]), null, 2)}\n`,
    );
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (resolve(process.argv[1] ?? "") === scriptPath)
  main().catch((error) => {
    if (process.argv[2] === "capture-hook") {
      process.stdout.write("{}\n");
      process.exitCode = 0;
      return;
    }
    process.stderr.write(
      `${error instanceof Error ? error.message : "Cursor evidence probe failed"}\n`,
    );
    process.exitCode = 1;
  });
