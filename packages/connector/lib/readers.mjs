export { parseAntigravityLines } from "./adapters/antigravity.mjs";
export { collectClaude, parseClaudeLines } from "./adapters/claude.mjs";
export {
  codexProfileEnvironment,
  collectCodexSessionUsage,
  mergeCodexUsageComponents,
  parseCodexSessionLines,
  parseCodexUsage,
} from "./adapters/codex.mjs";
export { parseGeminiRecords } from "./adapters/gemini.mjs";
export {
  kimiCollectionMethodForPath,
  kimiSourcePaths,
  parseKimiCurrentLines,
  parseKimiLegacyLines,
  parseKimiLines,
} from "./adapters/kimi.mjs";
export { parseOpenCodeMessages } from "./adapters/opencode.mjs";
export { parseQwenLines } from "./adapters/qwen.mjs";
import { adapterFor } from "./registry.mjs";
export { adapters, adapterFor, defaultSources, discoverSources } from "./registry.mjs";

export function wrapperInvocation(agentId, passed) {
  if (agentId !== "antigravity") throw new Error("Unsupported wrapper agent");
  const executable = "agy";
  const args = [...passed];
  const hasPrint = args.some((argument) => argument === "--print" || argument === "-p");
  const hasOutputFormat = args.some(
    (argument) => argument === "--output-format" || argument.startsWith("--output-format="),
  );
  if (!hasPrint) args.unshift("--print");
  if (!hasOutputFormat) args.push("--output-format", "stream-json");
  return { executable, args };
}

export function safeCaptureRecord(agentId, line) {
  const adapter = adapterFor(agentId);
  if (typeof adapter?.parseCapture !== "function") return null;
  try {
    const native = JSON.parse(line);
    const id = native?.id ?? native?.sessionId ?? native?.session_id;
    if (typeof id !== "string" || id.length < 1 || id.length > 256) return null;
    const entries = adapter.parseCapture([line]);
    if (entries.length !== 1) return null;
    return { id, date: entries[0].date, usage: entries[0] };
  } catch {
    return null;
  }
}

export function recentEntries(entries, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const firstDay = new Date(today);
  firstDay.setUTCDate(firstDay.getUTCDate() - 30);
  const firstDate = firstDay.toISOString().slice(0, 10);
  const lastDate = today.toISOString().slice(0, 10);
  return entries
    .filter(
      (entry) =>
        /^\d{4}-\d{2}-\d{2}$/.test(entry?.date ?? "") &&
        entry.date >= firstDate &&
        entry.date <= lastDate,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}
