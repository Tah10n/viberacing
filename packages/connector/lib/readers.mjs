import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
}

function optionalInteger(value) {
  return value === undefined ? 0n : safeInteger(value);
}

export function parseCodexUsage(payload) {
  const buckets = payload?.result?.dailyUsageBuckets;
  if (buckets === null) return [];
  if (!Array.isArray(buckets)) throw new Error("Codex did not return daily usage buckets");
  return buckets.map((bucket) => {
    const tokens = safeInteger(bucket?.tokens);
    if (!datePattern.test(bucket?.startDate ?? "") || tokens === null)
      throw new Error("Codex returned an unsupported usage shape");
    return { agent: "codex", date: bucket.startDate, tokens: tokens.toString() };
  });
}

function lineReader(stream, processError) {
  const iterator = createInterface({ input: stream, crlfDelay: Infinity })[Symbol.asyncIterator]();
  return async () => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Codex App Server timed out")), 8_000);
    });
    let next;
    try {
      next = await Promise.race([iterator.next(), processError, timeout]);
    } finally {
      clearTimeout(timer);
    }
    if (next.done) throw new Error("Codex App Server closed unexpectedly");
    return JSON.parse(next.value);
  };
}

export async function readCodexUsage() {
  const child = spawn("codex", ["app-server"], {
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  const processError = new Promise((_, reject) => child.once("error", reject));
  const readLine = lineReader(child.stdout, processError);
  const write = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
  try {
    write({
      id: 0,
      method: "initialize",
      params: {
        clientInfo: {
          name: "viberacing_connector",
          title: "Vibe Racing Connector",
          version: "0.1.0",
        },
      },
    });
    const initialized = await readLine();
    if (initialized?.id !== 0 || initialized?.result === undefined)
      throw new Error("Codex App Server initialization failed");
    write({ method: "initialized", params: {} });
    write({ id: 1, method: "account/usage/read", params: null });
    let response;
    while (response === undefined) {
      const message = await readLine();
      if (message?.id === 1) response = message;
    }
    return parseCodexUsage(response);
  } finally {
    child.stdin.end();
    child.kill();
  }
}

function accumulateClaudeLine(line, messages, totals) {
  if (line.trim() === "" || Buffer.byteLength(line, "utf8") > 1_000_000) return;
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return;
  }
  if (record?.type !== "assistant" || record?.message?.role !== "assistant") return;
  const messageId = record.message.id;
  const usage = record.message.usage;
  const timestamp = record.timestamp;
  if (
    typeof messageId !== "string" ||
    messages.has(messageId) ||
    typeof timestamp !== "string" ||
    usage === null ||
    typeof usage !== "object"
  )
    return;
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return;
  const components = [
    safeInteger(usage.input_tokens),
    safeInteger(usage.output_tokens),
    optionalInteger(usage.cache_creation_input_tokens),
    optionalInteger(usage.cache_read_input_tokens),
  ];
  if (components.some((value) => value === null)) return;
  messages.add(messageId);
  const day = date.toISOString().slice(0, 10);
  const total = components.reduce((sum, value) => sum + value, 0n);
  totals.set(day, (totals.get(day) ?? 0n) + total);
}

function projectClaudeTotals(totals) {
  return [...totals]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, tokens]) => ({ agent: "claude_code", date, tokens: tokens.toString() }));
}

export function parseClaudeLines(lines) {
  const messages = new Set();
  const totals = new Map();
  for (const line of lines) accumulateClaudeLine(line, messages, totals);
  return projectClaudeTotals(totals);
}

export function recentEntries(entries, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const firstDay = new Date(today);
  firstDay.setUTCDate(firstDay.getUTCDate() - 30);
  const firstDate = firstDay.toISOString().slice(0, 10);
  const lastDate = today.toISOString().slice(0, 10);
  const unique = new Map();
  for (const entry of entries) {
    if (!datePattern.test(entry?.date ?? "") || entry.date < firstDate || entry.date > lastDate)
      continue;
    unique.set(`${entry.agent}:${entry.date}`, entry);
  }
  return [...unique.values()].sort(
    (left, right) => left.date.localeCompare(right.date) || left.agent.localeCompare(right.agent),
  );
}

async function findRecentJsonl(root, maximum = 500) {
  const files = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    let directory;
    try {
      directory = await opendir(current);
    } catch {
      continue;
    }
    for await (const entry of directory) {
      if (entry.isSymbolicLink()) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) queue.push(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          const info = await stat(path);
          if (info.size <= 20_000_000)
            files.push({ path, size: info.size, modifiedAt: info.mtimeMs });
        } catch {}
      }
    }
  }
  return files
    .sort(
      (left, right) => right.modifiedAt - left.modifiedAt || left.path.localeCompare(right.path),
    )
    .slice(0, maximum);
}

export async function readClaudeUsage(
  root = join(homedir(), ".claude", "projects"),
  maximumFiles = 500,
) {
  const files = await findRecentJsonl(root, maximumFiles);
  const messages = new Set();
  const totals = new Map();
  let totalBytes = 0;
  for (const file of files) {
    if (totalBytes + file.size > 100_000_000) continue;
    totalBytes += file.size;
    const lines = createInterface({
      input: createReadStream(file.path, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) accumulateClaudeLine(line, messages, totals);
  }
  return projectClaudeTotals(totals);
}

export async function detectAgents() {
  const agents = [];
  try {
    await readCodexUsage();
    agents.push("codex");
  } catch {}
  try {
    if ((await stat(join(homedir(), ".claude", "projects"))).isDirectory())
      agents.push("claude_code");
  } catch {}
  return agents;
}
