#!/usr/bin/env node
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { openBrowser } from "../lib/browser.mjs";
import { detectAgents, readClaudeUsage, readCodexUsage, recentEntries } from "../lib/readers.mjs";
import { installHooks, readConfig, writeConfig } from "../lib/config.mjs";

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
  if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error("Non-local origins must use HTTPS");
  return url.origin;
}

async function request(origin, path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      `Vibe Racing returned ${response.status}: ${payload.error ?? "request failed"}`,
    );
  return payload;
}

async function collect(agents) {
  const entries = [];
  if (agents.includes("codex")) entries.push(...(await readCodexUsage()));
  if (agents.includes("claude_code")) entries.push(...(await readClaudeUsage()));
  return entries;
}

async function sync(config) {
  const entries = recentEntries(await collect(config.agents));
  if (entries.length === 0) {
    output("No token usage found yet; waiting for the first agent session.");
    return;
  }
  const result = await request(config.origin, "/api/usage", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.deviceToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  output(`Synced ${result.accepted} daily totals.`);
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

async function connect() {
  const origin = normalizedOrigin(option("--origin", "https://viberacing.com"));
  output("Detecting Codex and Claude Code…");
  const agents = await detectAgents();
  if (agents.length === 0)
    throw new Error(
      "No supported local agents found. Sign in to Codex or use Claude Code once, then retry.",
    );
  output(`Found: ${agents.join(", ")}`);
  let previousDeviceToken;
  try {
    const existing = await readConfig();
    if (
      existing?.origin === origin &&
      typeof existing.deviceToken === "string" &&
      existing.deviceToken.length >= 32 &&
      existing.deviceToken.length <= 128
    )
      previousDeviceToken = existing.deviceToken;
  } catch {}
  const pairing = await request(origin, "/api/pairing/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agents, previousDeviceToken }),
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
      body: JSON.stringify({ connectionId: pairing.connectionId, pollToken: pairing.pollToken }),
    });
    if (result.status === "active") {
      const config = { version: 1, origin, agents, deviceToken: pairing.deviceToken };
      await writeConfig(config);
      const installed = await installHooks(import.meta.url, agents);
      const missing = agents.filter(
        (agent) =>
          (agent === "codex" && !installed.codex) || (agent === "claude_code" && !installed.claude),
      );
      if (missing.length > 0)
        throw new Error(
          `Connected, but automatic hooks were not installed for: ${missing.join(", ")}`,
        );
      output("Connected. Automatic sync hooks installed; Codex may ask you to trust the new hook.");
      await sync(config);
      return;
    }
    if (result.status !== "pending") throw new Error("Pairing was revoked");
  }
  throw new Error("Pairing expired");
}

try {
  if (command === "connect") await connect();
  else if (command === "sync") await sync(await readConfig());
  else if (command === "hook") launchSync();
  else if (command === "doctor") {
    const agents = await detectAgents();
    output(`Detected agents: ${agents.length === 0 ? "none" : agents.join(", ")}`);
    try {
      const config = await readConfig();
      output(`Connected origin: ${config.origin}`);
    } catch {
      output("Connector is not paired.");
    }
  } else {
    output("Usage: viberacing connect [--origin https://…] | sync | doctor");
  }
} catch (error) {
  if (!quiet)
    process.stderr.write(
      `Vibe Racing: ${error instanceof Error ? error.message : "unexpected error"}\n`,
    );
  process.exitCode = 1;
}
