import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, win32 } from "node:path";
import { executableCandidates, spawnResolvedExecutable } from "./executables.mjs";
import {
  cursorVersionSupported,
  decodeCursorInput,
  maximumCursorInputBytes,
  parseCursorResult,
} from "./cursor-events.mjs";
import { diagnosticError } from "./diagnostics.mjs";

function failure(code) {
  return diagnosticError("Cursor CLI capture is unavailable", code);
}
function safePath(path) {
  return typeof path === "string" && isAbsolute(path) && !/[\0\r\n]/.test(path);
}
async function executableIdentity(path) {
  if (!safePath(path)) throw failure("agent_executable_missing");
  const resolved = await realpath(path);
  const info = await stat(resolved);
  const parent = await stat(dirname(resolved));
  if (
    !info.isFile() ||
    !parent.isDirectory() ||
    (process.platform !== "win32" &&
      ((info.mode & 0o022) !== 0 ||
        (parent.mode & 0o022) !== 0 ||
        (typeof process.getuid === "function" && ![0, process.getuid()].includes(info.uid))))
  )
    throw failure("agent_executable_missing");
  await access(resolved, process.platform === "win32" ? constants.F_OK : constants.X_OK);
  return {
    path: resolved,
    dev: String(info.dev),
    ino: String(info.ino),
    size: info.size,
    mtimeMs: info.mtimeMs,
  };
}

function windowsEnvironment(environment) {
  if (process.platform !== "win32") return environment;
  if (!win32.isAbsolute(environment.SystemRoot ?? "")) throw failure("agent_executable_missing");
  return {
    ...environment,
    ComSpec: win32.join(environment.SystemRoot, "System32", "cmd.exe"),
    PATHEXT: ".EXE;.CMD;.BAT;.COM",
  };
}
function terminateTree(child, signal, environment) {
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else {
      const killer = spawn(
        win32.join(environment.SystemRoot, "System32", "taskkill.exe"),
        ["/PID", String(child.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true },
      );
      killer.on("error", () => {
        try {
          child.kill(signal);
        } catch {}
      });
    }
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

async function versionOf(path, environment) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnResolvedExecutable(
        path,
        ["--version"],
        {
          env: { ...environment, VIBERACING_CURSOR_HEADLESS_CAPTURE_ID: undefined },
          stdio: ["ignore", "pipe", "ignore"],
          detached: process.platform !== "win32",
          windowsHide: true,
        },
        { environment },
      );
    } catch {
      reject(failure("agent_executable_missing"));
      return;
    }
    let bytes = 0;
    const chunks = [];
    let invalid = false;
    const timeout = setTimeout(() => {
      invalid = true;
      terminateTree(child, "SIGKILL", environment);
    }, 5_000);
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 4096) {
        invalid = true;
        chunks.length = 0;
        terminateTree(child, "SIGKILL", environment);
      } else if (!invalid) chunks.push(chunk);
    });
    child.once("error", () => {
      invalid = true;
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      const version = Buffer.concat(chunks).toString("utf8").trim();
      if (invalid || code !== 0 || !cursorVersionSupported(version, "cli"))
        reject(failure("cursor_version_unsupported"));
      else resolve(version);
    });
  });
}

/** Probe only exact executable candidates, never a provider store or a directory scan. */
export async function resolveCursorExecutable({ environment = process.env, home } = {}) {
  const env = windowsEnvironment(environment);
  const override = env.VIBERACING_CURSOR_BIN;
  if (override !== undefined && !safePath(override)) throw failure("agent_executable_missing");
  const searchEnvironment = {
    ...env,
    PATH: (env.PATH ?? "").split(delimiter).filter(safePath).join(delimiter),
  };
  const candidates =
    override !== undefined
      ? [override]
      : executableCandidates("cursor", {
          environment: searchEnvironment,
          ...(home ? { home } : {}),
        });
  let lastFailure;
  for (const candidate of candidates) {
    try {
      const identity = await executableIdentity(candidate);
      const version = await versionOf(identity.path, env);
      if (JSON.stringify(identity) !== JSON.stringify(await executableIdentity(identity.path)))
        throw failure("agent_executable_missing");
      return { ...identity, version };
    } catch (error) {
      lastFailure = error.diagnosticCode ?? "agent_executable_missing";
    }
  }
  throw failure(lastFailure ?? "agent_executable_missing");
}

export function cursorRunArguments(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0")))
    throw failure("cursor_schema_unsupported");
  const result = [...args];
  let format = false;
  for (let index = 0; index < result.length; index++) {
    const arg = result[index];
    if (arg === "--") break;
    if (arg === "--output-format" || arg.startsWith("--output-format=")) {
      if (format) throw failure("cursor_schema_unsupported");
      const value =
        arg === "--output-format" ? result[++index] : arg.slice("--output-format=".length);
      if (value !== "stream-json") throw failure("cursor_schema_unsupported");
      format = true;
    }
  }
  if (!format) result.unshift("--output-format", "stream-json");
  const controls = result.slice(0, result.includes("--") ? result.indexOf("--") : result.length);
  if (!controls.some((arg) => arg === "--print" || arg === "-p" || arg.startsWith("--print=")))
    result.unshift("--print");
  return result;
}

/** Bounded selected result only. Content/tool descendants never enter the retained result. */
export function cursorResultReader({ salt, version, now = () => new Date().toISOString() }) {
  let pending = Buffer.alloc(0);
  let dropping = false;
  let result = null;
  let signature = null;
  let diagnostic;
  function line(bytes) {
    if (bytes.length === 0 || (bytes.length === 1 && bytes[0] === 13)) return;
    try {
      const payload = decodeCursorInput(bytes);
      if (payload.type !== "result") return;
      const capturedAt = now();
      const parsed = parseCursorResult(payload, { salt, version, capturedAt });
      const key = JSON.stringify({
        eventKey: parsed.eventKey,
        sessionKey: parsed.sessionKey,
        tokens: parsed.tokens,
      });
      if (signature !== null && signature !== key) {
        diagnostic = "cursor_event_identity_conflict";
        return;
      }
      if (signature !== null) return;
      signature = key;
      result = {
        capturedAt,
        payload: {
          type: "result",
          subtype: "success",
          is_error: false,
          request_id: payload.request_id,
          session_id: payload.session_id,
          usage: Object.fromEntries(
            ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens"]
              .filter((key) => payload.usage[key] !== undefined)
              .map((key) => [key, payload.usage[key]]),
          ),
        },
      };
    } catch (error) {
      diagnostic = error.diagnosticCode ?? "cursor_schema_unsupported";
    }
  }
  return {
    push(chunk) {
      let start = 0;
      for (;;) {
        const end = chunk.indexOf(10, start);
        const part = chunk.subarray(start, end === -1 ? chunk.length : end);
        if (!dropping && pending.length + part.length <= maximumCursorInputBytes)
          pending = Buffer.concat([pending, part]);
        else {
          dropping = true;
          pending = Buffer.alloc(0);
          diagnostic = "cursor_schema_unsupported";
        }
        if (end === -1) break;
        if (!dropping) line(pending);
        pending = Buffer.alloc(0);
        dropping = false;
        start = end + 1;
      }
    },
    finish() {
      if (pending.length && !dropping) line(pending);
      pending = Buffer.alloc(0);
      return diagnostic
        ? { diagnostic }
        : result
          ? { result }
          : { diagnostic: "cursor_usage_incomplete" };
    },
  };
}

/** No disk writes or network calls. The caller durably commits only a successful process result. */
export async function runCursorProcess({
  executable,
  args,
  salt,
  captureId,
  environment = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  stdin = "inherit",
  signals = process,
  now,
}) {
  const identity = await executableIdentity(executable.path).catch(() => null);
  const { version, ...expected } = executable;
  if (!identity || JSON.stringify(identity) !== JSON.stringify(expected))
    throw failure("agent_executable_missing");
  const env = {
    ...windowsEnvironment(environment),
    VIBERACING_CURSOR_HEADLESS_CAPTURE_ID: captureId,
  };
  const reader = cursorResultReader({ salt, version, now });
  let child;
  try {
    child = spawnResolvedExecutable(
      executable.path,
      cursorRunArguments(args),
      {
        env,
        stdio: [stdin, "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      },
      { environment: env },
    );
  } catch {
    return { code: 1, signal: null, diagnostic: "agent_executable_missing" };
  }
  let interrupted = false;
  let processError = false;
  let closed = false;
  let escalation;
  function kill(signal) {
    if (closed) return;
    terminateTree(child, signal, env);
  }

  function interrupt(signal) {
    interrupted = true;
    kill(signal);
    escalation ??= setTimeout(() => kill("SIGKILL"), 5_000);
    escalation.unref();
  }
  const onInt = () => interrupt("SIGINT");
  const onTerm = () => interrupt("SIGTERM");
  const onOutputError = () => interrupt("SIGTERM");
  signals.on("SIGINT", onInt);
  signals.on("SIGTERM", onTerm);
  stdout.on("error", onOutputError);
  stderr.on("error", onOutputError);
  child.stdout.on("data", (bytes) => reader.push(bytes));
  child.stdout.on("error", () => {
    processError = true;
    interrupt("SIGTERM");
  });
  child.stderr.on("error", () => {
    processError = true;
    interrupt("SIGTERM");
  });
  child.stdout.pipe(stdout, { end: false });
  child.stderr.pipe(stderr, { end: false });
  const outcome = await new Promise((resolve) => {
    child.once("error", () => {
      processError = true;
    });
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  closed = true;
  clearTimeout(escalation);
  signals.off("SIGINT", onInt);
  signals.off("SIGTERM", onTerm);
  child.stdout.unpipe(stdout);
  child.stderr.unpipe(stderr);
  // A child close does not imply that asynchronous destination writes have drained.
  await Promise.all(
    [stdout, stderr].map((stream) =>
      stream.destroyed ? Promise.resolve() : new Promise((resolve) => stream.write("", resolve)),
    ),
  );
  stdout.off("error", onOutputError);
  stderr.off("error", onOutputError);
  if (interrupted || processError || outcome.code !== 0 || outcome.signal)
    return { ...outcome, diagnostic: "cursor_usage_incomplete" };
  return { ...outcome, ...reader.finish() };
}
