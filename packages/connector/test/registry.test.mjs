import test from "node:test";
import assert from "node:assert/strict";
import { discoverSources } from "../lib/registry.mjs";

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
