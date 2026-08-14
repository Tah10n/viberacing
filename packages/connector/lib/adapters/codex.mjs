import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { executableOverride, resolveAgentExecutable } from "../executables.mjs";
import { totalEntry } from "./shared.mjs";

export function parseCodexUsage(payload) {
  if (payload?.error)
    throw new Error(`Codex usage request failed: ${payload.error.message ?? "RPC error"}`);
  const buckets = payload?.result?.dailyUsageBuckets;
  if (buckets === null) return [];
  if (!Array.isArray(buckets)) throw new Error("Codex did not return daily usage buckets");
  const dates = new Set();
  return buckets.map((bucket) => {
    const entry = totalEntry(bucket?.startDate, bucket?.tokens);
    if (entry === null || dates.has(entry.date))
      throw new Error("Codex returned an unsupported usage shape");
    dates.add(entry.date);
    return entry;
  });
}

export function codexProfileEnvironment(source, environment = process.env) {
  const codexHome = source?.dataPath
    ? resolve(source.dataPath)
    : environment.CODEX_HOME
      ? resolve(environment.CODEX_HOME)
      : join(homedir(), ".codex");
  return { ...environment, CODEX_HOME: codexHome };
}

async function collect(source, _range, state = {}) {
  const executable = await resolveAgentExecutable("codex");
  if (!executable)
    throw new Error(
      `Codex executable was not found in installed apps, package-manager bins, or PATH; set ${executableOverride("codex")} to its absolute path`,
    );
  const child = spawn(executable, ["app-server"], {
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
    env: codexProfileEnvironment(source),
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[
    Symbol.asyncIterator
  ]();
  const spawnFailure = new Promise((_, reject) => child.once("error", reject));
  const next = async () => {
    let timeout;
    const timedOut = new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Codex App Server timed out")), 8_000);
    });
    let result;
    try {
      result = await Promise.race([lines.next(), spawnFailure, timedOut]);
    } finally {
      clearTimeout(timeout);
    }
    if (result.done) throw new Error("Codex App Server closed unexpectedly");
    return JSON.parse(result.value);
  };
  const write = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  try {
    write({
      id: 0,
      method: "initialize",
      params: {
        clientInfo: {
          name: "viberacing_connector",
          title: "Vibe Racing Connector",
          version: "0.2.1",
        },
      },
    });
    const initialized = await next();
    if (initialized?.id !== 0 || !initialized.result)
      throw new Error("Codex App Server initialization failed");
    write({ method: "initialized", params: {} });
    write({ id: 1, method: "account/usage/read", params: null });
    for (;;) {
      const response = await next();
      if (response?.id === 1)
        return {
          entries: parseCodexUsage(response),
          completeness: "complete",
          nextState: state,
          warnings: [],
        };
    }
  } finally {
    child.stdin.end();
    child.kill();
  }
}

export const codexAdapter = Object.freeze({
  id: "codex",
  displayName: "Codex",
  supportedSurfaces: ["cli", "desktop"],
  collectionMethods: ["codex_app_server"],
  aggregationMode: "account_max",
  detect: async () => {
    const dataPath = process.env.CODEX_HOME
      ? resolve(process.env.CODEX_HOME)
      : join(homedir(), ".codex");
    try {
      await access(dataPath);
    } catch {
      return [];
    }
    await collect({ dataPath }, {}, {});
    return [
      {
        dataPath,
        collectionMethod: "codex_app_server",
        supportedSurface: "desktop",
        suggestedLabel: "Codex",
      },
    ];
  },
  collect,
  diagnose: async (source) => {
    try {
      await collect(source, {}, {});
      return {
        status: "ok",
        collectionMethod: "codex_app_server",
        supportedSurfaces: ["cli", "desktop"],
        excluded: [],
      };
    } catch (error) {
      return {
        status: "error",
        error: error.message,
        collectionMethod: "codex_app_server",
        supportedSurfaces: ["cli", "desktop"],
        excluded: [],
      };
    }
  },
});
