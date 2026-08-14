import { antigravityAdapter } from "./adapters/antigravity.mjs";
import { claudeAdapter } from "./adapters/claude.mjs";
import { codexAdapter } from "./adapters/codex.mjs";
import { cursorAdapter } from "./adapters/cursor.mjs";
import { geminiAdapter } from "./adapters/gemini.mjs";
import { kimiAdapter } from "./adapters/kimi.mjs";
import { openCodeAdapter } from "./adapters/opencode.mjs";
import { qwenAdapter } from "./adapters/qwen.mjs";

export const adapters = Object.freeze([
  codexAdapter,
  claudeAdapter,
  openCodeAdapter,
  kimiAdapter,
  qwenAdapter,
  cursorAdapter,
  antigravityAdapter,
  geminiAdapter,
]);

export function adapterFor(agentId) {
  return adapters.find((adapter) => adapter.id === agentId);
}

export async function defaultSources() {
  const result = [];
  for (const adapter of adapters) {
    const detected = await adapter.detect({});
    for (const source of detected)
      result.push({
        agentId: adapter.id,
        suggestedLabel: adapter.displayName,
        ...source,
      });
  }
  return result;
}
