import test from "node:test";
import assert from "node:assert/strict";
import { accountSwitchModes, adapters, discoverSources } from "../lib/registry.mjs";

test("every supported adapter declares exactly one account-switch mode", () => {
  assert.deepEqual(
    Object.fromEntries(adapters.map((adapter) => [adapter.id, adapter.accountSwitchMode])),
    {
      codex: "provider_account_snapshot",
      cursor: "provider_account_events",
      claude_code: "combined_local_history",
      opencode: "combined_local_history",
      kimi_code: "combined_local_history",
      qwen_code: "combined_local_history",
      antigravity: "explicit_capture",
      gemini_cli: "combined_local_history",
    },
  );
  const allowed = new Set(accountSwitchModes);
  for (const adapter of adapters) {
    assert.equal(typeof adapter.accountSwitchMode, "string");
    assert.equal(allowed.has(adapter.accountSwitchMode), true);
  }
});

test("discovery keeps healthy agents and reports a broken installed agent", async () => {
  const result = await discoverSources([
    {
      id: "codex",
      displayName: "Codex",
      detect: async () => {
        throw new Error("app server unavailable");
      },
    },
    {
      id: "opencode",
      displayName: "OpenCode",
      detect: async () => [
        {
          dataPath: "/local-only/path",
          collectionMethod: "opencode_sqlite",
          supportedSurface: "cli",
        },
      ],
    },
  ]);

  assert.deepEqual(result.sources, [
    {
      agentId: "opencode",
      suggestedLabel: "OpenCode",
      dataPath: "/local-only/path",
      collectionMethod: "opencode_sqlite",
      supportedSurface: "cli",
    },
  ]);
  assert.deepEqual(result.diagnostics, [
    {
      agentId: "codex",
      displayName: "Codex",
      error: "app server unavailable",
    },
  ]);
});
