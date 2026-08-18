import { antigravityAdapter } from "./adapters/antigravity.mjs";
import { claudeAdapter } from "./adapters/claude.mjs";
import { codexAdapter } from "./adapters/codex.mjs";
import { geminiAdapter } from "./adapters/gemini.mjs";
import { kimiAdapter } from "./adapters/kimi.mjs";
import { openCodeAdapter } from "./adapters/opencode.mjs";
import { qwenAdapter } from "./adapters/qwen.mjs";
import { canonicalPathKey } from "./adapters/shared.mjs";

/**
 * @typedef {object} DetectedSource
 * @property {string} dataPath
 * @property {string} collectionMethod
 * @property {"cli" | "desktop"} supportedSurface
 * @property {string} suggestedLabel
 * @property {string} [legacyAutoSuggestedLabel]
 * @property {string} [executablePath]
 * @property {string} [hookConfigRoot]
 */

export const adapters = Object.freeze([
  codexAdapter,
  claudeAdapter,
  openCodeAdapter,
  kimiAdapter,
  qwenAdapter,
  antigravityAdapter,
  geminiAdapter,
]);

export function adapterFor(agentId) {
  return adapters.find((adapter) => adapter.id === agentId);
}

export async function discoverSources(availableAdapters = adapters) {
  const result = [];
  const diagnostics = [];
  const identities = new Set();
  for (const adapter of availableAdapters) {
    try {
      const adapterDiagnostics = [];
      const detected = await adapter.detect({ diagnostics: adapterDiagnostics });
      diagnostics.push(
        ...adapterDiagnostics.map((diagnostic) => ({
          agentId: adapter.id,
          displayName: adapter.displayName,
          ...diagnostic,
        })),
      );
      for (const source of detected) {
        const normalized = {
          agentId: adapter.id,
          suggestedLabel: adapter.displayName,
          ...source,
        };
        if (
          typeof normalized.dataPath !== "string" ||
          typeof normalized.collectionMethod !== "string" ||
          !["cli", "desktop"].includes(normalized.supportedSurface) ||
          typeof normalized.suggestedLabel !== "string" ||
          (normalized.legacyAutoSuggestedLabel !== undefined &&
            typeof normalized.legacyAutoSuggestedLabel !== "string")
        )
          throw new Error("adapter returned an invalid detected source");
        const identity = `${adapter.id}\0${await canonicalPathKey(normalized.dataPath)}`;
        if (identities.has(identity)) continue;
        identities.add(identity);
        result.push(normalized);
      }
    } catch (error) {
      diagnostics.push({
        agentId: adapter.id,
        displayName: adapter.displayName,
        error: error instanceof Error ? error.message : "source detection failed",
      });
    }
  }
  return { sources: result, diagnostics };
}

export async function defaultSources() {
  return (await discoverSources()).sources;
}
