export { parseAntigravityLines } from "./adapters/antigravity.mjs";
export { parseClaudeLines } from "./adapters/claude.mjs";
export { parseCodexUsage } from "./adapters/codex.mjs";
export { parseCursorLines } from "./adapters/cursor.mjs";
export { parseGeminiRecords } from "./adapters/gemini.mjs";
export { parseKimiLines } from "./adapters/kimi.mjs";
export { parseOpenCodeMessages } from "./adapters/opencode.mjs";
export { parseQwenLines } from "./adapters/qwen.mjs";
export { adapters, adapterFor, defaultSources } from "./registry.mjs";

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
