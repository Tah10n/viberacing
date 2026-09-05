import test from "node:test";
import assert from "node:assert/strict";
import {
  connectorProtocolVersion,
  mergeStoredSourceMapping,
  parseProtocolResponse,
  sourceRegistrationBody,
} from "../lib/protocol.mjs";
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
    historyBackfillYear: 2026,
    historyBackfillStatus: "pending",
    historyGapRangeStart: null,
    historyGapRangeEnd: null,
    ...overrides,
  };
}

function activePoll(sources = [mapping()], overrides = {}) {
  return {
    status: "active",
    deviceToken: "device_token_that_is_long_enough_123456789",
    sources,
    protocol: {
      version: connectorProtocolVersion,
      snapshotDays: 31,
      maximumSources: 32,
      maximumEntries: 1_024,
    },
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

test("rejects a pairing response for an older wire protocol", async () => {
  await assert.rejects(
    parseProtocolResponse(
      json(
        activePoll(undefined, {
          protocol: { version: 2, snapshotDays: 31, maximumSources: 32, maximumEntries: 1_024 },
        }),
      ),
      { kind: "pairingPoll", localSources: [local] },
    ),
    /invalid protocol response/,
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

test("protocol v4 usage responses distinguish applied and stale source errors", async () => {
  const response = {
    acceptedEntries: 0,
    acceptedSnapshots: 0,
    acceptedSourceErrors: 1,
    staleSourceErrors: 1,
    legacySourceErrorsIgnored: 0,
    staleSnapshots: 0,
    sourceSequences: [{ sourceId, lastAcceptedSyncSequence: "5", accepted: false }],
  };
  assert.deepEqual(
    await parseProtocolResponse(json(response), { kind: "usage", sourceIds: [sourceId] }),
    response,
  );
  for (const invalid of [
    { ...response, staleSourceErrors: -1 },
    { ...response, legacySourceErrorsIgnored: "0" },
    Object.fromEntries(Object.entries(response).filter(([key]) => key !== "staleSourceErrors")),
  ]) {
    await assert.rejects(
      parseProtocolResponse(json(invalid), { kind: "usage", sourceIds: [sourceId] }),
      /invalid protocol response/,
    );
  }
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

test("protocol v5 reconciliation requires bounded per-source history status", async () => {
  const context = { kind: "reconciliation", sourceIds: [sourceId], protocolVersion: 5 };
  const source = {
    sourceId,
    status: "active",
    lastAcceptedSyncSequence: "7",
    historyBackfillYear: 2026,
    historyBackfillStatus: "complete",
    historyGapRangeStart: null,
    historyGapRangeEnd: null,
  };
  assert.deepEqual(await parseProtocolResponse(json({ sources: [source] }), context), {
    sources: [source],
  });
  const withoutGap = {
    sourceId,
    status: "active",
    lastAcceptedSyncSequence: "7",
    historyBackfillYear: 2026,
    historyBackfillStatus: "complete",
  };
  assert.deepEqual(await parseProtocolResponse(json({ sources: [withoutGap] }), context), {
    sources: [withoutGap],
  });
  for (const invalid of [
    { ...source, historyBackfillYear: 2026.5 },
    { ...source, historyBackfillYear: 10_000 },
    { ...source, historyBackfillStatus: "lifetime" },
    Object.fromEntries(Object.entries(source).filter(([key]) => key !== "historyBackfillStatus")),
    { ...source, historyGapRangeStart: "2026-06-01", historyGapRangeEnd: null },
    { ...source, historyGapRangeStart: "2026-06-02", historyGapRangeEnd: "2026-06-01" },
    { ...source, historyPath: "/private/provider" },
  ]) {
    await assert.rejects(
      parseProtocolResponse(json({ sources: [invalid] }), context),
      /invalid protocol response/,
    );
  }
});

test("protocol v5 usage accepts optional exact gap bounds and rejects half-gaps", async () => {
  const base = {
    acceptedEntries: 0,
    acceptedSnapshots: 1,
    acceptedSourceErrors: 0,
    staleSourceErrors: 0,
    legacySourceErrorsIgnored: 0,
    staleSnapshots: 0,
    sourceSequences: [{ sourceId, lastAcceptedSyncSequence: "8", accepted: true }],
  };
  const context = { kind: "usage", sourceIds: [sourceId], protocolVersion: 5 };
  assert.deepEqual(await parseProtocolResponse(json(base), context), base);
  const withGap = {
    ...base,
    sourceSequences: [
      {
        ...base.sourceSequences[0],
        historyGapRangeStart: "2026-06-01",
        historyGapRangeEnd: "2026-06-14",
      },
    ],
  };
  assert.deepEqual(await parseProtocolResponse(json(withGap), context), withGap);
  await assert.rejects(
    parseProtocolResponse(
      json({
        ...base,
        sourceSequences: [{ ...base.sourceSequences[0], historyGapRangeStart: "2026-06-01" }],
      }),
      context,
    ),
    /invalid protocol response/,
  );
});

test("reconciliation accepts only the matching handler attestation acknowledgement", async () => {
  const attestationId = "34343434-3434-4434-8434-343434343434";
  const sources = [{ sourceId, status: "active", lastAcceptedSyncSequence: "0" }];
  const result = await parseProtocolResponse(
    json({ sources, acceptedHandlerAttestationId: attestationId }),
    { kind: "reconciliation", sourceIds: [sourceId], handlerAttestationId: attestationId },
  );
  assert.equal(result.acceptedHandlerAttestationId, attestationId);
  await assert.rejects(
    parseProtocolResponse(
      json({
        sources,
        acceptedHandlerAttestationId: "35353535-3535-4535-8535-353535353535",
      }),
      { kind: "reconciliation", sourceIds: [sourceId], handlerAttestationId: attestationId },
    ),
    /invalid protocol response/,
  );
});

test("reconciliation accepts only exact requested server bootstrap baselines", async () => {
  const sources = [{ sourceId, status: "active", lastAcceptedSyncSequence: "7" }];
  const sourceBaselines = [
    {
      sourceId,
      acceptedAt: "2026-08-10T12:00:00.000Z",
      entries: [{ date: "2026-08-10", totalTokens: "123" }],
    },
  ];
  const result = await parseProtocolResponse(json({ sources, sourceBaselines }), {
    kind: "reconciliation",
    sourceIds: [sourceId],
    bootstrapSourceIds: [sourceId],
  });
  assert.deepEqual(result.sourceBaselines, sourceBaselines);
  for (const value of [
    { sources },
    { sources, sourceBaselines: [] },
    {
      sources,
      sourceBaselines: [{ ...sourceBaselines[0], acceptedAt: "not-a-date" }],
    },
    {
      sources,
      sourceBaselines: [{ ...sourceBaselines[0], acceptedAt: null }],
    },
    {
      sources,
      sourceBaselines: [
        { ...sourceBaselines[0], entries: [{ date: "2026-08-10", totalTokens: "-1" }] },
      ],
    },
  ])
    await assert.rejects(
      parseProtocolResponse(json(value), {
        kind: "reconciliation",
        sourceIds: [sourceId],
        bootstrapSourceIds: [sourceId],
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

for (const [agentId, collectionMethod] of [
  ["codex", "codex_app_server"],
  ["cursor", "cursor_local_events"],
]) {
  test(`dynamic source registration preserves local ${agentId} profile authority`, async () => {
    const logical = {
      ...local,
      agentId,
      collectionMethod,
      suggestedLabel: "Provider account",
      supportedSurface: "desktop",
      profileClientSourceId: "77777777-7777-4777-8777-777777777777",
      providerAccountKey: `acct1_${"a".repeat(43)}`,
    };
    const response = {
      source: {
        ...mapping({
          clientSourceId: logical.clientSourceId,
          agentId,
          accountLabel: "Codex account 2",
          collectionMethod,
        }),
        profileSourceId: "88888888-8888-4888-8888-888888888888",
      },
    };
    const profile = {
      ...logical,
      clientSourceId: logical.profileClientSourceId,
      profileClientSourceId: undefined,
    };
    const body = sourceRegistrationBody(logical, profile);
    assert.deepEqual(body, {
      agentId,
      collectionMethod,
      clientSourceId: logical.clientSourceId,
      profileClientSourceId: profile.clientSourceId,
      supportedSurface: "desktop",
    });
    for (const forbidden of [logical.dataPath, logical.executablePath, logical.providerAccountKey])
      assert.equal(JSON.stringify(body).includes(forbidden), false);
    for (const patch of [
      { agentId: agentId === "cursor" ? "codex" : "cursor" },
      { collectionMethod: "unknown_method" },
      { supportedSurface: "cli" },
      { clientSourceId: logical.clientSourceId },
      { profileClientSourceId: logical.clientSourceId },
    ])
      assert.throws(() => sourceRegistrationBody(logical, { ...profile, ...patch }), /invalid/);
    for (const patch of [
      { agentId: agentId === "cursor" ? "codex" : "cursor" },
      { collectionMethod: "unknown_method" },
      { profileSourceId: sourceId },
      { providerAccountKey: logical.providerAccountKey },
      { dataPath: logical.dataPath },
    ])
      await assert.rejects(
        parseProtocolResponse(json({ source: { ...response.source, ...patch } }), {
          kind: "sourceRegistration",
          localSource: logical,
          profileClientSourceId: logical.profileClientSourceId,
          profileSourceId: response.source.profileSourceId,
        }),
        /invalid protocol response/,
      );
    const restored = mergeStoredSourceMapping(logical, response.source);
    assert.equal(restored.profileSourceId, response.source.profileSourceId);
    assert.equal(restored.providerAccountKey, logical.providerAccountKey);
    const result = await parseProtocolResponse(json(response), {
      kind: "sourceRegistration",
      localSource: logical,
      profileClientSourceId: logical.profileClientSourceId,
      profileSourceId: response.source.profileSourceId,
    });
    assert.equal(result.source.dataPath, logical.dataPath);
    assert.equal(result.source.providerAccountKey, logical.providerAccountKey);
    const renamed = await parseProtocolResponse(
      json({ source: { ...response.source, accountLabel: "Work" } }),
      {
        kind: "sourceRegistration",
        localSource: logical,
        profileClientSourceId: logical.profileClientSourceId,
        profileSourceId: response.source.profileSourceId,
      },
    );
    assert.equal(renamed.source.accountLabel, "Work");
    await assert.rejects(
      parseProtocolResponse(json({ source: { ...response.source, accountLabel: "Work\u0000" } }), {
        kind: "sourceRegistration",
        localSource: logical,
        profileClientSourceId: logical.profileClientSourceId,
        profileSourceId: response.source.profileSourceId,
      }),
      /invalid protocol response/,
    );
  });
}

test("diagnostic delivery accepts only the exact acknowledged event count", async () => {
  assert.deepEqual(
    await parseProtocolResponse(json({ acceptedEvents: 2 }), {
      kind: "diagnostics",
      expectedEvents: 2,
    }),
    { acceptedEvents: 2 },
  );
  for (const value of [
    { acceptedEvents: 1 },
    { acceptedEvents: 2, sourceId },
    { acceptedEvents: "2" },
  ]) {
    await assert.rejects(
      parseProtocolResponse(json(value), { kind: "diagnostics", expectedEvents: 2 }),
      /invalid protocol response/,
    );
  }
});
