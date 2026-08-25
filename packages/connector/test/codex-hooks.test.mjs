import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { inspectCodexHookTrust, parseCodexHookTrust } from "../lib/adapters/codex.mjs";

const expected = Object.freeze({
  sourcePath: resolve("/safe/codex/hooks.json"),
  command: "node /safe/viberacing-hook.mjs hook --source synthetic",
});

function response(overrides = {}) {
  return {
    id: 1,
    result: {
      data: [
        {
          cwd: resolve("/safe/workspace"),
          errors: [],
          warnings: [],
          hooks: [
            {
              eventName: "stop",
              sourcePath: expected.sourcePath,
              command: expected.command,
              enabled: true,
              trustStatus: "trusted",
              ...overrides,
            },
          ],
        },
      ],
    },
  };
}

test("maps exact Codex hook trust states without reading provider content", () => {
  assert.equal(parseCodexHookTrust(response(), expected), "current");
  assert.equal(parseCodexHookTrust(response({ trustStatus: "managed" }), expected), "current");
  assert.equal(parseCodexHookTrust(response({ trustStatus: "untrusted" }), expected), "untrusted");
  assert.equal(parseCodexHookTrust(response({ trustStatus: "modified" }), expected), "modified");
  assert.equal(parseCodexHookTrust(response({ enabled: false }), expected), "disabled");
});

test("fails closed when Codex does not identify one exact owned hook", () => {
  assert.equal(
    parseCodexHookTrust(response({ command: `${expected.command} --changed` }), expected),
    "missing",
  );
  const duplicate = response();
  duplicate.result.data[0].hooks.push({ ...duplicate.result.data[0].hooks[0] });
  assert.equal(parseCodexHookTrust(duplicate, expected), "trust-unknown");
  assert.throws(
    () => parseCodexHookTrust({ id: 1, result: { data: null } }, expected),
    /invalid hook diagnostics/,
  );
  assert.throws(
    () => parseCodexHookTrust({ id: 1, error: { message: "method unavailable" } }, expected),
    /hooks request failed/,
  );
});

test("requests the official hooks/list status for only the active workspace", async () => {
  const calls = [];
  const status = await inspectCodexHookTrust({ dataPath: resolve("/safe/codex") }, expected, {
    cwd: resolve("/safe/workspace"),
    request: async (source, method, params) => {
      calls.push({ source, method, params });
      return response({ trustStatus: "untrusted" });
    },
  });
  assert.equal(status, "untrusted");
  assert.deepEqual(calls, [
    {
      source: { dataPath: resolve("/safe/codex") },
      method: "hooks/list",
      params: { cwds: [resolve("/safe/workspace")] },
    },
  ]);
});
