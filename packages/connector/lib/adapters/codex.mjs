import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
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

async function collect(_source, _range, state = {}) {
  const child = spawn("codex", ["app-server"], {
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[
    Symbol.asyncIterator
  ]();
  const next = async () => {
    const result = await Promise.race([
      lines.next(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Codex App Server timed out")), 8_000),
      ),
    ]);
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
          version: "0.2.0",
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
    try {
      await collect({}, {}, {});
      return [{ collectionMethod: "codex_app_server", supportedSurface: "desktop" }];
    } catch {
      return [];
    }
  },
  collect,
  diagnose: async () => {
    try {
      await collect({}, {}, {});
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
