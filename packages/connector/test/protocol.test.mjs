import test from "node:test";
import assert from "node:assert/strict";
import { mergeStoredSourceMapping, parseProtocolResponse } from "../lib/protocol.mjs";
import { sanitizeTerminalText } from "../lib/terminal.mjs";

const installationId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const local = {
  clientSourceId: "44444444-4444-4444-8444-444444444444",
  agentId: "antigravity",
  collectionMethod: "antigravity_cli_capture",
  supportedSurface: "cli",
  suggestedLabel: "Antigravity",
  dataPath: "/private/local-capture.jsonl",
  executablePath: "/private/local-executable",
};
const retainedLocal = {
  ...local,
  clientSourceId: "55555555-5555-4555-8555-555555555555",
  sourceId: "66666666-6666-4666-8666-666666666666",
  suggestedLabel: "Previously connected Antigravity",
};

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function mapping(overrides = {}) {
  return {
    clientSourceId: local.clientSourceId,
    sourceId,
    agentAccountId: accountId,
    agentId: local.agentId,
    accountLabel: "Antigravity",
    collectionMethod: local.collectionMethod,
    lastAcceptedSyncSequence: "0",
    ...overrides,
  };
}

function activePoll(sources = [mapping()], overrides = {}) {
  return {
    status: "active",
    deviceToken: "device_token_that_is_long_enough_123456789",
    sources,
    protocol: { version: 2, snapshotDays: 31, maximumSources: 32, maximumEntries: 1_024 },
    ...overrides,
  };
}

test("accepts the exact pairing contract and preserves local-only source authority", async () => {
  const result = await parseProtocolResponse(json(activePoll()), {
    kind: "pairingPoll",
    localSources: [local],
  });
  assert.equal(result.sources[0].dataPath, local.dataPath);
  assert.equal(result.sources[0].executablePath, local.executablePath);
  assert.equal(result.sources[0].sourceId, sourceId);
  assert.deepEqual(
    Object.keys(result.sources[0]).filter((key) => key.startsWith("server")),
    [],
  );
});

test("rejects server attempts to add local paths, executables, or unknown mapping fields", async () => {
  for (const injected of [
    { dataPath: "/tmp/attacker" },
    { hookConfigRoot: "/tmp/attacker" },
    { executablePath: "/tmp/attacker" },
    { serverExtension: true },
  ]) {
    await assert.rejects(
      parseProtocolResponse(json(activePoll([mapping(injected)])), {
        kind: "pairingPoll",
        localSources: [local],
      }),
      /invalid protocol response/,
    );
  }
  await assert.rejects(
    parseProtocolResponse(json(activePoll([mapping({ accountLabel: "Owned\u001b[2J" })])), {
      kind: "pairingPoll",
      localSources: [local],
    }),
    /invalid protocol response/,
  );
});

test("protocol errors are snake_case and terminal output strips control characters", async () => {
  assert.deepEqual(
    await parseProtocolResponse(json({ error: "source_disconnected" }, 400), {
      kind: "usage",
      sourceIds: [sourceId],
    }),
    { error: "source_disconnected" },
  );
  for (const error of ["InvalidRequest", "invalid-request", "invalid__request", "bad\ncode"]) {
    await assert.rejects(
      parseProtocolResponse(json({ error }, 400), {
        kind: "usage",
        sourceIds: [sourceId],
      }),
      /invalid protocol response/,
    );
  }
  assert.equal(sanitizeTerminalText("safe\u001b[2J\r\nnext"), "safe�[2J��next");
});

test("browser Sync claims accept only a bounded unique source set", async () => {
  const requestId = "11111111-1111-4111-8111-111111111111";
  const sourceId = "22222222-2222-4222-8222-222222222222";
  const response = new Response(JSON.stringify({ requestId, sourceIds: [sourceId] }), {
    headers: { "Content-Type": "application/json" },
  });
  assert.deepEqual(await parseProtocolResponse(response, { kind: "browserSyncClaim" }), {
    requestId,
    sourceIds: [sourceId],
  });
  await assert.rejects(
    parseProtocolResponse(
      new Response(JSON.stringify({ requestId, sourceIds: [sourceId, sourceId] }), {
        headers: { "Content-Type": "application/json" },
      }),
      { kind: "browserSyncClaim" },
    ),
    /invalid protocol response/i,
  );
});

test("rejects agent substitution and non-exact pairing source sets", async () => {
  await assert.rejects(
    parseProtocolResponse(json(activePoll([mapping({ agentId: "codex" })])), {
      kind: "pairingPoll",
      localSources: [local],
    }),
    /invalid protocol response/,
  );
  for (const sources of [[], [mapping(), mapping()]]) {
    await assert.rejects(
      parseProtocolResponse(json(activePoll(sources)), {
        kind: "pairingPoll",
        localSources: [local],
      }),
      /invalid protocol response/,
    );
  }
});

test("pairing accepts a previously connected local source omitted from current discovery", async () => {
  const retainedMapping = mapping({
    clientSourceId: retainedLocal.clientSourceId,
    sourceId: retainedLocal.sourceId,
  });
  const result = await parseProtocolResponse(json(activePoll([mapping(), retainedMapping])), {
    kind: "pairingPoll",
    localSources: [local, retainedLocal],
    requiredClientSourceIds: [local.clientSourceId],
  });
  assert.deepEqual(
    result.sources.map((source) => source.clientSourceId),
    [local.clientSourceId, retainedLocal.clientSourceId],
  );
  await assert.rejects(
    parseProtocolResponse(json(activePoll([mapping(), { ...retainedMapping, sourceId }])), {
      kind: "pairingPoll",
      localSources: [local, retainedLocal],
      requiredClientSourceIds: [local.clientSourceId],
    }),
    /invalid protocol response/,
  );
  await assert.rejects(
    parseProtocolResponse(json(activePoll([mapping()])), {
      kind: "pairingPoll",
      localSources: [local, retainedLocal],
      requiredClientSourceIds: [local.clientSourceId, retainedLocal.clientSourceId],
    }),
    /invalid protocol response/,
  );
});

test("rejects oversized, incomplete, and reconciliation responses without sources", async () => {
  await assert.rejects(
    parseProtocolResponse(
      new Response(JSON.stringify({ padding: "x".repeat(65_536) }), {
        headers: { "content-type": "application/json" },
      }),
      { kind: "pairingPoll", localSources: [local] },
    ),
    /too large/,
  );
  await assert.rejects(
    parseProtocolResponse(json({ status: "active" }), {
      kind: "pairingPoll",
      localSources: [local],
    }),
    /invalid protocol response/,
  );
  await assert.rejects(
    parseProtocolResponse(json({}), { kind: "reconciliation", sourceIds: [sourceId] }),
    /invalid protocol response/,
  );
  await assert.rejects(
    parseProtocolResponse(json({ sources: [] }), {
      kind: "reconciliation",
      sourceIds: [sourceId],
    }),
    /invalid protocol response/,
  );
  await assert.rejects(
    parseProtocolResponse(
      json({
        sources: [
          {
            sourceId,
            status: "disconnected",
            lastAcceptedSyncSequence: "0",
            warning: "must not be part of reconciliation",
          },
        ],
      }),
      { kind: "reconciliation", sourceIds: [sourceId] },
    ),
    /invalid protocol response/,
  );
});

test("compact reconciliation requires every requested source and supports 100 mappings", async () => {
  const sourceIds = Array.from(
    { length: 100 },
    (_, index) =>
      `22222222-2222-4222-8${index.toString().padStart(3, "0")}-${index
        .toString()
        .padStart(12, "0")}`,
  );
  const sources = sourceIds.map((id, index) => ({
    sourceId: id,
    status: index === 99 ? "disconnected" : "active",
    lastAcceptedSyncSequence: String(index),
  }));
  const result = await parseProtocolResponse(json({ sources }), {
    kind: "reconciliation",
    sourceIds,
  });
  assert.equal(result.sources.length, 100);
  assert.equal(result.sources.at(-1).status, "disconnected");
  await assert.rejects(
    parseProtocolResponse(json({ sources: sources.slice(0, -1) }), {
      kind: "reconciliation",
      sourceIds,
    }),
    /invalid protocol response/,
  );
});

test("accepts only the expected verification origin, path, code, and web protocols", async () => {
  const base = {
    installationId,
    code: "ABCDEFGH",
    pollToken: "poll_token_that_is_long_enough_1234567890",
    verificationUrl: "https://viberacing.example/connect?code=ABCDEFGH",
    expiresInSeconds: 600,
  };
  await parseProtocolResponse(json(base, 201), {
    kind: "pairingStart",
    installationId,
    origin: "https://viberacing.example",
  });
  for (const verificationUrl of [
    "file:///tmp/attacker",
    "custom:attacker",
    "https://attacker.example/connect?code=ABCDEFGH",
    "https://viberacing.example/other?code=ABCDEFGH",
    "https://viberacing.example/connect?code=ABCDEFGH%26whoami",
    "https://viberacing.example/connect?code=ABCDEFGH&extra=%26calc",
  ]) {
    await assert.rejects(
      parseProtocolResponse(json({ ...base, verificationUrl }, 201), {
        kind: "pairingStart",
        installationId,
        origin: "https://viberacing.example",
      }),
      /invalid protocol response/,
    );
  }
});

test("stored network mappings cannot override local collection authority", () => {
  assert.throws(
    () =>
      mergeStoredSourceMapping(local, {
        ...mapping(),
        agentId: "codex",
        collectionMethod: "codex_app_server",
        dataPath: "/tmp/attacker",
      }),
    /source identity changed/,
  );
  const restored = mergeStoredSourceMapping(local, mapping());
  assert.equal(restored.dataPath, local.dataPath);
  assert.equal(restored.executablePath, local.executablePath);
  assert.equal(restored.agentId, local.agentId);
});
