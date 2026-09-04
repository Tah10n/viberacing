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
  rmdir,
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
const runsDirectoryName = "runs";
const hookLauncherSourcePath = join(repositoryRoot, "scripts", "cursor-evidence-hook-launcher.mjs");
const ownedLockSourcePath = join(repositoryRoot, "packages", "connector", "lib", "owned-lock.mjs");
const windowsSecuritySourcePath = join(
  repositoryRoot,
  "packages",
  "connector",
  "lib",
  "windows-security.mjs",
);
const hookLauncherScriptName = "viberacing-cursor-evidence-probe-hook.mjs";
const hookLauncherCommandName =
  process.platform === "win32" ? "viberacing-cursor-evidence-probe.cmd" : hookLauncherScriptName;
const hookLauncherStateName = "viberacing-cursor-evidence-probe-state.json";
const hookBundlePrefix = "viberacing-cursor-evidence-";
const hookLockName = "hooks.json.viberacing-cursor-evidence.lock";
const runManifestLockSuffix = ".lock";
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
const schemaPathPattern = /^\$(?:\.(?:[A-Za-z_][A-Za-z0-9_]*|field1_[A-Za-z0-9_-]{22})|\[\])*$/;
const manifestFailureCodes = new Set([
  "child_exit_failure",
  "child_signal_failure",
  "duplicate_manifest",
  "event_identity_mismatch",
  "hook_capture_failure",
  "hook_install_failure",
  "input_byte_limit",
  "input_read_failure",
  "malformed_json",
  "observation_limit",
  "observation_write_failure",
  "record_byte_limit",
  "run_manifest_conflict",
  "stream_invalid",
  "stream_processing_failure",
  "unexpected_additional_invocation",
  "unterminated_record",
]);
const contentBearingKeys = new Set([
  "args",
  "attachments",
  "content",
  "message",
  "prompt",
  "response",
]);
const evidencePriorityKeys = new Set([
  ...counterNames.keys(),
  ...identityNames.keys(),
  ...accountIdentityNames.keys(),
  "created_at",
  "createdAt",
  "cursor_version",
  "cursorVersion",
  "events",
  "reason",
  "started_at",
  "startedAt",
  "status",
  "subtype",
  "timestamp",
  "token_usage",
  "tokenUsage",
  "usage",
]);
const windowsDirectoryEnvironmentVariable = "VIBERACING_CURSOR_EVIDENCE_DIRECTORY";
const windowsDirectoryModeEnvironmentVariable = "VIBERACING_CURSOR_EVIDENCE_DIRECTORY_MODE";
const windowsDirectoryInspection = [
  "$ErrorActionPreference='Stop'",
  `$path=$env:${windowsDirectoryEnvironmentVariable}`,
  `$mode=$env:${windowsDirectoryModeEnvironmentVariable}`,
  "if ([string]::IsNullOrWhiteSpace($path)) { throw 'Missing directory path' }",
  "$entry=Get-Item -LiteralPath $path -Force -ErrorAction Stop",
  "if (-not $entry.PSIsContainer) { throw 'Target is not a directory' }",
  "if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Directory is a reparse point' }",
  "$identity=[Security.Principal.WindowsIdentity]::GetCurrent()",
  "$acl=[IO.Directory]::GetAccessControl($entry.FullName)",
  "$owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value",
  "if ($owner -ne $identity.User.Value) { throw 'Directory owner mismatch' }",
  "if ($mode -eq 'private') {",
  "  if (-not $acl.AreAccessRulesProtected) { throw 'Private directory inherits access rules' }",
  "  $rules=@($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))",
  "  if ($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $identity.User.Value -or $rules[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or (($rules[0].FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl)) { throw 'Private directory ACL is not owner-only' }",
  "}",
].join("; ");
const encodedWindowsDirectoryInspection = Buffer.from(
  windowsDirectoryInspection,
  "utf16le",
).toString("base64");

function usage() {
  return `Usage:
  node scripts/cursor-evidence-probe.mjs install-hooks --output-dir DIR --surface SURFACE --scenario SCENARIO --run-id UUID --step STEP --event EVENT [--expected-event-id-kind KIND --expected-event-id-path PATH --expected-event-id-file FILE] [--version-path PATH]
  node scripts/cursor-evidence-probe.mjs remove-hooks --output-dir DIR
  node scripts/cursor-evidence-probe.mjs run-cli --output-dir DIR --agent ABSOLUTE_PATH --scenario SCENARIO --run-id UUID --step STEP -- [agent arguments]
  node scripts/cursor-evidence-probe.mjs inspect-jsonl --output-dir DIR --input ABSOLUTE_PATH --surface SURFACE --scenario SCENARIO --run-id UUID --step STEP [--version-path PATH]
  node scripts/cursor-evidence-probe.mjs report --output-dir DIR --event-identity-kind KIND --counter-path PATHS --account-path PATHS --event-id-path PATHS --timestamp-path PATHS --version-source SOURCES

SURFACE is desktop, cli-interactive, or cli-headless. Probe output must be outside the repository.
STEP is operator-declared metadata: single, a1, b, a2, desktop, cli, parent, subagent, before, or after.
EVENT is afterAgentResponse, stop, or sessionEnd. Install exactly one lifecycle event per run/step.
KIND is the reviewer-approved event_id, request_id, or generation_id used for hook/history reconciliation.
PATHS and SOURCES are comma-separated exact schema paths; CLI version evidence uses source "cli".
FILE is an owner-only JSON file containing the expected identity as one JSON string; only its HMAC is stored.
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

export function inspectCurrentUserWindowsDirectory(path, { privateDirectory = false } = {}) {
  if (process.platform !== "win32") return true;
  const systemRoot = process.env.SystemRoot?.trim();
  if (!systemRoot || !isAbsolute(systemRoot) || !isAbsolute(path)) return false;
  const powershell = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const result = spawnSync(
    powershell,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodedWindowsDirectoryInspection,
    ],
    {
      env: {
        ...process.env,
        [windowsDirectoryEnvironmentVariable]: resolve(path),
        [windowsDirectoryModeEnvironmentVariable]: privateDirectory ? "private" : "shared",
      },
      stdio: "ignore",
      windowsHide: true,
      timeout: 15_000,
    },
  );
  return result.status === 0;
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
    if (created) await ensurePrivateStateDirectory(actualPath);
    else if (!inspectCurrentUserWindowsDirectory(actualPath, { privateDirectory: true }))
      throw new Error("Probe output directory does not have a current-user-only Windows ACL");
  } else {
    if ((info.mode & 0o077) !== 0) throw new Error("Probe output directory is not owner-only");
    if (created) await chmod(path, 0o700);
  }
  return actualPath;
}

async function assertSafeRegularFile(
  path,
  {
    allowMissing = false,
    allowMultipleLinks = false,
    maximumBytes = maximumInputBytes,
    privateFile = false,
  } = {},
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
    (!allowMultipleLinks && info.nlink !== 1) ||
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

function runManifestPath(output, runId, step, eventName) {
  return join(output, runsDirectoryName, runId, step, `${eventName}.json`);
}

function manifestDescriptor({
  probeId,
  surface,
  scenario,
  runId,
  step,
  eventName,
  expectedEventIdentity = null,
  versionPath = null,
}) {
  if (!uuidPattern.test(probeId ?? "")) throw new Error("Cursor evidence probe ID is invalid");
  if (!(
    expectedEventIdentity === null ||
    (["event_id", "request_id", "generation_id"].includes(expectedEventIdentity?.kind) &&
      schemaPathPattern.test(expectedEventIdentity?.path ?? "") &&
      /^evt1_[A-Za-z0-9_-]{43}$/.test(expectedEventIdentity?.hash ?? ""))
  ))
    throw new Error("Cursor expected event identity binding is invalid");
  if (!(
    versionPath === null ||
    /^\$\.(?:[A-Za-z_][A-Za-z0-9_]*|field1_[A-Za-z0-9_-]{22})$/.test(versionPath ?? "")
  ))
    throw new Error("Cursor approved version path is invalid");
  return {
    probeId,
    declaredSurface: requireSurface(surface),
    declaredScenario: requireScenario(scenario),
    declaredRunId: requireRunId(runId),
    declaredStep: requireStep(step),
    eventName: requireEvent(eventName),
    expectedEventIdentity,
    versionPath,
  };
}

function newRunManifest(descriptor) {
  return {
    schemaVersion: 1,
    manifestId: randomUUID(),
    ...descriptor,
    status: "pending",
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    invocationCount: 0,
    inputComplete: false,
    failureCode: null,
    activeInvocationId: null,
    identityBindingStatus:
      eventNames.includes(descriptor.eventName) && descriptor.expectedEventIdentity === null
        ? "unbound"
        : descriptor.expectedEventIdentity === null
          ? "not_applicable"
          : "pending",
    observationIds: [],
    schemaSignatures: [],
    contracts: [],
  };
}

function manifestDescriptorMatches(manifest, descriptor) {
  return (
    [
      "probeId",
      "declaredSurface",
      "declaredScenario",
      "declaredRunId",
      "declaredStep",
      "eventName",
      "versionPath",
    ].every((key) => manifest?.[key] === descriptor[key]) &&
    JSON.stringify(manifest?.expectedEventIdentity ?? null) ===
      JSON.stringify(descriptor.expectedEventIdentity ?? null)
  );
}

async function withRunManifestLock(output, descriptor, operation) {
  const directory = dirname(
    runManifestPath(
      output,
      descriptor.declaredRunId,
      descriptor.declaredStep,
      descriptor.eventName,
    ),
  );
  await assertPrivateDirectory(join(output, runsDirectoryName), { create: true });
  await assertPrivateDirectory(join(output, runsDirectoryName, descriptor.declaredRunId), {
    create: true,
  });
  await assertPrivateDirectory(directory, { create: true });
  const path = runManifestPath(
    output,
    descriptor.declaredRunId,
    descriptor.declaredStep,
    descriptor.eventName,
  );
  const lock = await acquireOwnedLock(`${path}${runManifestLockSuffix}`, {
    waitMs: 1_000,
    staleMs: 60_000,
  });
  if (!lock) throw new Error("Cursor evidence run manifest is busy");
  try {
    await securePrivateFile(lock.path);
    return await operation(path);
  } finally {
    await releaseOwnedLock(lock);
  }
}

async function readRunManifest(path, { allowMissing = false } = {}) {
  const info = await assertSafeRegularFile(path, { allowMissing, privateFile: true });
  if (info === null) return null;
  const manifest = JSON.parse(await readFile(path, "utf8"));
  if (
    manifest?.schemaVersion !== 1 ||
    !uuidPattern.test(manifest.manifestId ?? "") ||
    !uuidPattern.test(manifest.probeId ?? "") ||
    !surfaces.has(manifest.declaredSurface) ||
    !scenarios.has(manifest.declaredScenario) ||
    !uuidPattern.test(manifest.declaredRunId ?? "") ||
    !stepPattern.test(manifest.declaredStep ?? "") ||
    ![...eventNames, "stream-json", "local-jsonl"].includes(manifest.eventName) ||
    !["pending", "completed", "failed"].includes(manifest.status) ||
    !Number.isInteger(manifest.invocationCount) ||
    manifest.invocationCount < 0 ||
    !Array.isArray(manifest.observationIds) ||
    !Array.isArray(manifest.schemaSignatures) ||
    !Array.isArray(manifest.contracts) ||
    !["unbound", "pending", "matched", "mismatched", "not_applicable"].includes(
      manifest.identityBindingStatus,
    ) ||
    !(manifest.failureCode === null || manifestFailureCodes.has(manifest.failureCode)) ||
    !(
      manifest.expectedEventIdentity === null ||
      (["event_id", "request_id", "generation_id"].includes(manifest.expectedEventIdentity?.kind) &&
        schemaPathPattern.test(manifest.expectedEventIdentity?.path ?? "") &&
        /^evt1_[A-Za-z0-9_-]{43}$/.test(manifest.expectedEventIdentity?.hash ?? ""))
    ) ||
    !(
      manifest.versionPath === null ||
      /^\$\.(?:[A-Za-z_][A-Za-z0-9_]*|field1_[A-Za-z0-9_-]{22})$/.test(manifest.versionPath ?? "")
    )
  )
    throw new Error("Cursor evidence run manifest is invalid");
  return manifest;
}

async function initializeRunManifest(output, descriptor, { allowExistingPending = false } = {}) {
  return withRunManifestLock(output, descriptor, async (path) => {
    const existing = await readRunManifest(path, { allowMissing: true });
    if (existing === null) {
      const manifest = newRunManifest(descriptor);
      await atomicJson(path, manifest);
      return manifest;
    }
    if (
      allowExistingPending &&
      manifestDescriptorMatches(existing, descriptor) &&
      existing.status === "pending" &&
      existing.invocationCount === 0
    )
      return existing;
    const failed = {
      ...existing,
      status: "failed",
      completedAt: new Date().toISOString(),
      inputComplete: false,
      failureCode: "run_manifest_conflict",
      activeInvocationId: null,
    };
    await atomicJson(path, failed);
    throw new Error("Cursor evidence run manifest conflicts with an existing invocation");
  });
}

async function beginRunInvocation(output, descriptor) {
  return withRunManifestLock(output, descriptor, async (path) => {
    const manifest = await readRunManifest(path);
    if (
      !manifestDescriptorMatches(manifest, descriptor) ||
      manifest.status !== "pending" ||
      manifest.invocationCount !== 0
    ) {
      await atomicJson(path, {
        ...manifest,
        status: "failed",
        completedAt: new Date().toISOString(),
        invocationCount: (manifest.invocationCount ?? 0) + 1,
        inputComplete: false,
        failureCode: "unexpected_additional_invocation",
        activeInvocationId: null,
      });
      throw new Error("Cursor evidence run manifest permits exactly one invocation");
    }
    const invocationId = randomUUID();
    await atomicJson(path, {
      ...manifest,
      startedAt: new Date().toISOString(),
      invocationCount: 1,
      activeInvocationId: invocationId,
    });
    return invocationId;
  });
}

async function completeRunInvocation(
  output,
  descriptor,
  invocationId,
  observations,
  identityBindingStatus,
) {
  return withRunManifestLock(output, descriptor, async (path) => {
    const manifest = await readRunManifest(path);
    if (
      !manifestDescriptorMatches(manifest, descriptor) ||
      manifest.status !== "pending" ||
      manifest.activeInvocationId !== invocationId ||
      manifest.invocationCount !== 1
    )
      throw new Error("Cursor evidence run manifest changed during invocation");
    const observationIds = observations.map((entry) => entry.observationId);
    if (observationIds.length === 0 || new Set(observationIds).size !== observationIds.length)
      throw new Error("Cursor evidence invocation did not produce a unique observation set");
    const completed = {
      ...manifest,
      status: "completed",
      completedAt: new Date().toISOString(),
      inputComplete: true,
      failureCode: null,
      activeInvocationId: null,
      identityBindingStatus,
      observationIds,
      schemaSignatures: [...new Set(observations.map(schemaSignature))].sort(),
      contracts: [...new Set(observations.map(schemaSignature))].sort().map((signature) => ({
        schemaSignature: signature,
        observationIds: observations
          .filter((entry) => schemaSignature(entry) === signature)
          .map((entry) => entry.observationId)
          .sort(),
      })),
    };
    await atomicJson(path, completed);
    return completed;
  });
}

async function failRunInvocation(output, descriptor, failureCode) {
  if (!manifestFailureCodes.has(failureCode))
    throw new Error("Unknown Cursor evidence manifest failure code");
  return withRunManifestLock(output, descriptor, async (path) => {
    const manifest = await readRunManifest(path, { allowMissing: true });
    if (manifest === null) return null;
    const failed = {
      ...manifest,
      status: "failed",
      completedAt: new Date().toISOString(),
      inputComplete: false,
      failureCode,
      activeInvocationId: null,
    };
    await atomicJson(path, failed);
    return failed;
  });
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

function requireHookEvent(value) {
  if (!eventNames.includes(value)) throw new Error("Unknown Cursor hook event");
  return value;
}

function requireReconciliationIdentityKind(value) {
  if (!["event_id", "request_id", "generation_id"].includes(value))
    throw new Error(
      "Cursor evidence reconciliation identity must be event_id, request_id, or generation_id",
    );
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

function requireSchemaPath(value, label = "Cursor evidence schema path") {
  if (typeof value !== "string" || !schemaPathPattern.test(value))
    throw new Error(`${label} must be an exact canonical schema path`);
  return value;
}

function requireTopLevelSchemaPath(value, label = "Cursor version path") {
  const path = requireSchemaPath(value, label);
  if (!/^\$\.(?:[A-Za-z_][A-Za-z0-9_]*|field1_[A-Za-z0-9_-]{22})$/.test(path))
    throw new Error(`${label} must be an exact top-level schema path`);
  return path;
}

function selectedValues(value, validator = (entry) => entry) {
  if (value === undefined || value === null || value === "") return [];
  const values = Array.isArray(value) ? value : String(value).split(",");
  return [...new Set(values.map((entry) => validator(String(entry).trim())).filter(Boolean))];
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
  const invalidCounterCandidates = [];
  const identities = [];
  const accountCandidates = [];
  const timestamps = [];
  const invalidTimestampCandidates = [];
  const versionCandidates = [];
  const truncationReasons = new Set();
  const truncationCandidates = [];
  const markTruncation = (reason, path, contentDerived) => {
    truncationReasons.add(reason);
    if (
      !truncationCandidates.some(
        (candidate) =>
          candidate.reason === reason &&
          candidate.path === path &&
          candidate.contentDerived === contentDerived,
      )
    )
      truncationCandidates.push({ reason, path, contentDerived });
  };
  const approvedVersionPaths = new Set(
    selectedValues(context.approvedVersionPaths, (path) =>
      requireTopLevelSchemaPath(path, "Cursor approved version path"),
    ),
  );
  const cliVersion = normalizedVersion(context.cursorVersion);
  if (cliVersion !== null)
    versionCandidates.push({
      source: "cli",
      path: null,
      value: cliVersion,
      hash: hmacIdentity(context.hmacKey, "cursor-version:cli", cliVersion, "ver1"),
      contentDerived: false,
      trusted: true,
    });
  let status = null;
  const visit = (value, path = "$", depth = 0, insideContent = false) => {
    if (depth > 8) {
      markTruncation("depth_limit", path, insideContent);
      return;
    }
    if (schemaPaths.size >= 512) {
      if (!truncationCandidates.some(({ reason }) => reason === "schema_path_limit"))
        markTruncation("schema_path_limit", path, insideContent);
      return;
    }
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      schemaPaths.add(`${path}:array`);
      if (value.length > 16) markTruncation("array_item_limit", path, insideContent);
      for (const item of value.slice(0, 16)) visit(item, `${path}[]`, depth + 1, insideContent);
      return;
    }
    const entries = Object.entries(value).sort(([left], [right]) => {
      const priority = (key) =>
        contentBearingKeys.has(key) || key.toLowerCase().startsWith("tool")
          ? 2
          : evidencePriorityKeys.has(key)
            ? 0
            : 1;
      return priority(left) - priority(right);
    });
    if (entries.length > 256) markTruncation("object_key_limit", path, insideContent);
    for (const [key, child] of entries.slice(0, 256)) {
      if (schemaPaths.size >= 512) {
        if (!truncationCandidates.some(({ reason }) => reason === "schema_path_limit"))
          markTruncation("schema_path_limit", path, insideContent);
        break;
      }
      const childPath = `${path}.${schemaKey(key, context.hmacKey)}`;
      const contentDerived =
        insideContent || contentBearingKeys.has(key) || key.toLowerCase().startsWith("tool");
      schemaPaths.add(`${childPath}:${valueType(child)}`);
      if (counterNames.has(key)) {
        const counter = canonicalInteger(child);
        if (counter === null) invalidCounterCandidates.push({ path: childPath, contentDerived });
        else {
          const group = counterGroups.get(path) ?? { counters: {}, contentDerived };
          const canonical = counterNames.get(key);
          if (group.counters[canonical] !== undefined && group.counters[canonical] !== counter)
            invalidCounterCandidates.push({ path: childPath, contentDerived });
          else group.counters[canonical] = counter;
          group.contentDerived ||= contentDerived;
          counterGroups.set(path, group);
        }
      }
      if (identityNames.has(key)) {
        const canonicalField = identityNames.get(key);
        const hash = hmacIdentity(context.hmacKey, `cursor-event:${canonicalField}`, child, "evt1");
        if (hash !== null)
          identities.push({ field: canonicalField, path: childPath, hash, contentDerived });
      }
      if (accountIdentityNames.has(key) && typeof child === "string")
        accountCandidates.push({
          kind: accountIdentityNames.get(key),
          path: childPath,
          value: normalizedAccountValue(accountIdentityNames.get(key), child),
          contentDerived,
        });
      if (["timestamp", "created_at", "createdAt", "started_at", "startedAt"].includes(key)) {
        const timestamp = normalizedTimestamp(child);
        if (timestamp !== null)
          timestamps.push({ path: childPath, value: timestamp, contentDerived });
        else invalidTimestampCandidates.push({ path: childPath, contentDerived });
      }
      if (key === "cursor_version" || key === "cursorVersion") {
        const version = normalizedVersion(child);
        if (version !== null) {
          const trusted =
            !contentDerived &&
            approvedVersionPaths.has(childPath) &&
            /^\$\.[^.\[]+$/.test(childPath);
          versionCandidates.push({
            source: childPath,
            path: childPath,
            ...(trusted ? { value: version } : {}),
            hash: hmacIdentity(context.hmacKey, `cursor-version:${childPath}`, version, "ver1"),
            contentDerived,
            trusted,
          });
        }
      }
      if (
        !contentDerived &&
        path === "$" &&
        (key === "status" || key === "reason" || key === "subtype")
      )
        status ??= normalizedStatus(child);
      visit(child, childPath, depth + 1, contentDerived);
    }
  };
  visit(payload);
  const accountIdentityCandidates = [
    ...new Map(
      accountCandidates.map((candidate) => {
        const hash =
          candidate.value === null
            ? null
            : hmacIdentity(
                context.hmacKey,
                `cursor-account-alias:${candidate.kind}`,
                candidate.value,
                "acct1",
              );
        const key = `${candidate.kind}\0${candidate.path}\0${candidate.contentDerived}`;
        return [key, { ...candidate, value: undefined, hashes: hash === null ? [] : [hash] }];
      }),
    ),
  ].map(([, candidate]) => {
    delete candidate.value;
    return candidate;
  });
  const accountAmbiguous = [...new Set(accountIdentityCandidates.map(({ kind }) => kind))].some(
    (kind) =>
      new Set(
        accountIdentityCandidates
          .filter((candidate) => candidate.kind === kind)
          .flatMap(({ hashes }) => hashes),
      ).size !== 1,
  );
  const timestampCandidates = timestamps.filter(
    (candidate, index, values) =>
      values.findIndex(
        (other) =>
          other.path === candidate.path &&
          other.value === candidate.value &&
          other.contentDerived === candidate.contentDerived,
      ) === index,
  );
  const timestampAmbiguous = timestampCandidates.length > 1;
  const eventIdentities = identities.filter(
    (identity, index, values) =>
      values.findIndex(
        (candidate) =>
          candidate.field === identity.field &&
          candidate.path === identity.path &&
          candidate.hash === identity.hash &&
          candidate.contentDerived === identity.contentDerived,
      ) === index,
  );
  const tokenGroups = [...counterGroups.entries()]
    .map(([path, group]) => ({
      path,
      counters: group.counters,
      candidateRelationships: candidateRelationships(group.counters),
      contentDerived: group.contentDerived,
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
    cursorVersion:
      [
        ...new Set(
          versionCandidates.filter((candidate) => candidate.trusted).map(({ value }) => value),
        ),
      ].length === 1
        ? (versionCandidates.find((candidate) => candidate.trusted)?.value ?? null)
        : null,
    versionCandidates,
    status,
    timestampCandidates,
    timestampAmbiguous,
    providerTimestamp: timestampCandidates.length === 1 ? timestampCandidates[0].value : null,
    invalidTimestampCandidates,
    invalidTimestampPaths: [...new Set(invalidTimestampCandidates.map(({ path }) => path))].sort(),
    accountIdentityCandidates,
    accountAmbiguous,
    eventIdentities,
    tokenGroups,
    invalidCounterCandidates,
    invalidCounterPaths: [...new Set(invalidCounterCandidates.map(({ path }) => path))].sort(),
    schemaPaths: [...schemaPaths].sort(),
    truncated: truncationReasons.size > 0,
    truncationReasons: [...truncationReasons].sort(),
    truncationCandidates,
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
  return observation;
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

function deterministicInstallationId(value) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "8";
  const canonical = hex.join("");
  return `${canonical.slice(0, 8)}-${canonical.slice(8, 12)}-${canonical.slice(12, 16)}-${canonical.slice(16, 20)}-${canonical.slice(20)}`;
}

function hookBundleName(probeId, installationId) {
  return `${hookBundlePrefix}${probeId}-${installationId}`;
}

function hookCommandFor(probeId, installationId, platform = process.platform) {
  const bundle = hookBundleName(probeId, installationId);
  return platform === "win32"
    ? `.\\${bundle}\\scripts\\${hookLauncherCommandName}`
    : `./${bundle}/scripts/${hookLauncherScriptName}`;
}

function parseOwnedHookCommand(command, platform = process.platform) {
  if (typeof command !== "string") return null;
  const prefix = platform === "win32" ? ".\\" : "./";
  const suffix =
    platform === "win32"
      ? `\\scripts\\${hookLauncherCommandName}`
      : `/scripts/${hookLauncherScriptName}`;
  if (!command.startsWith(prefix) || !command.endsWith(suffix)) return null;
  const bundle = command.slice(prefix.length, -suffix.length);
  if (!bundle.startsWith(hookBundlePrefix)) return null;
  const identity = bundle.slice(hookBundlePrefix.length);
  if (identity.length !== 73 || identity[36] !== "-") return null;
  const probeId = identity.slice(0, 36);
  const installationId = identity.slice(37);
  return uuidPattern.test(probeId) && uuidPattern.test(installationId)
    ? { probeId: probeId.toLowerCase(), installationId: installationId.toLowerCase() }
    : null;
}

function isOwnedHook(entry, probeId, platform = process.platform) {
  const parsed = parseOwnedHookCommand(entry?.command, platform);
  return parsed?.probeId === probeId.toLowerCase();
}

function stripOwnedHookEntries(document, probeId) {
  if (document.hooks === undefined) return;
  for (const eventName of Object.keys(document.hooks)) {
    const entries = document.hooks[eventName];
    if (!Array.isArray(entries)) {
      if (eventNames.includes(eventName))
        throw new Error(`Cursor ${eventName} hooks must be an array`);
      continue;
    }
    const retained = entries.filter((entry) => !isOwnedHook(entry, probeId));
    if (retained.length === 0) delete document.hooks[eventName];
    else document.hooks[eventName] = retained;
  }
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

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeHooksDocuments(original, concurrent) {
  const merged = Object.create(null);
  for (const key of new Set([...Object.keys(original), ...Object.keys(concurrent)])) {
    if (key === "hooks") continue;
    if (!Object.hasOwn(original, key)) merged[key] = cloneJson(concurrent[key]);
    else if (!Object.hasOwn(concurrent, key)) merged[key] = cloneJson(original[key]);
    else if (JSON.stringify(original[key]) === JSON.stringify(concurrent[key]))
      merged[key] = cloneJson(concurrent[key]);
    else
      throw new Error(
        `Cursor hooks concurrent top-level field ${key} conflicts; both versions were preserved`,
      );
  }
  const originalHooks = Object.hasOwn(original, "hooks") ? original.hooks : Object.create(null);
  const concurrentHooks = Object.hasOwn(concurrent, "hooks")
    ? concurrent.hooks
    : Object.create(null);
  const hooks = Object.create(null);
  for (const eventName of new Set([
    ...Object.keys(originalHooks),
    ...Object.keys(concurrentHooks),
  ])) {
    const left = Object.hasOwn(originalHooks, eventName) ? originalHooks[eventName] : [];
    const right = Object.hasOwn(concurrentHooks, eventName) ? concurrentHooks[eventName] : [];
    if (!Array.isArray(left) || !Array.isArray(right))
      throw new Error(
        `Cursor hooks concurrent ${eventName} field is not mergeable; both versions were preserved`,
      );
    const seen = new Set();
    hooks[eventName] = [...left, ...right]
      .filter((entry) => {
        const serialized = JSON.stringify(entry);
        if (seen.has(serialized)) return false;
        seen.add(serialized);
        return true;
      })
      .map(cloneJson);
  }
  if (
    Object.keys(hooks).length > 0 ||
    Object.hasOwn(original, "hooks") ||
    Object.hasOwn(concurrent, "hooks")
  )
    merged.hooks = hooks;
  return validatedHooksDocument(merged);
}

async function readHooksJournalSnapshot(path) {
  const info = await assertSafeRegularFile(path, {
    allowMissing: true,
    allowMultipleLinks: true,
    privateFile: true,
  });
  if (info === null) return null;
  const contents = await readFile(path);
  const after = await lstat(path);
  if (info.dev !== after.dev || info.ino !== after.ino || info.size !== after.size)
    throw new Error(`Cursor hooks journal changed while it was read: ${path}`);
  const sha256 = createHash("sha256").update(contents).digest("hex");
  return {
    document: validatedHooksDocument(JSON.parse(contents.toString("utf8"))),
    sha256,
    fingerprint: {
      exists: true,
      dev: String(after.dev),
      ino: String(after.ino),
      size: after.size,
      mtimeMs: after.mtimeMs,
      sha256,
    },
  };
}

async function assertHooksJournalUnchanged(path, expected, context) {
  const actual = await readHooksJournalSnapshot(path);
  const unchanged =
    expected === null
      ? actual === null
      : actual !== null && sameFingerprint(expected.fingerprint, actual.fingerprint);
  if (!unchanged)
    throw new Error(
      `Cursor hooks changed during ${context}; all recoverable versions were preserved`,
    );
  return actual;
}

async function unlinkHooksJournalConditionally(
  journalPath,
  expected,
  checks,
  { kind, recoveryFaults = {} } = {},
) {
  await recoveryFaults.beforeJournalCleanup?.({ kind, path: journalPath });
  for (const [path, state] of checks)
    await assertHooksJournalUnchanged(path, state, `${kind} journal cleanup`);
  await assertHooksJournalUnchanged(journalPath, expected, `${kind} journal cleanup`);
  await unlink(journalPath);
}

async function restoreSingleHooksJournal(
  path,
  journalPath,
  expected,
  { kind, recoveryFaults = {} } = {},
) {
  await assertHooksJournalUnchanged(path, null, `${kind} journal restoration`);
  await assertHooksJournalUnchanged(journalPath, expected, `${kind} journal restoration`);
  await recoveryFaults.beforeSingleRestore?.({ kind, path, journalPath });
  try {
    await link(journalPath, path);
  } catch (error) {
    if (error?.code === "EEXIST")
      throw new Error(
        `Cursor hooks changed during ${kind} journal restoration; both versions were preserved at ${path} and ${journalPath}`,
        { cause: error },
      );
    throw error;
  }
  const published = await assertHooksJournalUnchanged(
    path,
    expected,
    `${kind} journal restoration`,
  );
  await unlinkHooksJournalConditionally(journalPath, expected, [[path, published]], {
    kind,
    recoveryFaults,
  });
}

function documentSubsumes(document, requiredDocuments) {
  try {
    let merged = requiredDocuments[0];
    for (const required of requiredDocuments.slice(1))
      merged = mergeHooksDocuments(merged, required);
    return JSON.stringify(mergeHooksDocuments(merged, document)) === JSON.stringify(document);
  } catch {
    return false;
  }
}

async function publishRecoveredHooks(
  path,
  recovery,
  reconcile,
  documents,
  {
    currentState = null,
    recoveryState = null,
    reconcileState = null,
    displaceCurrent = false,
    recoveryFaults = {},
  } = {},
) {
  let merged = documents[0];
  for (const document of documents.slice(1)) merged = mergeHooksDocuments(merged, document);
  const stage = await stageHooksDocument(path, merged);
  const stageState = await readHooksJournalSnapshot(stage);
  try {
    if (displaceCurrent) {
      for (const [candidatePath, state] of [
        [path, currentState],
        [recovery, recoveryState],
        [reconcile, null],
      ])
        await assertHooksJournalUnchanged(candidatePath, state, "recovery reconciliation");
      await recoveryFaults.beforeReconcileDisplace?.({ path, recovery, reconcile });
      await rename(path, reconcile);
      await recoveryFaults.afterReconcileRename?.();
      try {
        await assertHooksJournalUnchanged(
          reconcile,
          currentState,
          "recovery reconciliation displacement",
        );
      } catch (error) {
        await restoreDisplacedHooks(path, reconcile);
        throw error;
      }
      await assertHooksJournalUnchanged(path, null, "recovery reconciliation publication");
      await assertHooksJournalUnchanged(
        recovery,
        recoveryState,
        "recovery reconciliation publication",
      );
    } else {
      for (const [candidatePath, state] of [
        [path, null],
        [recovery, recoveryState],
        [reconcile, reconcileState],
      ])
        await assertHooksJournalUnchanged(candidatePath, state, "recovery publication");
    }
    try {
      await link(stage, path);
    } catch (error) {
      if (error?.code === "EEXIST")
        throw new Error(
          `Cursor hooks changed during recovery publication; all versions were preserved at ${path}, ${recovery}, and ${reconcile}`,
          { cause: error },
        );
      throw error;
    }
    const publishedState = await assertHooksJournalUnchanged(
      path,
      stageState,
      "recovery publication verification",
    );
    await recoveryFaults.afterMergedPublish?.();
    const expectedReconcile = displaceCurrent ? currentState : reconcileState;
    if (expectedReconcile !== null)
      await unlinkHooksJournalConditionally(
        reconcile,
        expectedReconcile,
        [
          [path, publishedState],
          [recovery, recoveryState],
        ],
        { kind: "reconcile", recoveryFaults },
      );
    await recoveryFaults.afterReconcileCleanup?.();
    if (recoveryState !== null)
      await unlinkHooksJournalConditionally(
        recovery,
        recoveryState,
        [
          [path, publishedState],
          [reconcile, null],
        ],
        { kind: "recovery", recoveryFaults },
      );
  } finally {
    await unlink(stage).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function recoverInterruptedHooksMutation(path, { recoveryFaults = {} } = {}) {
  const recovery = hooksMutationPath(path, "recovery");
  const reconcile = hooksMutationPath(path, "reconcile");
  const [currentState, recoveryState, reconcileState] = await Promise.all(
    [path, recovery, reconcile].map(readHooksJournalSnapshot),
  );
  const present = [currentState, recoveryState, reconcileState].map(Boolean);
  if (present.every((value) => !value) || (present[0] && !present[1] && !present[2])) return;
  if (!present[0] && present[1] && !present[2]) {
    await restoreSingleHooksJournal(path, recovery, recoveryState, {
      kind: "recovery",
      recoveryFaults,
    });
    return;
  }
  if (!present[0] && !present[1] && present[2]) {
    await restoreSingleHooksJournal(path, reconcile, reconcileState, {
      kind: "reconcile",
      recoveryFaults,
    });
    return;
  }
  if (present[0] && present[1] && !present[2]) {
    if (currentState.sha256 === recoveryState.sha256) {
      await unlinkHooksJournalConditionally(recovery, recoveryState, [[path, currentState]], {
        kind: "recovery",
        recoveryFaults,
      });
      return;
    }
    await publishRecoveredHooks(
      path,
      recovery,
      reconcile,
      [recoveryState.document, currentState.document],
      {
        currentState,
        recoveryState,
        displaceCurrent: true,
        recoveryFaults,
      },
    );
    return;
  }
  if (present[0] && !present[1] && present[2]) {
    if (
      currentState.sha256 === reconcileState.sha256 ||
      documentSubsumes(currentState.document, [reconcileState.document])
    ) {
      await unlinkHooksJournalConditionally(reconcile, reconcileState, [[path, currentState]], {
        kind: "reconcile",
        recoveryFaults,
      });
      return;
    }
    throw new Error(
      `Cursor hooks recovery is ambiguous; all versions were preserved at ${path} and ${reconcile}`,
    );
  }
  if (!present[0] && present[1] && present[2]) {
    await publishRecoveredHooks(
      path,
      recovery,
      reconcile,
      [recoveryState.document, reconcileState.document],
      { recoveryState, reconcileState, recoveryFaults },
    );
    return;
  }
  if (documentSubsumes(currentState.document, [recoveryState.document, reconcileState.document])) {
    await unlinkHooksJournalConditionally(
      reconcile,
      reconcileState,
      [
        [path, currentState],
        [recovery, recoveryState],
      ],
      { kind: "reconcile", recoveryFaults },
    );
    await recoveryFaults.afterReconcileCleanup?.();
    await unlinkHooksJournalConditionally(
      recovery,
      recoveryState,
      [
        [path, currentState],
        [reconcile, null],
      ],
      { kind: "recovery", recoveryFaults },
    );
    return;
  }
  throw new Error(
    `Cursor hooks recovery is ambiguous; all versions were preserved at ${path}, ${recovery}, and ${reconcile}`,
  );
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

async function mutateHooksWithCas(
  path,
  mutate,
  { beforeCompareAndSwap, afterDisplace, recoveryFaults } = {},
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await recoverInterruptedHooksMutation(path, { recoveryFaults });
    const { document, fingerprint } = await readHooksSnapshot(path);
    const changed = await mutate(document);
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

async function writeOwnedArtifact(path, contents, { executable = false } = {}) {
  const expected = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  const info = await assertSafeRegularFile(path, {
    allowMissing: true,
    maximumBytes: 2_000_000,
    privateFile: true,
  });
  if (info !== null) {
    const current = await readFile(path);
    if (!current.equals(expected))
      throw new Error(`Cursor probe-owned artifact changed unexpectedly: ${path}`);
  }
  await atomicBytes(path, expected, { executable });
}

function hookBundlePaths(parent, probeId, installationId) {
  const directory = parent;
  const root = join(directory, hookBundleName(probeId, installationId));
  const scripts = join(root, "scripts");
  const library = join(root, "packages", "connector", "lib");
  return {
    directory,
    root,
    scripts,
    library,
    launcher: join(scripts, hookLauncherScriptName),
    launcherState: join(scripts, hookLauncherStateName),
    command: join(scripts, hookLauncherCommandName),
    probeScript: join(scripts, "cursor-evidence-probe.mjs"),
    ownedLock: join(library, "owned-lock.mjs"),
    windowsSecurity: join(library, "windows-security.mjs"),
  };
}

async function ensurePrivateBundleDirectory(path, { create = false, shared = false } = {}) {
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
    throw new Error("Cursor hook runtime directory must be a current-user real directory");
  if (process.platform === "win32") {
    if (shared) {
      if (!inspectCurrentUserWindowsDirectory(path))
        throw new Error("Cursor shared hook directory owner is unsafe");
    } else if (created) await ensurePrivateStateDirectory(path);
    else if (!inspectCurrentUserWindowsDirectory(path, { privateDirectory: true }))
      throw new Error("Cursor hook runtime directory has an unsafe Windows ACL");
  } else if ((info.mode & 0o077) !== 0)
    throw new Error("Cursor hook runtime directory must be owner-only");
}

async function runtimeArtifact(path, contents) {
  return {
    path,
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
}

async function installHookBundle(parent, identity) {
  const installationId = deterministicInstallationId(
    [
      identity.probeId,
      identity.outputDirectory,
      identity.declaredSurface,
      identity.declaredScenario,
      identity.declaredRunId,
      identity.declaredStep,
      identity.declaredEvent,
      JSON.stringify(identity.expectedEventIdentity),
      identity.versionPath ?? "",
    ].join("\0"),
  );
  const paths = hookBundlePaths(parent, identity.probeId, installationId);
  await ensurePrivateBundleDirectory(paths.directory, { create: true, shared: true });
  for (const directory of [paths.root, paths.scripts, paths.library])
    await ensurePrivateBundleDirectory(directory, { create: true });
  const sources = new Map([
    [paths.launcher, await readFile(hookLauncherSourcePath)],
    [paths.probeScript, await readFile(scriptPath)],
    [paths.ownedLock, await readFile(ownedLockSourcePath)],
    [paths.windowsSecurity, await readFile(windowsSecuritySourcePath)],
  ]);
  if (process.platform === "win32")
    sources.set(paths.command, Buffer.from(windowsLauncherContents()));
  for (const [path, contents] of sources)
    await writeOwnedArtifact(path, contents, {
      executable: path === paths.launcher || path === paths.probeScript || path === paths.command,
    });
  const runtimeArtifacts = await Promise.all(
    [...sources].map(([path, contents]) => runtimeArtifact(path, contents)),
  );
  const configuration = {
    schemaVersion: 2,
    ...identity,
    installationId,
    probeScriptPath: paths.probeScript,
    runtimeArtifacts,
  };
  await writeOwnedArtifact(paths.launcherState, `${JSON.stringify(configuration, null, 2)}\n`);
  return {
    ...paths,
    configuration,
    installationId,
    hookCommand: hookCommandFor(identity.probeId, installationId),
  };
}

async function validateHookBundle(parent, probeId, installationId, expectedOutputDirectory = null) {
  const paths = hookBundlePaths(parent, probeId, installationId);
  await ensurePrivateBundleDirectory(paths.directory, { shared: true });
  for (const directory of [paths.root, paths.scripts, paths.library])
    await ensurePrivateBundleDirectory(directory);
  await assertSafeRegularFile(paths.launcherState, { privateFile: true });
  const configuration = JSON.parse(await readFile(paths.launcherState, "utf8"));
  const expectedInstallationId = deterministicInstallationId(
    [
      configuration?.probeId,
      configuration?.outputDirectory,
      configuration?.declaredSurface,
      configuration?.declaredScenario,
      configuration?.declaredRunId,
      configuration?.declaredStep,
      configuration?.declaredEvent,
      JSON.stringify(configuration?.expectedEventIdentity),
      configuration?.versionPath ?? "",
    ].join("\0"),
  );
  if (
    configuration?.schemaVersion !== 2 ||
    configuration.probeId !== probeId ||
    configuration.installationId !== installationId ||
    typeof configuration.outputDirectory !== "string" ||
    !isAbsolute(configuration.outputDirectory) ||
    (expectedOutputDirectory !== null &&
      configuration.outputDirectory !== expectedOutputDirectory) ||
    !surfaces.has(configuration.declaredSurface) ||
    !scenarios.has(configuration.declaredScenario) ||
    !uuidPattern.test(configuration.declaredRunId ?? "") ||
    !stepPattern.test(configuration.declaredStep ?? "") ||
    !(
      configuration.expectedEventIdentity === null ||
      (configuration.expectedEventIdentity?.kind !== undefined &&
        ["event_id", "request_id", "generation_id"].includes(
          configuration.expectedEventIdentity.kind,
        ) &&
        schemaPathPattern.test(configuration.expectedEventIdentity.path ?? "") &&
        /^evt1_[A-Za-z0-9_-]{43}$/.test(configuration.expectedEventIdentity.hash ?? ""))
    ) ||
    !(
      configuration.versionPath === null ||
      /^\$\.(?:[A-Za-z_][A-Za-z0-9_]*|field1_[A-Za-z0-9_-]{22})$/.test(
        configuration.versionPath ?? "",
      )
    ) ||
    configuration.installationId !== expectedInstallationId ||
    configuration.probeScriptPath !== paths.probeScript ||
    !eventNames.includes(configuration.declaredEvent) ||
    !Array.isArray(configuration.runtimeArtifacts)
  )
    throw new Error("Cursor evidence hook runtime ownership state is invalid");
  const expectedArtifacts = new Set([
    paths.launcher,
    paths.probeScript,
    paths.ownedLock,
    paths.windowsSecurity,
    ...(process.platform === "win32" ? [paths.command] : []),
  ]);
  if (
    configuration.runtimeArtifacts.length !== expectedArtifacts.size ||
    new Set(configuration.runtimeArtifacts.map((artifact) => artifact?.path)).size !==
      expectedArtifacts.size ||
    configuration.runtimeArtifacts.some(
      (artifact) =>
        !expectedArtifacts.has(artifact?.path) || !/^[0-9a-f]{64}$/.test(artifact.sha256),
    )
  )
    throw new Error("Cursor evidence hook runtime manifest is invalid");
  for (const artifact of configuration.runtimeArtifacts) {
    await assertSafeRegularFile(artifact.path, {
      maximumBytes: 2_000_000,
      privateFile: true,
    });
    const digest = createHash("sha256")
      .update(await readFile(artifact.path))
      .digest("hex");
    if (digest !== artifact.sha256)
      throw new Error("Cursor evidence hook runtime changed; artifacts were preserved");
  }
  const expectedEntries = new Map([
    [paths.root, ["packages", "scripts"]],
    [join(paths.root, "packages"), ["connector"]],
    [join(paths.root, "packages", "connector"), ["lib"]],
    [paths.library, ["owned-lock.mjs", "windows-security.mjs"]],
    [
      paths.scripts,
      [
        "cursor-evidence-probe.mjs",
        hookLauncherScriptName,
        hookLauncherStateName,
        ...(process.platform === "win32" ? [hookLauncherCommandName] : []),
      ],
    ],
  ]);
  for (const [directory, expected] of expectedEntries) {
    const actual = (await readdir(directory)).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...expected].sort()))
      throw new Error("Cursor evidence hook runtime contains unexpected artifacts");
  }
  return { paths, configuration, hookCommand: hookCommandFor(probeId, installationId) };
}

async function removeHookBundle(bundle) {
  const { paths, configuration } = bundle;
  for (const artifact of configuration.runtimeArtifacts) await unlink(artifact.path);
  await unlink(paths.launcherState);
  for (const directory of [
    paths.scripts,
    paths.library,
    join(paths.root, "packages", "connector"),
    join(paths.root, "packages"),
    paths.root,
  ])
    await rmdir(directory);
}

async function validateOwnedHookEntries(document, parent, probeId, expectedOutputDirectory) {
  const installations = new Map();
  for (const entries of Object.values(document.hooks ?? {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const parsed = parseOwnedHookCommand(entry?.command);
      if (parsed?.probeId !== probeId) continue;
      if (!installations.has(parsed.installationId))
        installations.set(
          parsed.installationId,
          await validateHookBundle(parent, probeId, parsed.installationId, expectedOutputDirectory),
        );
    }
  }
  return installations;
}

async function discoverProbeBundles(parent, probeId, expectedOutputDirectory) {
  const directory = parent;
  await ensurePrivateBundleDirectory(directory, { shared: true });
  const bundles = new Map();
  const prefix = `${hookBundlePrefix}${probeId}-`;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.name.startsWith(prefix)) continue;
    const installationId = entry.name.slice(prefix.length);
    if (!entry.isDirectory() || !uuidPattern.test(installationId))
      throw new Error("Cursor evidence hook runtime has an invalid owned bundle name");
    bundles.set(
      installationId,
      await validateHookBundle(
        parent,
        probeId,
        installationId.toLowerCase(),
        expectedOutputDirectory,
      ),
    );
  }
  return bundles;
}

async function installHookLauncher(parent, configuration) {
  const directory = parent;
  await ensurePrivateBundleDirectory(directory, { create: true, shared: true });
  return installHookBundle(parent, configuration);
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
  event = "stop",
  hooksFile,
  expectedEventIdentity = null,
  versionPath = null,
  beforeCompareAndSwap,
  afterDisplace,
  recoveryFaults,
}) {
  const { output, state } = await readProbeState(outputDirectory, { create: true });
  const declaredSurface = requireSurface(surface);
  const declaredScenario = requireScenario(scenario);
  const declaredRunId = requireRunId(runId);
  const declaredStep = requireStep(step);
  const declaredEvent = requireHookEvent(event);
  let expectedIdentity = null;
  if (expectedEventIdentity !== null) {
    const kind = requireReconciliationIdentityKind(expectedEventIdentity.kind);
    const identityPath = requireSchemaPath(
      expectedEventIdentity.path,
      "Cursor expected event identity path",
    );
    const hash = hmacIdentity(
      state.hmacKey,
      `cursor-event:${kind}`,
      expectedEventIdentity.value,
      "evt1",
    );
    if (hash === null) throw new Error("Cursor expected event identity value is invalid");
    expectedIdentity = { kind, path: identityPath, hash };
  }
  const approvedVersionPath =
    versionPath === null || versionPath === undefined
      ? null
      : requireTopLevelSchemaPath(versionPath);
  const descriptor = manifestDescriptor({
    probeId: state.probeId,
    surface: declaredSurface,
    scenario: declaredScenario,
    runId: declaredRunId,
    step: declaredStep,
    eventName: declaredEvent,
    expectedEventIdentity: expectedIdentity,
    versionPath: approvedVersionPath,
  });
  await initializeRunManifest(output, descriptor, { allowExistingPending: true });
  const path = resolve(hooksFile ?? join(homedir(), ".cursor", "hooks.json"));
  const parent = dirname(path);
  try {
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const parentInfo = await lstat(parent);
    if (
      !parentInfo.isDirectory() ||
      parentInfo.isSymbolicLink() ||
      (typeof process.getuid === "function" && parentInfo.uid !== process.getuid())
    )
      throw new Error("Cursor hooks directory must be a current-user real directory");
    if (process.platform === "win32" && !inspectCurrentUserWindowsDirectory(parent))
      throw new Error("Cursor hooks directory owner is unsafe");
    return await withHooksLock(parent, async () => {
      const bundle = await installHookLauncher(parent, {
        probeId: state.probeId,
        outputDirectory: output,
        declaredSurface,
        declaredScenario,
        declaredRunId,
        declaredStep,
        declaredEvent,
        expectedEventIdentity: expectedIdentity,
        versionPath: approvedVersionPath,
      });
      const changed = await mutateHooksWithCas(
        path,
        async (document) => {
          await validateOwnedHookEntries(document, parent, state.probeId, output);
          const before = JSON.stringify(document);
          document.version ??= 1;
          document.hooks ??= {};
          stripOwnedHookEntries(document, state.probeId);
          const selectedEntries = document.hooks[declaredEvent] ?? [];
          if (!Array.isArray(selectedEntries))
            throw new Error(`Cursor ${declaredEvent} hooks must be an array`);
          document.hooks[declaredEvent] = [...selectedEntries, { command: bundle.hookCommand }];
          return JSON.stringify(document) !== before;
        },
        { beforeCompareAndSwap, afterDisplace, recoveryFaults },
      );
      return {
        changed,
        probeId: state.probeId,
        installationId: bundle.installationId,
        hooks: [declaredEvent],
        command: bundle.hookCommand,
      };
    });
  } catch (error) {
    await failRunInvocation(output, descriptor, "hook_install_failure").catch(() => {});
    throw error;
  }
}

export async function removeProbeHooks({ outputDirectory, hooksFile }) {
  const { output, state } = await readProbeState(outputDirectory);
  const path = resolve(hooksFile ?? join(homedir(), ".cursor", "hooks.json"));
  const parent = dirname(path);
  return withHooksLock(parent, async () => {
    const bundles = await discoverProbeBundles(parent, state.probeId, output);
    const changed = await mutateHooksWithCas(path, async (document) => {
      const active = await validateOwnedHookEntries(document, parent, state.probeId, output);
      for (const [installationId, bundle] of active) bundles.set(installationId, bundle);
      const before = JSON.stringify(document);
      stripOwnedHookEntries(document, state.probeId);
      return JSON.stringify(document) !== before;
    });
    for (const bundle of bundles.values()) await removeHookBundle(bundle);
    return { changed, artifactsRemoved: bundles.size > 0 };
  });
}

export async function captureCursorHook(
  configuration,
  input = process.stdin,
  outputStream = process.stdout,
) {
  const { output, state } = await readProbeState(configuration.outputDirectory);
  if (configuration.probeId !== state.probeId) throw new Error("Stale Cursor evidence hook");
  const descriptor = manifestDescriptor({
    probeId: state.probeId,
    surface: configuration.declaredSurface,
    scenario: configuration.declaredScenario,
    runId: configuration.declaredRunId,
    step: configuration.declaredStep,
    eventName: configuration.declaredEvent,
    expectedEventIdentity: configuration.expectedEventIdentity ?? null,
    versionPath: configuration.versionPath ?? null,
  });
  let invocationId;
  try {
    invocationId = await beginRunInvocation(output, descriptor);
    const payload = await readBoundedJson(input);
    const eventName = requireEvent(payload?.hook_event_name);
    if (eventName !== configuration.declaredEvent)
      throw new Error("Cursor evidence hook event does not match its immutable installation");
    const observation = sanitizeCursorObservation(payload, {
      surface: configuration.declaredSurface,
      scenario: configuration.declaredScenario,
      runId: configuration.declaredRunId,
      step: configuration.declaredStep,
      eventName,
      hmacKey: state.hmacKey,
      approvedVersionPaths: configuration.versionPath === null ? [] : [configuration.versionPath],
    });
    const expected = configuration.expectedEventIdentity ?? null;
    const identityBindingStatus =
      expected === null
        ? "unbound"
        : observation.eventIdentities.filter(
              (candidate) =>
                !candidate.contentDerived &&
                candidate.field === expected.kind &&
                candidate.path === expected.path &&
                candidate.hash === expected.hash,
            ).length === 1
          ? "matched"
          : "mismatched";
    if (identityBindingStatus === "mismatched") {
      await failRunInvocation(output, descriptor, "event_identity_mismatch");
      throw new Error("Cursor evidence hook identity does not match its immutable installation");
    }
    await saveObservation(output, observation);
    await completeRunInvocation(
      output,
      descriptor,
      invocationId,
      [observation],
      identityBindingStatus,
    );
    outputStream.write("{}\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const failureCode = message.includes("byte limit")
      ? "input_byte_limit"
      : message.includes("observation limit")
        ? "observation_limit"
        : message.includes("identity")
          ? "event_identity_mismatch"
          : "hook_capture_failure";
    await failRunInvocation(output, descriptor, failureCode).catch(() => {});
    throw error;
  }
}

export async function markHookInvocationFailure(configuration) {
  const { output, state } = await readProbeState(configuration.outputDirectory);
  if (configuration.probeId !== state.probeId) return;
  const descriptor = manifestDescriptor({
    probeId: state.probeId,
    surface: configuration.declaredSurface,
    scenario: configuration.declaredScenario,
    runId: configuration.declaredRunId,
    step: configuration.declaredStep,
    eventName: configuration.declaredEvent,
    expectedEventIdentity: configuration.expectedEventIdentity ?? null,
    versionPath: configuration.versionPath ?? null,
  });
  await failRunInvocation(output, descriptor, "hook_capture_failure");
}

export async function inspectJsonl(options) {
  const { output, state } = await readProbeState(options["output-dir"], { create: true });
  const surface = requireSurface(options.surface);
  const scenario = requireScenario(options.scenario);
  const runId = requireRunId(options["run-id"]);
  const step = requireStep(options.step);
  const versionPath =
    options["version-path"] === undefined
      ? null
      : requireTopLevelSchemaPath(options["version-path"]);
  const descriptor = manifestDescriptor({
    probeId: state.probeId,
    surface,
    scenario,
    runId,
    step,
    eventName: "local-jsonl",
    versionPath,
  });
  await initializeRunManifest(output, descriptor);
  const invocationId = await beginRunInvocation(output, descriptor);
  let handle;
  let pending = "";
  const observations = [];
  try {
    const input = resolve(options.input ?? "");
    if (!isAbsolute(options.input ?? ""))
      throw new Error("Cursor JSONL input path must be absolute");
    const info = await assertSafeRegularFile(input, {
      maximumBytes: maximumFileBytes,
      privateFile: true,
    });
    if (info.size > maximumFileBytes) throw new Error("Cursor JSONL input exceeded the byte limit");
    handle = await open(input, "r");
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
        const observation = sanitizeCursorObservation(payload, {
          surface,
          scenario,
          runId,
          step,
          eventName: "local-jsonl",
          hmacKey: state.hmacKey,
          approvedVersionPaths: versionPath === null ? [] : [versionPath],
        });
        await saveObservation(output, observation);
        observations.push(observation);
        if (observations.length >= maximumObservations)
          throw new Error("Cursor evidence observation limit reached");
      }
    }
    if (pending.trim()) throw new Error("Cursor JSONL input has an unterminated record");
    await completeRunInvocation(output, descriptor, invocationId, observations, "not_applicable");
    return { observations: observations.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const failureCode = message.includes("unterminated")
      ? "unterminated_record"
      : message.includes("record exceeded")
        ? "record_byte_limit"
        : message.includes("input exceeded")
          ? "input_byte_limit"
          : message.includes("observation limit")
            ? "observation_limit"
            : error instanceof SyntaxError
              ? "malformed_json"
              : "input_read_failure";
    await failRunInvocation(output, descriptor, failureCode).catch(() => {});
    throw error;
  } finally {
    await handle?.close();
  }
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
  const declaredScenario = requireScenario(scenario);
  const declaredRunId = requireRunId(runId);
  const declaredStep = requireStep(step);
  const descriptor = manifestDescriptor({
    probeId: state.probeId,
    surface: "cli-headless",
    scenario: declaredScenario,
    runId: declaredRunId,
    step: declaredStep,
    eventName: "stream-json",
  });
  await initializeRunManifest(output, descriptor);
  const invocationId = await beginRunInvocation(output, descriptor);
  try {
    if (!isAbsolute(executable ?? "")) throw new Error("Cursor agent path must be absolute");
    await assertSafeRegularFile(resolve(executable), { maximumBytes: Number.MAX_SAFE_INTEGER });
  } catch (error) {
    await failRunInvocation(output, descriptor, "stream_processing_failure").catch(() => {});
    throw error;
  }
  let cursorVersion;
  let arguments_;
  let child;
  try {
    if (!Number.isInteger(maximumObservationCount) || maximumObservationCount < 1)
      throw new Error("Cursor evidence observation limit must be a positive integer");
    const version = spawnSyncImplementation(executable, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    cursorVersion = normalizedVersion(version.stdout?.trim()) ?? null;
    arguments_ = [...passthrough];
    if (!arguments_.includes("--print") && !arguments_.includes("-p"))
      arguments_.unshift("--print");
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
    child = spawnImplementation(executable, arguments_, { stdio: ["inherit", "pipe", "pipe"] });
  } catch (error) {
    await failRunInvocation(output, descriptor, "stream_processing_failure").catch(() => {});
    throw error;
  }
  child.stderr.pipe(errorStream);
  child.stdout.setEncoding("utf8");
  let pending = "";
  let observations = 0;
  const savedObservations = [];
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
    const observation = sanitizeCursorObservation(payload, context);
    await saveObservationImplementation(output, observation);
    savedObservations.push(observation);
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
    if (invalidReason !== null || observations === 0) {
      const observation = invalidStreamObservation(context, invalidReason ?? "empty_stream");
      await saveObservationImplementation(output, observation);
      savedObservations.push(observation);
    }
    const result = await closed;
    if (invalidReason !== null || observations === 0)
      await failRunInvocation(output, descriptor, "stream_invalid");
    else if (result.signal !== null)
      await failRunInvocation(output, descriptor, "child_signal_failure");
    else if (result.code !== 0) await failRunInvocation(output, descriptor, "child_exit_failure");
    else
      await completeRunInvocation(
        output,
        descriptor,
        invocationId,
        savedObservations,
        "not_applicable",
      );
    return result;
  } catch (error) {
    await terminateAndAwaitClose();
    await failRunInvocation(output, descriptor, "stream_processing_failure").catch(() => {});
    throw error;
  } finally {
    for (const [signal, handler] of signalHandlers) signalSource.removeListener(signal, handler);
  }
}

async function loadRunManifests(output) {
  const root = join(output, runsDirectoryName);
  const runEntries = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const manifests = [];
  for (const runEntry of runEntries) {
    if (!runEntry.isDirectory() || !uuidPattern.test(runEntry.name)) continue;
    const runDirectory = join(root, runEntry.name);
    await assertPrivateDirectory(runDirectory);
    for (const stepEntry of await readdir(runDirectory, { withFileTypes: true })) {
      if (!stepEntry.isDirectory() || !stepPattern.test(stepEntry.name)) continue;
      const stepDirectory = join(runDirectory, stepEntry.name);
      await assertPrivateDirectory(stepDirectory);
      for (const file of await readdir(stepDirectory, { withFileTypes: true })) {
        if (
          !file.isFile() ||
          !/^(?:afterAgentResponse|stop|sessionEnd|stream-json|local-jsonl)\.json$/.test(file.name)
        )
          continue;
        manifests.push(await readRunManifest(join(stepDirectory, file.name)));
      }
    }
  }
  return manifests;
}

function manifestQualifiedObservationIds(manifests, observations, probeId) {
  const qualified = new Set();
  let invalid = 0;
  let failed = 0;
  let pending = 0;
  for (const manifest of manifests) {
    if (manifest.status === "failed") failed += 1;
    if (manifest.status === "pending") pending += 1;
    const matching = observations.filter(
      (entry) =>
        entry.declaredRunId === manifest.declaredRunId &&
        entry.declaredStep === manifest.declaredStep &&
        entry.eventName === manifest.eventName,
    );
    const actualIds = matching.map(({ observationId }) => observationId).sort();
    const declaredIds = [...manifest.observationIds].sort();
    const actualSignatures = [...new Set(matching.map(schemaSignature))].sort();
    const actualContracts = actualSignatures.map((signature) => ({
      schemaSignature: signature,
      observationIds: matching
        .filter((entry) => schemaSignature(entry) === signature)
        .map(({ observationId }) => observationId)
        .sort(),
    }));
    const declaredContracts = manifest.contracts
      .map((contract) => ({
        schemaSignature: contract?.schemaSignature,
        observationIds: Array.isArray(contract?.observationIds)
          ? [...contract.observationIds].sort()
          : null,
      }))
      .sort((left, right) =>
        String(left.schemaSignature).localeCompare(String(right.schemaSignature)),
      );
    const hookBindingValid = eventNames.includes(manifest.eventName)
      ? manifest.identityBindingStatus === "matched" &&
        manifest.expectedEventIdentity !== null &&
        declaredIds.length === 1 &&
        matching.every(
          (entry) =>
            (entry.eventIdentities ?? []).filter(
              (identity) =>
                !identity.contentDerived &&
                identity.field === manifest.expectedEventIdentity.kind &&
                identity.path === manifest.expectedEventIdentity.path &&
                identity.hash === manifest.expectedEventIdentity.hash,
            ).length === 1,
        )
      : manifest.identityBindingStatus === "not_applicable";
    const valid =
      manifest.probeId === probeId &&
      manifest.status === "completed" &&
      manifest.inputComplete === true &&
      manifest.invocationCount === 1 &&
      manifest.failureCode === null &&
      hookBindingValid &&
      declaredIds.length > 0 &&
      new Set(declaredIds).size === declaredIds.length &&
      JSON.stringify(declaredIds) === JSON.stringify(actualIds) &&
      JSON.stringify([...manifest.schemaSignatures].sort()) === JSON.stringify(actualSignatures) &&
      JSON.stringify(declaredContracts) === JSON.stringify(actualContracts) &&
      matching.every(
        (entry) =>
          entry.declaredSurface === manifest.declaredSurface &&
          entry.declaredScenario === manifest.declaredScenario,
      );
    if (!valid) {
      invalid += 1;
      continue;
    }
    for (const id of declaredIds) qualified.add(id);
  }
  const unmanifested = observations.filter((entry) => !qualified.has(entry.observationId)).length;
  return { qualified, invalid, failed, pending, unmanifested };
}

function qualifyObservation(entry, selections) {
  const tokenGroups = (entry.tokenGroups ?? []).filter(
    (group) => !group.contentDerived && selections.counterPaths.has(group.path),
  );
  const accountIdentityCandidates = (entry.accountIdentityCandidates ?? []).filter(
    (candidate) => !candidate.contentDerived && selections.accountPaths.has(candidate.path),
  );
  const eventIdentities = (entry.eventIdentities ?? []).filter(
    (candidate) => !candidate.contentDerived && selections.eventIdPaths.has(candidate.path),
  );
  const timestampCandidates = (entry.timestampCandidates ?? []).filter(
    (candidate) => !candidate.contentDerived && selections.timestampPaths.has(candidate.path),
  );
  const versionCandidates = (entry.versionCandidates ?? []).filter(
    (candidate) =>
      candidate.trusted &&
      !candidate.contentDerived &&
      selections.versionSources.has(candidate.source),
  );
  const invalidCounterPaths = (entry.invalidCounterCandidates ?? [])
    .filter(
      (candidate) =>
        !candidate.contentDerived &&
        selections.counterPaths.has(candidate.path.slice(0, candidate.path.lastIndexOf("."))),
    )
    .map(({ path }) => path);
  const invalidTimestampPaths = (entry.invalidTimestampCandidates ?? [])
    .filter(
      (candidate) => !candidate.contentDerived && selections.timestampPaths.has(candidate.path),
    )
    .map(({ path }) => path);
  const accountAmbiguous = [...new Set(accountIdentityCandidates.map(({ kind }) => kind))].some(
    (kind) =>
      new Set(
        accountIdentityCandidates
          .filter((candidate) => candidate.kind === kind)
          .flatMap(({ hashes }) => hashes ?? []),
      ).size !== 1,
  );
  const versionValues = [...new Set(versionCandidates.map(({ value }) => value).filter(Boolean))];
  const selectedPaths = [
    ...selections.counterPaths,
    ...selections.accountPaths,
    ...selections.eventIdPaths,
    ...selections.timestampPaths,
    ...[...selections.versionSources].filter((source) => source !== "cli"),
  ];
  const truncationCandidates =
    entry.truncationCandidates ??
    (entry.truncationReasons ?? []).map((reason) => ({
      reason,
      path: "$",
      contentDerived: false,
    }));
  const truncationAffectsSelectedPath = truncationCandidates.some(
    (candidate) =>
      !candidate.contentDerived &&
      selectedPaths.some(
        (path) =>
          path === candidate.path ||
          path.startsWith(`${candidate.path}.`) ||
          path.startsWith(`${candidate.path}[]`),
      ),
  );
  return {
    ...entry,
    sourceTruncated: entry.truncated,
    truncated: entry.truncated && truncationAffectsSelectedPath,
    truncationIgnoredForExactPaths: entry.truncated && !truncationAffectsSelectedPath,
    tokenGroups,
    accountIdentityCandidates,
    accountAmbiguous,
    eventIdentities,
    timestampCandidates,
    timestampAmbiguous: timestampCandidates.length > 1,
    providerTimestamp: timestampCandidates.length === 1 ? timestampCandidates[0].value : null,
    invalidCounterPaths,
    invalidTimestampPaths,
    versionCandidates,
    cursorVersion: versionValues.length === 1 ? versionValues[0] : null,
  };
}

function accountGraph(observations) {
  const parent = new Map();
  const emailsByAccountId = new Map();
  const accountIdsByEmail = new Map();
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
    const accountIds = nodes.filter((node) => node.startsWith("account_id:"));
    const emails = nodes.filter((node) => node.startsWith("user_email:"));
    for (const accountId of accountIds) {
      const aliases = emailsByAccountId.get(accountId) ?? new Set();
      for (const email of emails) aliases.add(email);
      emailsByAccountId.set(accountId, aliases);
    }
    for (const email of emails) {
      const aliases = accountIdsByEmail.get(email) ?? new Set();
      for (const accountId of accountIds) aliases.add(accountId);
      accountIdsByEmail.set(email, aliases);
    }
    for (const node of nodes) find(node);
    for (const node of nodes.slice(1)) union(nodes[0], node);
  }
  const aliasConflicts = new Set([
    ...[...emailsByAccountId].filter(([, aliases]) => aliases.size > 1).map(([node]) => node),
    ...[...accountIdsByEmail].filter(([, aliases]) => aliases.size > 1).map(([node]) => node),
  ]);
  return {
    component(entry) {
      const roots = [...new Set(nodesFor(entry).map(find))];
      return roots.length === 1 ? roots[0] : null;
    },
    count: new Set([...parent.keys()].map(find)).size,
    aliasConflict: aliasConflicts.size > 0,
    aliasConflictCount: aliasConflicts.size,
  };
}

export function schemaSignature(entry) {
  return `schema1_${createHash("sha256")
    .update(JSON.stringify(entry.schemaPaths ?? []))
    .digest("base64url")
    .slice(0, 22)}`;
}

function observationContract(entry) {
  return `${entry.eventName}:${schemaSignature(entry)}`;
}

function groupByRun(observations, scenario) {
  const grouped = new Map();
  for (const entry of observations.filter((candidate) => candidate.declaredScenario === scenario)) {
    const key = `${entry.declaredRunId}\0${observationContract(entry)}`;
    const run = grouped.get(key) ?? [];
    run.push(entry);
    grouped.set(key, run);
  }
  return [...grouped.values()];
}

export async function buildEvidenceReport(
  outputDirectory,
  {
    maximumObservationCount = maximumObservations,
    eventIdentityKind,
    counterPaths,
    accountPaths,
    eventIdPaths,
    timestampPaths,
    versionSources,
  } = {},
) {
  if (!Number.isInteger(maximumObservationCount) || maximumObservationCount < 1)
    throw new Error("Cursor evidence report observation limit must be a positive integer");
  const selectedEventIdentityKind =
    eventIdentityKind === undefined ? null : requireReconciliationIdentityKind(eventIdentityKind);
  const selections = {
    counterPaths: new Set(selectedValues(counterPaths, (path) => requireSchemaPath(path))),
    accountPaths: new Set(selectedValues(accountPaths, (path) => requireSchemaPath(path))),
    eventIdPaths: new Set(selectedValues(eventIdPaths, (path) => requireSchemaPath(path))),
    timestampPaths: new Set(selectedValues(timestampPaths, (path) => requireSchemaPath(path))),
    versionSources: new Set(
      selectedValues(versionSources, (source) =>
        source === "cli" ? source : requireTopLevelSchemaPath(source, "Cursor version source"),
      ),
    ),
  };
  const { output, state } = await readProbeState(outputDirectory);
  const directory = join(output, observationsDirectoryName);
  const names = (
    await readdir(directory).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    })
  )
    .filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name))
    .sort();
  const allObservations = [];
  const observationSetTruncated = observationCapacityReached(names.length, maximumObservationCount);
  for (const name of names.slice(0, maximumObservationCount)) {
    const path = join(directory, name);
    await assertSafeRegularFile(path, { privateFile: true });
    allObservations.push(JSON.parse(await readFile(path, "utf8")));
  }
  const manifests = await loadRunManifests(output);
  const manifestState = manifestQualifiedObservationIds(manifests, allObservations, state.probeId);
  const observations = allObservations
    .filter((entry) => manifestState.qualified.has(entry.observationId))
    .map((entry) => qualifyObservation(entry, selections));
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
  const nonParsedObservations = observations.filter((entry) => entry.parseStatus !== "parsed");
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
  const explicitZeroUsage = (entry) =>
    (entry.tokenGroups?.length ?? 0) > 0 &&
    entry.tokenGroups.every((group) =>
      Object.values(group.counters ?? {}).every((value) => BigInt(value) === 0n),
    );
  const exactPositiveUsage = (entry) =>
    (entry.tokenGroups?.length ?? 0) > 0 &&
    entry.tokenGroups.some((group) =>
      Object.values(group.counters ?? {}).some((value) => BigInt(value) > 0n),
    );
  const totalFor = (entry) => {
    const totals = (entry.tokenGroups ?? [])
      .map((group) => group.counters?.totalTokens)
      .filter((value) => value !== undefined);
    return totals.length === 1 ? BigInt(totals[0]) : null;
  };
  const subagentEvidence = groupByRun(eligible, "subagent")
    .map((entries) => {
      if (!hasOnlySteps(entries, ["parent", "subagent"])) return null;
      const parent = consistentStep(entries, "parent", hasUsage);
      const subagent = consistentStep(entries, "subagent", hasUsage);
      if (!parent || !subagent || account(parent) !== account(subagent)) return null;
      const parentTotal = totalFor(parent);
      const subagentTotal = totalFor(subagent);
      const candidateRelationships = ["separate_parent_and_subagent_usage_observed"];
      if (parentTotal !== null && subagentTotal !== null)
        candidateRelationships.push(
          parentTotal === subagentTotal
            ? "parent_total_equals_subagent_total"
            : parentTotal > subagentTotal
              ? "parent_total_greater_than_subagent_total"
              : "parent_total_less_than_subagent_total",
        );
      return {
        runId: parent.declaredRunId,
        eventName: parent.eventName,
        schemaSignature: schemaSignature(parent),
        candidateRelationships,
      };
    })
    .filter(Boolean);
  const abortedErrorEntries = eligible.filter(
    (entry) =>
      entry.declaredScenario === "aborted-error" &&
      ["aborted", "error", "failure"].includes(entry.status),
  );
  const abortedErrorEvidence = {
    exactUsageObserved: abortedErrorEntries.some(exactPositiveUsage),
    explicitZeroObserved: abortedErrorEntries.some(explicitZeroUsage),
    usageAbsent: abortedErrorEntries.some((entry) => (entry.tokenGroups?.length ?? 0) === 0),
  };
  const scenarioCoverage = {
    "desktop-one-turn": oneTurn("desktop-one-turn", "desktop"),
    "cli-interactive-one-turn": oneTurn("cli-interactive-one-turn", "cli-interactive"),
    "cli-headless-one-turn": oneTurn("cli-headless-one-turn", "cli-headless"),
    "desktop-cli-same-account": pairedAccount("desktop-cli-same-account", true),
    "desktop-cli-different-accounts": pairedAccount("desktop-cli-different-accounts", false),
    "cli-a-b-a": aba("cli-a-b-a", "cli-interactive"),
    "desktop-a-b-a": aba("desktop-a-b-a", "desktop"),
    subagent: subagentEvidence.length > 0,
    "aborted-error": Object.values(abortedErrorEvidence).some(Boolean),
    "utc-midnight": groupByRun(eligible, "utc-midnight").some((entries) => {
      if (!hasOnlySteps(entries, ["before", "after"])) return false;
      const before = consistentStep(entries, "before", hasUsage);
      const after = consistentStep(entries, "after", hasUsage);
      return Boolean(
        before &&
        after &&
        account(before) === account(after) &&
        Date.parse(before.providerTimestamp) < Date.parse(after.providerTimestamp) &&
        Date.parse(`${after.providerTimestamp.slice(0, 10)}T00:00:00.000Z`) -
          Date.parse(`${before.providerTimestamp.slice(0, 10)}T00:00:00.000Z`) ===
          86_400_000,
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
  const sourceTruncatedObservations = observations.filter((entry) => entry.sourceTruncated).length;
  const exactPathQualifiedTruncations = observations.filter(
    (entry) => entry.truncationIgnoredForExactPaths,
  ).length;
  const ambiguousAccounts = observations.filter((entry) => entry.accountAmbiguous).length;
  const ambiguousTimestamps = observations.filter((entry) => entry.timestampAmbiguous).length;
  const exactCounterTuple = (entry) =>
    JSON.stringify(
      (entry.tokenGroups ?? [])
        .map((group) =>
          Object.fromEntries(
            Object.entries(group.counters ?? {}).sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          ),
        )
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    );
  const selectedIdentityHashes = (entry) =>
    selectedEventIdentityKind === null
      ? []
      : [
          ...new Set(
            (entry.eventIdentities ?? [])
              .filter((identity) => identity.field === selectedEventIdentityKind)
              .map((identity) => identity.hash),
          ),
        ];
  const identityHash = (entry) => {
    const hashes = selectedIdentityHashes(entry);
    return hashes.length === 1 ? hashes[0] : null;
  };
  const selectedEventIdentityAmbiguousObservations = observations.filter(
    (entry) => selectedIdentityHashes(entry).length > 1,
  ).length;
  const reconciliationCandidates = observations.filter(
    (entry) =>
      entry.parseStatus === "parsed" &&
      !entry.truncated &&
      !entry.accountAmbiguous &&
      !entry.timestampAmbiguous &&
      identityHash(entry) !== null,
  );
  const hookIdentityEntries = reconciliationCandidates.filter((entry) =>
    eventNames.includes(entry.eventName),
  );
  const historyIdentityEntries = reconciliationCandidates.filter(
    (entry) => entry.eventName === "local-jsonl",
  );
  let hookHistoryIdentityConflict = false;
  let hookHistoryIdentityReconciled = false;
  for (const hook of hookIdentityEntries) {
    for (const history of historyIdentityEntries) {
      if (identityHash(hook) !== identityHash(history)) continue;
      const compatible =
        (hook.invalidCounterPaths?.length ?? 0) === 0 &&
        (history.invalidCounterPaths?.length ?? 0) === 0 &&
        (hook.invalidTimestampPaths?.length ?? 0) === 0 &&
        (history.invalidTimestampPaths?.length ?? 0) === 0 &&
        account(hook) !== null &&
        account(hook) === account(history) &&
        hook.providerTimestamp !== null &&
        hook.providerTimestamp === history.providerTimestamp &&
        (hook.tokenGroups?.length ?? 0) > 0 &&
        (history.tokenGroups?.length ?? 0) > 0 &&
        exactCounterTuple(hook) === exactCounterTuple(history);
      if (compatible) hookHistoryIdentityReconciled = true;
      else hookHistoryIdentityConflict = true;
    }
  }
  if (hookHistoryIdentityConflict || selectedEventIdentityAmbiguousObservations > 0)
    hookHistoryIdentityReconciled = false;
  const hookEventCandidates = Object.fromEntries(
    eventNames.map((eventName) => {
      const entries = eligible.filter((entry) => entry.eventName === eventName);
      return [
        eventName,
        {
          observationCount: entries.length,
          usageObservationCount: entries.filter(hasUsage).length,
          observedScenarios: [...new Set(entries.map((entry) => entry.declaredScenario))].sort(),
          schemaSignatures: [...new Set(entries.map(schemaSignature))].sort(),
        },
      ];
    }),
  );
  const mechanicalScenarioNames = [
    "desktop-one-turn",
    "cli-interactive-one-turn",
    "cli-headless-one-turn",
    "desktop-cli-same-account",
    "desktop-cli-different-accounts",
    "cli-a-b-a",
    "desktop-a-b-a",
    "utc-midnight",
  ];
  const exactPathSelectionsComplete =
    selections.counterPaths.size > 0 &&
    selections.accountPaths.size > 0 &&
    selections.eventIdPaths.size > 0 &&
    selections.timestampPaths.size > 0 &&
    selections.versionSources.size > 0;
  const versionEvidenceBySurfaceContract = Object.fromEntries(
    [
      ...new Set(
        usageObservations.map((entry) => `${entry.declaredSurface}:${observationContract(entry)}`),
      ),
    ]
      .sort()
      .map((contract) => [
        contract,
        usageObservations
          .filter((entry) => `${entry.declaredSurface}:${observationContract(entry)}` === contract)
          .every((entry) => entry.cursorVersion !== null),
      ]),
  );
  const versionEvidenceComplete =
    usageObservations.length > 0 && Object.values(versionEvidenceBySurfaceContract).every(Boolean);
  const mechanicalCoverageComplete =
    exactPathSelectionsComplete &&
    mechanicalScenarioNames.every((scenario) => scenarioCoverage[scenario]) &&
    Object.values(coreSurfaceUsage).every(Boolean) &&
    usageObservations.length > 0 &&
    hookHistoryIdentityReconciled &&
    !hookHistoryIdentityConflict &&
    selectedEventIdentityAmbiguousObservations === 0 &&
    graph.count >= 2 &&
    !graph.aliasConflict &&
    invalidCounters === 0 &&
    invalidTimestamps === 0 &&
    nonParsedObservations.length === 0 &&
    truncatedObservations === 0 &&
    ambiguousAccounts === 0 &&
    ambiguousTimestamps === 0 &&
    versionEvidenceComplete &&
    manifestState.invalid === 0 &&
    manifestState.unmanifested === 0 &&
    !observationSetTruncated;
  const limitations = [
    "production_gate_requires_authenticated_review",
    "surface_scenario_run_and_step_are_operator_declared",
    "cursor_exact_source_not_independently_authenticated",
    "token_relationship_requires_reviewer_interpretation",
  ];
  if (!mechanicalCoverageComplete) limitations.push("mechanical_coverage_incomplete");
  if (!exactPathSelectionsComplete) limitations.push("exact_schema_paths_not_selected");
  if (!versionEvidenceComplete) limitations.push("version_evidence_incomplete");
  if (manifestState.invalid > 0 || manifestState.unmanifested > 0)
    limitations.push("run_manifest_incomplete_or_conflicting");
  if (selectedEventIdentityKind === null)
    limitations.push("hook_history_identity_kind_not_selected");
  if (!hookHistoryIdentityReconciled) limitations.push("hook_history_identity_not_reconciled");
  if (hookHistoryIdentityConflict) limitations.push("hook_history_identity_conflict");
  if (selectedEventIdentityAmbiguousObservations > 0)
    limitations.push("selected_event_identity_ambiguous");
  if (graph.aliasConflict) limitations.push("account_alias_conflict");
  if (nonParsedObservations.length > 0)
    limitations.push("non_parsed_required_observations_cannot_qualify");
  limitations.push("subagent_accounting_requires_reviewer_interpretation");
  limitations.push("aborted_error_accounting_requires_reviewer_interpretation");
  if (graph.count < 2) limitations.push("distinct_accounts_not_demonstrated");
  if (truncatedObservations > 0 || observationSetTruncated)
    limitations.push("truncated_observations_cannot_qualify");
  if (exactPathQualifiedTruncations > 0) limitations.push("unselected_schema_truncation_present");
  if (ambiguousAccounts > 0 || ambiguousTimestamps > 0)
    limitations.push("ambiguous_observations_cannot_qualify");
  return {
    schemaVersion: 1,
    productionGate: "closed",
    mechanicalCoverageComplete,
    observationCount: allObservations.length,
    qualifyingObservationCount: observations.length,
    observationSetTruncated,
    runManifestCount: manifests.length,
    failedRunManifestCount: manifestState.failed,
    pendingRunManifestCount: manifestState.pending,
    invalidRunManifestCount: manifestState.invalid,
    unmanifestedObservationCount: manifestState.unmanifested,
    observedScenarios,
    observedSurfaces,
    observedEvents,
    versions,
    selectedExactPaths: {
      counters: [...selections.counterPaths].sort(),
      accounts: [...selections.accountPaths].sort(),
      eventIdentities: [...selections.eventIdPaths].sort(),
      timestamps: [...selections.timestampPaths].sort(),
      versions: [...selections.versionSources].sort(),
    },
    versionEvidenceBySurfaceContract,
    distinctLocallyLinkedAccounts: graph.count,
    accountAliasConflict: graph.aliasConflict,
    accountAliasConflictCount: graph.aliasConflictCount,
    usageObservationCount: usageObservations.length,
    eventIdentityObservationCount: eventIdentityObservations.length,
    selectedEventIdentityKind,
    observationsWithProviderTimestamp: observations.filter(
      (entry) => entry.providerTimestamp !== null,
    ).length,
    invalidCounterCount: invalidCounters,
    invalidTimestampCount: invalidTimestamps,
    truncatedObservationCount: truncatedObservations,
    sourceTruncatedObservationCount: sourceTruncatedObservations,
    exactPathQualifiedTruncationCount: exactPathQualifiedTruncations,
    ambiguousAccountObservationCount: ambiguousAccounts,
    ambiguousTimestampObservationCount: ambiguousTimestamps,
    nonParsedObservationCount: nonParsedObservations.length,
    hookHistoryIdentityReconciled,
    hookHistoryIdentityConflict,
    selectedEventIdentityAmbiguousObservationCount: selectedEventIdentityAmbiguousObservations,
    hookEventCandidates,
    semanticEvidence: {
      subagent: subagentEvidence,
      abortedError: abortedErrorEvidence,
    },
    semanticCoverageComplete: false,
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
    const expectedIdentityValues = [
      options["expected-event-id-kind"],
      options["expected-event-id-path"],
      options["expected-event-id-file"],
    ];
    if (
      expectedIdentityValues.some((value) => value !== undefined) &&
      expectedIdentityValues.some((value) => value === undefined)
    )
      throw new Error(
        "Cursor expected event identity kind, path, and file must be supplied together",
      );
    let expectedEventIdentity = null;
    if (expectedIdentityValues[0] !== undefined) {
      if (!isAbsolute(expectedIdentityValues[2]))
        throw new Error("Cursor expected event identity file path must be absolute");
      const identityFile = resolve(expectedIdentityValues[2]);
      await assertSafeRegularFile(identityFile, { maximumBytes: 1_024, privateFile: true });
      const value = JSON.parse(await readFile(identityFile, "utf8"));
      if (typeof value !== "string")
        throw new Error("Cursor expected event identity file must contain one JSON string");
      expectedEventIdentity = {
        kind: expectedIdentityValues[0],
        path: expectedIdentityValues[1],
        value,
      };
    }
    const result = await installProbeHooks({
      outputDirectory: options["output-dir"],
      surface: options.surface,
      scenario: options.scenario,
      runId: options["run-id"],
      step: options.step,
      event: requireHookEvent(options.event),
      hooksFile: options["hooks-file"],
      expectedEventIdentity,
      versionPath: options["version-path"],
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
      `${JSON.stringify(
        await buildEvidenceReport(options["output-dir"], {
          eventIdentityKind: options["event-identity-kind"],
          counterPaths: options["counter-path"],
          accountPaths: options["account-path"],
          eventIdPaths: options["event-id-path"],
          timestampPaths: options["timestamp-path"],
          versionSources: options["version-source"],
        }),
        null,
        2,
      )}\n`,
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
