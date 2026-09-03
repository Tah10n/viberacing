#!/usr/bin/env node

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  chmod,
  link,
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
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireOwnedLock, releaseOwnedLock } from "../packages/connector/lib/owned-lock.mjs";
import {
  ensureOwnerOnlyWindowsFile,
  ensurePrivateStateDirectory,
  inspectOwnerOnlyWindowsFile,
} from "../packages/connector/lib/windows-security.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const probeStateName = "cursor-evidence-state.json";
const observationsDirectoryName = "observations";
const hookLauncherSourcePath = join(repositoryRoot, "scripts", "cursor-evidence-hook-launcher.mjs");
const hookLauncherScriptName = "viberacing-cursor-evidence-probe-hook.mjs";
const hookLauncherCommandName =
  process.platform === "win32" ? "viberacing-cursor-evidence-probe.cmd" : hookLauncherScriptName;
const hookLauncherStateName = "viberacing-cursor-evidence-probe-state.json";
const hookLockName = "hooks.json.viberacing-cursor-evidence.lock";
const maximumInputBytes = 1_048_576;
const maximumFileBytes = 100_000_000;
const maximumObservations = 10_000;
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
const structuralKeys = new Set([
  ...counterNames.keys(),
  ...identityNames.keys(),
  ...accountIdentityNames.keys(),
  "afterAgentResponse",
  "args",
  "attachments",
  "accessToken",
  "access_token",
  "apiKey",
  "api_key",
  "code",
  "content",
  "data",
  "event",
  "events",
  "hook_event_name",
  "metadata",
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
  "sessionEnd",
  "status",
  "stop",
  "text",
  "tool_call",
  "tool_calls",
  "toolCall",
  "toolCalls",
  "transcript_path",
  "transcriptPath",
  "workspace_roots",
  "workspaceRoots",
  "usage",
  "tokenUsage",
  "token_usage",
  "timestamp",
  "created_at",
  "createdAt",
  "started_at",
  "startedAt",
  "cursor_version",
  "cursorVersion",
  "reason",
  "subtype",
]);
const safeVersionPattern = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stepPattern = /^(?:single|a1|b|a2|desktop|cli|parent|subagent|before|after)$/;

function usage() {
  return `Usage:
  node scripts/cursor-evidence-probe.mjs install-hooks --output-dir DIR --surface SURFACE --scenario SCENARIO --run-id UUID --step STEP
  node scripts/cursor-evidence-probe.mjs remove-hooks --output-dir DIR
  node scripts/cursor-evidence-probe.mjs run-cli --output-dir DIR --agent ABSOLUTE_PATH --scenario SCENARIO --run-id UUID --step STEP -- [agent arguments]
  node scripts/cursor-evidence-probe.mjs inspect-jsonl --output-dir DIR --input ABSOLUTE_PATH --surface SURFACE --scenario SCENARIO --run-id UUID --step STEP
  node scripts/cursor-evidence-probe.mjs report --output-dir DIR

SURFACE is desktop, cli-interactive, or cli-headless. Probe output must be outside the repository.
STEP is operator-declared metadata: single, a1, b, a2, desktop, cli, parent, subagent, before, or after.
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
  if (process.platform === "win32") {
    await ensurePrivateStateDirectory(actualPath);
  } else {
    if ((info.mode & 0o077) !== 0) throw new Error("Probe output directory is not owner-only");
    if (created) await chmod(path, 0o700);
  }
  return actualPath;
}

async function assertSafeRegularFile(
  path,
  { allowMissing = false, maximumBytes = maximumInputBytes, privateFile = false } = {},
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
  if (privateFile) {
    if (process.platform === "win32") {
      if (!(await inspectOwnerOnlyWindowsFile(path)))
        throw new Error("Probe private file must have a current-user-only Windows ACL");
    } else if ((info.mode & 0o077) !== 0) {
      throw new Error("Probe private file must be owner-only");
    }
  }
  return info;
}

async function securePrivateFile(path, { executable = false } = {}) {
  if (process.platform === "win32") await ensureOwnerOnlyWindowsFile(path);
  else await chmod(path, executable ? 0o700 : 0o600);
}

async function atomicBytes(path, value, { executable = false } = {}) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, value, {
      mode: 0o600,
      flag: "wx",
    });
    await securePrivateFile(temporary, { executable });
    await rename(temporary, path);
    await securePrivateFile(path, { executable });
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function atomicJson(path, value) {
  await atomicBytes(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readProbeState(outputDirectory, { create = false } = {}) {
  const output = await assertPrivateDirectory(resolve(outputDirectory), { create });
  const path = join(output, probeStateName);
  let state;
  try {
    await assertSafeRegularFile(path, { privateFile: true });
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

function requireRunId(value) {
  if (!uuidPattern.test(value ?? "")) throw new Error("Cursor evidence run ID must be a UUID");
  return value;
}

function requireStep(value) {
  if (!stepPattern.test(value ?? "")) throw new Error("Unknown Cursor evidence scenario step");
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
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) return null;
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    zone,
    ,
    zoneHourText = "0",
    zoneMinuteText = "0",
  ] = match;
  if (zone === "-00:00") return null;
  const [year, month, day, hour, minute, second, zoneHour, zoneMinute] = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    zoneHourText,
    zoneMinuteText,
  ].map(Number);
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second ||
    zoneMinute > 59 ||
    zoneHour > 14 ||
    (zoneHour === 14 && zoneMinute !== 0) ||
    (zone === "Z" && (zoneHour !== 0 || zoneMinute !== 0))
  )
    return null;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
}

function hmacIdentity(key, domain, value, prefix) {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) return null;
  return `${prefix}_${createHmac("sha256", key).update(domain).update("\0").update(value).digest("base64url")}`;
}

function candidateRelationships(counters) {
  if (counters.totalTokens === undefined) return [];
  const total = BigInt(counters.totalTokens);
  const candidates = [
    ["total_equals_input_plus_output", ["inputTokens", "outputTokens"]],
    [
      "total_equals_input_output_cache_read_cache_write",
      ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"],
    ],
    [
      "total_equals_all_observed_components_including_reasoning",
      ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"],
    ],
  ];
  return candidates
    .filter(([, names]) => names.every((name) => counters[name] !== undefined))
    .filter(([, names]) => names.reduce((sum, name) => sum + BigInt(counters[name]), 0n) === total)
    .map(([relationship]) => relationship);
}

function normalizedAccountValue(kind, value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) return null;
  const normalized = value.trim().normalize("NFC");
  if (!normalized) return null;
  return kind === "user_email" ? normalized.toLowerCase() : normalized;
}

function schemaKey(key, hmacKey) {
  if (structuralKeys.has(key)) return key;
  return `field1_${createHmac("sha256", hmacKey)
    .update("cursor-schema-key")
    .update("\0")
    .update(key)
    .digest("base64url")
    .slice(0, 22)}`;
}

export function sanitizeCursorObservation(payload, context) {
  const declaredSurface = requireSurface(context.surface);
  const declaredScenario = requireScenario(context.scenario);
  const declaredRunId = requireRunId(context.runId);
  const declaredStep = requireStep(context.step);
  const eventName = requireEvent(context.eventName);
  const schemaPaths = new Set();
  const counterGroups = new Map();
  const invalidCounterPaths = new Set();
  const identities = [];
  const accountCandidates = [];
  const timestamps = [];
  const invalidTimestampPaths = new Set();
  const truncationReasons = new Set();
  let cursorVersion = normalizedVersion(context.cursorVersion);
  let status = null;
  const visit = (value, path = "$", depth = 0) => {
    if (depth > 8) {
      truncationReasons.add("depth_limit");
      return;
    }
    if (schemaPaths.size >= 512) {
      truncationReasons.add("schema_path_limit");
      return;
    }
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      schemaPaths.add(`${path}:array`);
      if (value.length > 16) truncationReasons.add("array_item_limit");
      for (const item of value.slice(0, 16)) visit(item, `${path}[]`, depth + 1);
      return;
    }
    const entries = Object.entries(value);
    if (entries.length > 256) truncationReasons.add("object_key_limit");
    for (const [key, child] of entries.slice(0, 256)) {
      if (schemaPaths.size >= 512) {
        truncationReasons.add("schema_path_limit");
        break;
      }
      const childPath = `${path}.${schemaKey(key, context.hmacKey)}`;
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
        accountCandidates.push({
          kind: accountIdentityNames.get(key),
          value: normalizedAccountValue(accountIdentityNames.get(key), child),
        });
      if (["timestamp", "created_at", "createdAt", "started_at", "startedAt"].includes(key)) {
        const timestamp = normalizedTimestamp(child);
        if (timestamp !== null) timestamps.push({ path: childPath, value: timestamp });
        else invalidTimestampPaths.add(childPath);
      }
      if (key === "cursor_version" || key === "cursorVersion")
        cursorVersion ??= normalizedVersion(child);
      if (key === "status" || key === "reason" || key === "subtype")
        status ??= normalizedStatus(child);
      visit(child, childPath, depth + 1);
    }
  };
  visit(payload);
  const accountIdentityCandidates = [...new Set(accountIdentityNames.values())].map((kind) => ({
    kind,
    hashes: [
      ...new Set(
        accountCandidates
          .filter((candidate) => candidate.kind === kind && candidate.value !== null)
          .map((candidate) =>
            hmacIdentity(context.hmacKey, `cursor-account-alias:${kind}`, candidate.value, "acct1"),
          ),
      ),
    ].filter(Boolean),
  }));
  const accountAmbiguous = accountIdentityCandidates.some(
    (candidate) => candidate.hashes.length > 1,
  );
  const timestampCandidates = timestamps.filter(
    (candidate, index, values) =>
      values.findIndex(
        (other) => other.path === candidate.path && other.value === candidate.value,
      ) === index,
  );
  const timestampAmbiguous = timestampCandidates.length > 1;
  const eventIdentities = identities.filter(
    (identity, index, values) =>
      values.findIndex(
        (candidate) => candidate.field === identity.field && candidate.hash === identity.hash,
      ) === index,
  );
  if (eventIdentities.length > 32) truncationReasons.add("event_identity_limit");
  const tokenGroups = [...counterGroups.entries()]
    .map(([path, counters]) => ({
      path,
      counters,
      candidateRelationships: candidateRelationships(counters),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    schemaVersion: 1,
    observationId: randomUUID(),
    observedAt: new Date().toISOString(),
    declaredSurface,
    declaredScenario,
    declaredRunId,
    declaredStep,
    eventName,
    parseStatus: payload === null || typeof payload !== "object" ? "invalid" : "parsed",
    cursorVersion,
    status,
    timestampCandidates,
    timestampAmbiguous,
    providerTimestamp: timestampCandidates.length === 1 ? timestampCandidates[0].value : null,
    invalidTimestampPaths: [...invalidTimestampPaths].sort(),
    accountIdentityCandidates,
    accountAmbiguous,
    eventIdentities: eventIdentities.slice(0, 32),
    tokenGroups,
    invalidCounterPaths: [...invalidCounterPaths].sort(),
    schemaPaths: [...schemaPaths].sort(),
    truncated: truncationReasons.size > 0,
    truncationReasons: [...truncationReasons].sort(),
  };
}

export function observationCapacityReached(count, maximum = maximumObservations) {
  return count >= maximum;
}

function capacityObservation(observation) {
  return {
    ...observation,
    observationId: randomUUID(),
    parseStatus: "invalid",
    timestampCandidates: [],
    timestampAmbiguous: false,
    providerTimestamp: null,
    accountIdentityCandidates: [],
    accountAmbiguous: false,
    eventIdentities: [],
    tokenGroups: [],
    schemaPaths: [],
    truncated: true,
    truncationReasons: [
      ...new Set([...(observation.truncationReasons ?? []), "observation_capacity_limit"]),
    ].sort(),
  };
}

async function saveObservation(output, observation) {
  const directory = join(output, observationsDirectoryName);
  await assertPrivateDirectory(directory, { create: true });
  const names = await readdir(directory).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  if (observationCapacityReached(names.length))
    throw new Error("Cursor evidence observation limit reached");
  if (observationCapacityReached(names.length + 1)) {
    const sentinel = capacityObservation(observation);
    await atomicJson(join(directory, `${sentinel.observationId}.json`), sentinel);
    throw new Error("Cursor evidence observation limit reached");
  }
  await atomicJson(join(directory, `${observation.observationId}.json`), observation);
}

export async function readBoundedJson(stream, maximumBytes = maximumInputBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBytes) throw new Error("Cursor probe input exceeded the byte limit");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function hookCommandFor(platform = process.platform) {
  return platform === "win32"
    ? ".\\hooks\\viberacing-cursor-evidence-probe.cmd"
    : `./hooks/${hookLauncherScriptName}`;
}

function isOwnedHook(entry, platform = process.platform) {
  return typeof entry?.command === "string" && entry.command === hookCommandFor(platform);
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

async function readHooksSnapshot(hooksFile) {
  const info = await assertSafeRegularFile(hooksFile, { allowMissing: true, privateFile: true });
  if (info === null)
    return {
      document: { version: 1, hooks: {} },
      fingerprint: { exists: false },
    };
  const contents = await readFile(hooksFile);
  const after = await lstat(hooksFile);
  if (info.dev !== after.dev || info.ino !== after.ino || info.size !== after.size)
    throw new Error("Cursor hooks.json changed while it was read");
  return {
    document: validatedHooksDocument(JSON.parse(contents.toString("utf8"))),
    fingerprint: {
      exists: true,
      dev: String(after.dev),
      ino: String(after.ino),
      size: after.size,
      mtimeMs: after.mtimeMs,
      sha256: createHash("sha256").update(contents).digest("hex"),
    },
  };
}

async function hooksFingerprint(hooksFile) {
  const info = await assertSafeRegularFile(hooksFile, { allowMissing: true, privateFile: true });
  if (info === null) return { exists: false };
  const contents = await readFile(hooksFile);
  const after = await lstat(hooksFile);
  if (info.dev !== after.dev || info.ino !== after.ino || info.size !== after.size)
    throw new Error("Cursor hooks.json changed while it was fingerprinted");
  return {
    exists: true,
    dev: String(after.dev),
    ino: String(after.ino),
    size: after.size,
    mtimeMs: after.mtimeMs,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

function sameFingerprint(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hooksMutationPath(path, kind) {
  return `${path}.viberacing-cursor-evidence.${kind}`;
}

async function restoreDisplacedHooks(path, recovery) {
  try {
    await link(recovery, path);
    await unlink(recovery);
  } catch (error) {
    if (error?.code === "EEXIST")
      throw new Error(
        `Cursor hooks changed twice during recovery; both foreign versions were preserved at ${path} and ${recovery}`,
      );
    throw error;
  }
}

async function recoverInterruptedHooksMutation(path) {
  const recovery = hooksMutationPath(path, "recovery");
  const recoveryInfo = await assertSafeRegularFile(recovery, {
    allowMissing: true,
    privateFile: true,
  });
  if (recoveryInfo === null) return;
  const current = await assertSafeRegularFile(path, {
    allowMissing: true,
    privateFile: true,
  });
  if (current === null) await restoreDisplacedHooks(path, recovery);
  else await unlink(recovery);
}

async function stageHooksDocument(path, document) {
  const stage = hooksMutationPath(path, `stage-${process.pid}-${randomUUID()}`);
  await writeFile(stage, `${JSON.stringify(document, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await securePrivateFile(stage);
  return stage;
}

async function publishHooksConditionally(
  path,
  document,
  expected,
  { beforeCompareAndSwap, afterDisplace } = {},
) {
  const stage = await stageHooksDocument(path, document);
  const recovery = hooksMutationPath(path, "recovery");
  try {
    await beforeCompareAndSwap?.();
    if (!sameFingerprint(expected, await hooksFingerprint(path))) return false;
    if (!expected.exists) {
      try {
        await link(stage, path);
      } catch (error) {
        if (error?.code === "EEXIST") return false;
        throw error;
      }
      return true;
    }
    const priorRecovery = await assertSafeRegularFile(recovery, {
      allowMissing: true,
      privateFile: true,
    });
    if (priorRecovery !== null)
      throw new Error("Cursor hooks recovery is already pending; no update was written");
    try {
      await rename(path, recovery);
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
    if (!sameFingerprint(expected, await hooksFingerprint(recovery))) {
      await restoreDisplacedHooks(path, recovery);
      return false;
    }
    await afterDisplace?.();
    try {
      await link(stage, path);
    } catch (error) {
      if (error?.code !== "EEXIST") {
        await restoreDisplacedHooks(path, recovery);
        throw error;
      }
      await unlink(recovery);
      return false;
    }
    await unlink(recovery);
    return true;
  } finally {
    await unlink(stage).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function mutateHooksWithCas(path, mutate, { beforeCompareAndSwap, afterDisplace } = {}) {
  await recoverInterruptedHooksMutation(path);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { document, fingerprint } = await readHooksSnapshot(path);
    const changed = mutate(document);
    if (!changed) return false;
    const published = await publishHooksConditionally(path, document, fingerprint, {
      beforeCompareAndSwap: () => beforeCompareAndSwap?.({ attempt, path }),
      afterDisplace: () => afterDisplace?.({ attempt, path }),
    });
    if (published) return true;
    if (attempt === 0) continue;
    throw new Error("Cursor hooks.json changed concurrently; no probe update was written");
  }
  throw new Error("Cursor hooks.json compare-and-swap retry exhausted");
}

function windowsLauncherContents(nodePath = process.execPath) {
  if (/[\0\r\n"]/u.test(nodePath)) throw new Error("Unsafe Node executable path for Windows hook");
  const escapedNodePath = nodePath.replaceAll("%", "%%");
  return `@echo off\r\nsetlocal DisableDelayedExpansion\r\n"${escapedNodePath}" "%~dp0${hookLauncherScriptName}"\r\nexit /b %ERRORLEVEL%\r\n`;
}

async function writeOwnedArtifact(path, contents, { executable = false, allowOwnedState } = {}) {
  const info = await assertSafeRegularFile(path, {
    allowMissing: true,
    maximumBytes: maximumInputBytes,
    privateFile: true,
  });
  if (info !== null) {
    const current = await readFile(path, "utf8");
    if (current !== contents && !allowOwnedState)
      throw new Error(`Cursor probe-owned artifact changed unexpectedly: ${path}`);
  }
  await atomicBytes(path, contents, { executable });
}

async function installHookLauncher(parent, configuration) {
  const directory = join(parent, "hooks");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(directory);
  if (
    !directoryInfo.isDirectory() ||
    directoryInfo.isSymbolicLink() ||
    (typeof process.getuid === "function" && directoryInfo.uid !== process.getuid())
  )
    throw new Error("Cursor hook launcher directory must be a current-user real directory");
  if (process.platform === "win32") await ensurePrivateStateDirectory(directory);
  else if ((directoryInfo.mode & 0o077) !== 0)
    throw new Error("Cursor hook launcher directory must be owner-only");
  const launcher = join(directory, hookLauncherScriptName);
  const launcherState = join(directory, hookLauncherStateName);
  const source = await readFile(hookLauncherSourcePath, "utf8");
  await writeOwnedArtifact(launcher, source, { executable: true });
  if (process.platform === "win32") {
    await writeOwnedArtifact(join(directory, hookLauncherCommandName), windowsLauncherContents(), {
      executable: true,
    });
  }
  const priorStateInfo = await assertSafeRegularFile(launcherState, {
    allowMissing: true,
    privateFile: true,
  });
  if (priorStateInfo !== null) {
    const priorState = JSON.parse(await readFile(launcherState, "utf8"));
    if (priorState?.probeId !== configuration.probeId)
      throw new Error("A foreign Cursor evidence launcher state already exists");
  }
  await writeOwnedArtifact(launcherState, `${JSON.stringify(configuration, null, 2)}\n`, {
    allowOwnedState: true,
  });
  return { launcher, launcherState };
}

async function withHooksLock(parent, operation) {
  const lock = await acquireOwnedLock(join(parent, hookLockName), {
    waitMs: 1_000,
    staleMs: 60_000,
  });
  if (!lock) throw new Error("Cursor hooks are busy; no probe update was written");
  try {
    await securePrivateFile(lock.path);
    return await operation();
  } finally {
    await releaseOwnedLock(lock);
  }
}

export async function installProbeHooks({
  outputDirectory,
  surface,
  scenario,
  runId,
  step,
  hooksFile,
  beforeCompareAndSwap,
  afterDisplace,
}) {
  const { output, state } = await readProbeState(outputDirectory, { create: true });
  const declaredSurface = requireSurface(surface);
  const declaredScenario = requireScenario(scenario);
  const declaredRunId = requireRunId(runId);
  const declaredStep = requireStep(step);
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
  return withHooksLock(parent, async () => {
    await installHookLauncher(parent, {
      schemaVersion: 1,
      probeId: state.probeId,
      outputDirectory: output,
      probeScriptPath: scriptPath,
      declaredSurface,
      declaredScenario,
      declaredRunId,
      declaredStep,
    });
    const changed = await mutateHooksWithCas(
      path,
      (document) => {
        document.version ??= 1;
        document.hooks ??= {};
        let mutated = false;
        for (const eventName of eventNames) {
          const entries = document.hooks[eventName] ?? [];
          if (!Array.isArray(entries))
            throw new Error(`Cursor ${eventName} hooks must be an array`);
          const retained = entries.filter((entry) => !isOwnedHook(entry));
          const next = [...retained, { command: hookCommandFor() }];
          document.hooks[eventName] = next;
          if (JSON.stringify(next) !== JSON.stringify(entries)) mutated = true;
        }
        return mutated;
      },
      { beforeCompareAndSwap, afterDisplace },
    );
    return {
      changed,
      probeId: state.probeId,
      hooks: [...eventNames],
      command: hookCommandFor(),
    };
  });
}

export async function removeProbeHooks({ outputDirectory, hooksFile }) {
  const { state } = await readProbeState(outputDirectory);
  const path = resolve(hooksFile ?? join(homedir(), ".cursor", "hooks.json"));
  const parent = dirname(path);
  return withHooksLock(parent, async () => {
    const changed = await mutateHooksWithCas(path, (document) => {
      let mutated = false;
      for (const eventName of eventNames) {
        if (!Array.isArray(document.hooks?.[eventName])) continue;
        const retained = document.hooks[eventName].filter((entry) => !isOwnedHook(entry));
        if (retained.length !== document.hooks[eventName].length) mutated = true;
        if (retained.length === 0) delete document.hooks[eventName];
        else document.hooks[eventName] = retained;
      }
      return mutated;
    });
    const directory = join(parent, "hooks");
    const launcherState = join(directory, hookLauncherStateName);
    let artifactsRemoved = false;
    const stateInfo = await assertSafeRegularFile(launcherState, {
      allowMissing: true,
      privateFile: true,
    });
    if (stateInfo !== null) {
      const configuration = JSON.parse(await readFile(launcherState, "utf8"));
      if (configuration?.probeId !== state.probeId)
        throw new Error("Cursor evidence launcher state is foreign; artifacts were preserved");
      const expected = new Map([
        [join(directory, hookLauncherScriptName), await readFile(hookLauncherSourcePath, "utf8")],
        [launcherState, `${JSON.stringify(configuration, null, 2)}\n`],
      ]);
      if (process.platform === "win32")
        expected.set(join(directory, hookLauncherCommandName), windowsLauncherContents());
      for (const [artifact, expectedContents] of expected) {
        await assertSafeRegularFile(artifact, { privateFile: true });
        if ((await readFile(artifact, "utf8")) !== expectedContents)
          throw new Error("Cursor evidence launcher artifact changed; artifacts were preserved");
      }
      for (const artifact of expected.keys()) await unlink(artifact);
      artifactsRemoved = true;
    }
    return { changed, artifactsRemoved };
  });
}

export async function captureCursorHook(
  configuration,
  input = process.stdin,
  outputStream = process.stdout,
) {
  const { output, state } = await readProbeState(configuration.outputDirectory);
  if (configuration.probeId !== state.probeId) throw new Error("Stale Cursor evidence hook");
  const payload = await readBoundedJson(input);
  const eventName = requireEvent(payload?.hook_event_name);
  const observation = sanitizeCursorObservation(payload, {
    surface: configuration.declaredSurface,
    scenario: configuration.declaredScenario,
    runId: configuration.declaredRunId,
    step: configuration.declaredStep,
    eventName,
    hmacKey: state.hmacKey,
  });
  await saveObservation(output, observation);
  outputStream.write("{}\n");
}

async function inspectJsonl(options) {
  const { output, state } = await readProbeState(options["output-dir"], { create: true });
  const input = resolve(options.input ?? "");
  if (!isAbsolute(options.input ?? "")) throw new Error("Cursor JSONL input path must be absolute");
  const info = await assertSafeRegularFile(input, {
    maximumBytes: maximumFileBytes,
    privateFile: true,
  });
  if (info.size > maximumFileBytes) throw new Error("Cursor JSONL input exceeded the byte limit");
  const surface = requireSurface(options.surface);
  const scenario = requireScenario(options.scenario);
  const runId = requireRunId(options["run-id"]);
  const step = requireStep(options.step);
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
            runId,
            step,
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

function invalidStreamObservation(context, reason) {
  const observation = sanitizeCursorObservation(null, context);
  if (reason !== "empty_stream") {
    observation.truncated = true;
    observation.truncationReasons = [reason];
  }
  return observation;
}

export async function runCursorCli({
  outputDirectory,
  executable,
  scenario,
  runId,
  step,
  passthrough = [],
  maximumObservationCount = maximumObservations,
  outputStream = process.stdout,
  errorStream = process.stderr,
  signalSource = process,
  spawnImplementation = spawn,
  spawnSyncImplementation = spawnSync,
  saveObservationImplementation = saveObservation,
}) {
  const { output, state } = await readProbeState(outputDirectory, { create: true });
  if (!isAbsolute(executable ?? "")) throw new Error("Cursor agent path must be absolute");
  await assertSafeRegularFile(resolve(executable), { maximumBytes: Number.MAX_SAFE_INTEGER });
  const declaredScenario = requireScenario(scenario);
  const declaredRunId = requireRunId(runId);
  const declaredStep = requireStep(step);
  if (!Number.isInteger(maximumObservationCount) || maximumObservationCount < 1)
    throw new Error("Cursor evidence observation limit must be a positive integer");
  const version = spawnSyncImplementation(executable, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
  });
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
  const child = spawnImplementation(executable, arguments_, { stdio: ["inherit", "pipe", "pipe"] });
  child.stderr.pipe(errorStream);
  child.stdout.setEncoding("utf8");
  let pending = "";
  let observations = 0;
  let invalidReason = null;
  const context = {
    surface: "cli-headless",
    scenario: declaredScenario,
    runId: declaredRunId,
    step: declaredStep,
    eventName: "stream-json",
    cursorVersion,
    hmacKey: state.hmacKey,
  };
  const validObservationLimit = Math.max(0, maximumObservationCount - 1);
  const recordLine = async (line) => {
    if (!line.trim()) return;
    if (observations >= validObservationLimit) {
      invalidReason = "stream_observation_limit";
      return;
    }
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      invalidReason ??= "malformed_stream_record";
      return;
    }
    await saveObservationImplementation(output, sanitizeCursorObservation(payload, context));
    observations += 1;
  };
  const signalHandlers = new Map(
    ["SIGINT", "SIGTERM"].map((signal) => [signal, () => child.kill(signal)]),
  );
  let closeSettled = false;
  const closed = new Promise((resolveClose, reject) => {
    child.once("error", (error) => {
      closeSettled = true;
      reject(error);
    });
    child.once("close", (code, signal) => {
      closeSettled = true;
      resolveClose({ code, signal });
    });
  });
  void closed.catch(() => {});
  const forwardOutput = async (chunk) => {
    if (outputStream.write(chunk) !== false) return;
    if (typeof outputStream.once !== "function")
      throw new Error("Cursor probe output stream cannot signal backpressure completion");
    await new Promise((resolveDrain, rejectDrain) => {
      const cleanup = () => {
        outputStream.removeListener?.("drain", onDrain);
        outputStream.removeListener?.("error", onError);
      };
      const onDrain = () => {
        cleanup();
        resolveDrain();
      };
      const onError = (error) => {
        cleanup();
        rejectDrain(error);
      };
      outputStream.once("drain", onDrain);
      outputStream.once("error", onError);
    });
  };
  const terminateAndAwaitClose = async () => {
    let forceTimer;
    if (!closeSettled) {
      try {
        child.kill("SIGTERM");
      } catch {
        // The process may have exited between the state check and kill.
      }
      forceTimer = setTimeout(() => {
        if (!closeSettled)
          try {
            child.kill("SIGKILL");
          } catch {
            // The process may have exited before forced termination.
          }
      }, 1_000);
      forceTimer.unref?.();
    }
    try {
      await closed;
    } catch {
      // Preserve the processing error that required cleanup.
    } finally {
      if (forceTimer) clearTimeout(forceTimer);
    }
  };
  for (const [signal, handler] of signalHandlers) signalSource.once(signal, handler);
  try {
    for await (const chunk of child.stdout) {
      await forwardOutput(chunk);
      pending += chunk;
      if (Buffer.byteLength(pending) > maximumInputBytes) {
        pending = "";
        invalidReason = "stream_record_byte_limit";
        continue;
      }
      for (;;) {
        const newline = pending.indexOf("\n");
        if (newline < 0) break;
        const line = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        await recordLine(line);
      }
    }
    if (pending.trim()) invalidReason ??= "unterminated_stream_record";
    if (invalidReason !== null || observations === 0)
      await saveObservationImplementation(
        output,
        invalidStreamObservation(context, invalidReason ?? "empty_stream"),
      );
    return await closed;
  } catch (error) {
    await terminateAndAwaitClose();
    throw error;
  } finally {
    for (const [signal, handler] of signalHandlers) signalSource.removeListener(signal, handler);
  }
}

function accountGraph(observations) {
  const parent = new Map();
  const find = (value) => {
    const current = parent.get(value) ?? value;
    if (current === value) {
      parent.set(value, value);
      return value;
    }
    const root = find(current);
    parent.set(value, root);
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    const [first, second] = [leftRoot, rightRoot].sort();
    parent.set(second, first);
  };
  const nodesFor = (entry) =>
    entry.accountAmbiguous
      ? []
      : (entry.accountIdentityCandidates ?? []).flatMap(({ kind, hashes }) =>
          (hashes ?? []).map((hash) => `${kind}:${hash}`),
        );
  for (const entry of observations) {
    const nodes = nodesFor(entry);
    for (const node of nodes) find(node);
    for (const node of nodes.slice(1)) union(nodes[0], node);
  }
  return {
    component(entry) {
      const roots = [...new Set(nodesFor(entry).map(find))];
      return roots.length === 1 ? roots[0] : null;
    },
    count: new Set([...parent.keys()].map(find)).size,
  };
}

function groupByRun(observations, scenario) {
  const grouped = new Map();
  for (const entry of observations.filter((candidate) => candidate.declaredScenario === scenario)) {
    const run = grouped.get(entry.declaredRunId) ?? [];
    run.push(entry);
    grouped.set(entry.declaredRunId, run);
  }
  return [...grouped.values()];
}

export async function buildEvidenceReport(
  outputDirectory,
  { maximumObservationCount = maximumObservations } = {},
) {
  if (!Number.isInteger(maximumObservationCount) || maximumObservationCount < 1)
    throw new Error("Cursor evidence report observation limit must be a positive integer");
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
  const observationSetTruncated = observationCapacityReached(names.length, maximumObservationCount);
  for (const name of names.slice(0, maximumObservationCount)) {
    const path = join(directory, name);
    await assertSafeRegularFile(path, { privateFile: true });
    observations.push(JSON.parse(await readFile(path, "utf8")));
  }
  const observedScenarios = [
    ...new Set(observations.map((entry) => entry.declaredScenario).filter(Boolean)),
  ].sort();
  const observedSurfaces = [
    ...new Set(observations.map((entry) => entry.declaredSurface).filter(Boolean)),
  ].sort();
  const observedEvents = [...new Set(observations.map((entry) => entry.eventName))].sort();
  const versions = [
    ...new Set(observations.map((entry) => entry.cursorVersion).filter(Boolean)),
  ].sort();
  const graph = accountGraph(observations);
  const eligible = observations.filter(
    (entry) =>
      entry.parseStatus === "parsed" &&
      !entry.truncated &&
      !entry.accountAmbiguous &&
      !entry.timestampAmbiguous &&
      (entry.invalidCounterPaths?.length ?? 0) === 0 &&
      (entry.invalidTimestampPaths?.length ?? 0) === 0,
  );
  const usageObservations = eligible.filter(
    (entry) => (entry.tokenGroups?.length ?? 0) > 0 && entry.providerTimestamp !== null,
  );
  const eventIdentityObservations = observations.filter(
    (entry) => (entry.eventIdentities?.length ?? 0) > 0,
  );
  const hasUsage = (entry) => usageObservations.includes(entry);
  const account = (entry) => graph.component(entry);
  const hasOnlySteps = (entries, steps) => {
    const expected = new Set(steps);
    return (
      entries.length > 0 &&
      entries.every((entry) => expected.has(entry.declaredStep)) &&
      steps.every((step) => entries.some((entry) => entry.declaredStep === step))
    );
  };
  const consistentStep = (entries, step, predicate = () => true) => {
    const matches = entries.filter((entry) => entry.declaredStep === step);
    if (matches.length === 0 || matches.some((entry) => !predicate(entry))) return null;
    const signatures = matches.map((entry) => ({
      account: account(entry),
      surface: entry.declaredSurface,
      providerTimestamp: entry.providerTimestamp,
      status: entry.status,
      tokenGroups: entry.tokenGroups,
    }));
    if (
      signatures.some(
        (signature) => signature.account === null || signature.providerTimestamp === null,
      ) ||
      new Set(signatures.map((signature) => JSON.stringify(signature))).size !== 1
    )
      return null;
    return matches[0];
  };
  const oneTurn = (scenario, surface) =>
    groupByRun(eligible, scenario).some(
      (entries) =>
        hasOnlySteps(entries, ["single"]) &&
        consistentStep(
          entries,
          "single",
          (entry) => entry.declaredSurface === surface && hasUsage(entry),
        ) !== null,
    );
  const pairedAccount = (scenario, shouldMatch) =>
    groupByRun(eligible, scenario).some((entries) => {
      if (!hasOnlySteps(entries, ["desktop", "cli"])) return false;
      const desktop = consistentStep(
        entries,
        "desktop",
        (entry) => entry.declaredSurface === "desktop" && hasUsage(entry),
      );
      const cli = consistentStep(
        entries,
        "cli",
        (entry) =>
          typeof entry.declaredSurface === "string" &&
          entry.declaredSurface.startsWith("cli-") &&
          hasUsage(entry),
      );
      const left = desktop && account(desktop);
      const right = cli && account(cli);
      return Boolean(left && right && (shouldMatch ? left === right : left !== right));
    });
  const aba = (scenario, surface) =>
    groupByRun(eligible, scenario).some((entries) => {
      if (!hasOnlySteps(entries, ["a1", "b", "a2"])) return false;
      const values = ["a1", "b", "a2"].map((step) => {
        const entry = consistentStep(
          entries,
          step,
          (candidate) => candidate.declaredSurface === surface && hasUsage(candidate),
        );
        return entry && account(entry);
      });
      return Boolean(values.every(Boolean) && values[0] === values[2] && values[0] !== values[1]);
    });
  const scenarioCoverage = {
    "desktop-one-turn": oneTurn("desktop-one-turn", "desktop"),
    "cli-interactive-one-turn": oneTurn("cli-interactive-one-turn", "cli-interactive"),
    "cli-headless-one-turn": oneTurn("cli-headless-one-turn", "cli-headless"),
    "desktop-cli-same-account": pairedAccount("desktop-cli-same-account", true),
    "desktop-cli-different-accounts": pairedAccount("desktop-cli-different-accounts", false),
    "cli-a-b-a": aba("cli-a-b-a", "cli-interactive"),
    "desktop-a-b-a": aba("desktop-a-b-a", "desktop"),
    subagent: groupByRun(eligible, "subagent").some(
      (entries) =>
        hasOnlySteps(entries, ["parent", "subagent"]) &&
        consistentStep(entries, "parent", hasUsage) !== null &&
        consistentStep(entries, "subagent", hasUsage) !== null,
    ),
    "aborted-error": groupByRun(eligible, "aborted-error").some(
      (entries) =>
        hasOnlySteps(entries, ["single"]) &&
        consistentStep(entries, "single", (entry) =>
          ["aborted", "error", "failure"].includes(entry.status),
        ) !== null,
    ),
    "utc-midnight": groupByRun(eligible, "utc-midnight").some((entries) => {
      if (!hasOnlySteps(entries, ["before", "after"])) return false;
      const before = consistentStep(entries, "before", hasUsage);
      const after = consistentStep(entries, "after", hasUsage);
      return Boolean(
        before &&
        after &&
        account(before) === account(after) &&
        before.providerTimestamp.slice(0, 10) !== after.providerTimestamp.slice(0, 10),
      );
    }),
  };
  const coreSurfaceUsage = Object.fromEntries(
    [...surfaces].map((surface) => [
      surface,
      usageObservations.some((entry) => entry.declaredSurface === surface),
    ]),
  );
  const observedCandidateRelationships = [
    ...new Set(
      usageObservations.flatMap((entry) =>
        entry.tokenGroups.flatMap((group) => group.candidateRelationships ?? []),
      ),
    ),
  ].sort();
  const invalidCounters = observations.reduce(
    (total, entry) => total + (entry.invalidCounterPaths?.length ?? 0),
    0,
  );
  const invalidTimestamps = observations.reduce(
    (total, entry) => total + (entry.invalidTimestampPaths?.length ?? 0),
    0,
  );
  const truncatedObservations = observations.filter((entry) => entry.truncated).length;
  const ambiguousAccounts = observations.filter((entry) => entry.accountAmbiguous).length;
  const ambiguousTimestamps = observations.filter((entry) => entry.timestampAmbiguous).length;
  const hookIdentities = new Set(
    eventIdentityObservations
      .filter((entry) => eventNames.includes(entry.eventName))
      .flatMap((entry) => entry.eventIdentities.map(({ hash }) => hash)),
  );
  const historyIdentities = new Set(
    eventIdentityObservations
      .filter((entry) => entry.eventName === "local-jsonl")
      .flatMap((entry) => entry.eventIdentities.map(({ hash }) => hash)),
  );
  const hookHistoryIdentityReconciled = [...hookIdentities].some((hash) =>
    historyIdentities.has(hash),
  );
  const mechanicalCoverageComplete =
    Object.values(scenarioCoverage).every(Boolean) &&
    Object.values(coreSurfaceUsage).every(Boolean) &&
    usageObservations.length > 0 &&
    hookHistoryIdentityReconciled &&
    graph.count >= 2 &&
    invalidCounters === 0 &&
    invalidTimestamps === 0 &&
    truncatedObservations === 0 &&
    ambiguousAccounts === 0 &&
    ambiguousTimestamps === 0 &&
    !observationSetTruncated;
  const limitations = [
    "production_gate_requires_authenticated_review",
    "surface_scenario_run_and_step_are_operator_declared",
    "cursor_exact_source_not_independently_authenticated",
    "token_relationship_requires_reviewer_interpretation",
  ];
  if (!mechanicalCoverageComplete) limitations.push("mechanical_coverage_incomplete");
  if (!hookHistoryIdentityReconciled) limitations.push("hook_history_identity_not_reconciled");
  if (graph.count < 2) limitations.push("distinct_accounts_not_demonstrated");
  if (truncatedObservations > 0 || observationSetTruncated)
    limitations.push("truncated_observations_cannot_qualify");
  if (ambiguousAccounts > 0 || ambiguousTimestamps > 0)
    limitations.push("ambiguous_observations_cannot_qualify");
  return {
    schemaVersion: 1,
    productionGate: "closed",
    mechanicalCoverageComplete,
    observationCount: observations.length,
    observationSetTruncated,
    observedScenarios,
    observedSurfaces,
    observedEvents,
    versions,
    distinctLocallyLinkedAccounts: graph.count,
    usageObservationCount: usageObservations.length,
    eventIdentityObservationCount: eventIdentityObservations.length,
    observationsWithProviderTimestamp: observations.filter(
      (entry) => entry.providerTimestamp !== null,
    ).length,
    invalidCounterCount: invalidCounters,
    invalidTimestampCount: invalidTimestamps,
    truncatedObservationCount: truncatedObservations,
    ambiguousAccountObservationCount: ambiguousAccounts,
    ambiguousTimestampObservationCount: ambiguousTimestamps,
    hookHistoryIdentityReconciled,
    observedCandidateRelationships,
    scenarioCoverage,
    coreSurfaceUsage,
    limitations,
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
      runId: options["run-id"],
      step: options.step,
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
  if (command === "inspect-jsonl") {
    process.stdout.write(`${JSON.stringify(await inspectJsonl(options))}\n`);
    return;
  }
  if (command === "run-cli") {
    const result = await runCursorCli({
      outputDirectory: options["output-dir"],
      executable: options.agent,
      scenario: options.scenario,
      runId: options["run-id"],
      step: options.step,
      passthrough,
    });
    if (result.signal) process.kill(process.pid, result.signal);
    else process.exitCode = result.code ?? 0;
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
    process.stderr.write(
      `${error instanceof Error ? error.message : "Cursor evidence probe failed"}\n`,
    );
    process.exitCode = 1;
  });
