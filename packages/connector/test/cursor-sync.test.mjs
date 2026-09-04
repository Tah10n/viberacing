import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { initializeCursorLedger, recordCursorCapture } from "../lib/cursor-ledger.mjs";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/viberacing.mjs", import.meta.url));
function usageReply(body) {
  const snapshots = body.snapshots ?? [];
  const errors = body.sourceErrors ?? [];
  return {
    acceptedEntries: snapshots.flatMap((s) => s.entries).length,
    acceptedSnapshots: snapshots.length,
    acceptedSourceErrors: errors.length,
    staleSourceErrors: 0,
    legacySourceErrorsIgnored: 0,
    staleSnapshots: 0,
    sourceSequences: [...snapshots, ...errors].map((s) => ({
      sourceId: s.sourceId,
      lastAcceptedSyncSequence: s.syncSequence ?? "0",
      accepted: !!s.syncSequence,
      historyGapRangeStart: null,
      historyGapRangeEnd: null,
    })),
  };
}

test("Cursor sync routes captured A/B/A accounts, retries registration, scopes Browser Sync and keeps provider identity local", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "viberacing-cursor-sync-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateRoot = join(root, "state");
  const original = process.env.VIBERACING_STATE_DIR;
  process.env.VIBERACING_STATE_DIR = stateRoot;
  t.after(() => {
    if (original === undefined) delete process.env.VIBERACING_STATE_DIR;
    else process.env.VIBERACING_STATE_DIR = original;
  });
  const config = await import("../lib/config.mjs");
  const runtime = await import("../lib/runtime.mjs");
  const primarySourceId = randomUUID();
  const primaryAccountId = randomUUID();
  const requestId = randomUUID();
  const registrations = [];
  const usages = [];
  const reports = [];
  const allRequests = [];
  const mappings = new Map();
  const sequences = new Map();
  let failRegistration = true;
  let rejectUsage = false;
  let claimedIds = [primarySourceId];
  const year = new Date().getUTCFullYear();
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (bytes) => chunks.push(bytes));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      allRequests.push({ path: request.url, body });
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/installations/current") {
        response.end(
          JSON.stringify({
            sources: body.sourceIds.map((sourceId) => ({
              sourceId,
              status: "active",
              lastAcceptedSyncSequence: sequences.get(sourceId) ?? "0",
              historyBackfillYear: year,
              historyBackfillStatus: "complete",
              historyGapRangeStart: null,
              historyGapRangeEnd: null,
            })),
          }),
        );
      } else if (request.url === "/api/installations/current/sources/register") {
        registrations.push(body);
        if (failRegistration) {
          failRegistration = false;
          response.statusCode = 503;
          response.end(JSON.stringify({ error: "server_error" }));
          return;
        }
        if (!mappings.has(body.clientSourceId))
          mappings.set(body.clientSourceId, { sourceId: randomUUID(), accountId: randomUUID() });
        const mapping = mappings.get(body.clientSourceId);
        response.end(
          JSON.stringify({
            source: {
              clientSourceId: body.clientSourceId,
              sourceId: mapping.sourceId,
              agentAccountId: mapping.accountId,
              agentId: "cursor",
              accountLabel: `Cursor account ${mappings.size + 1}`,
              collectionMethod: "cursor_local_events",
              lastAcceptedSyncSequence: sequences.get(mapping.sourceId) ?? "0",
              historyBackfillYear: year,
              historyBackfillStatus: "pending",
              profileSourceId: primarySourceId,
            },
          }),
        );
      } else if (request.url === "/api/usage") {
        usages.push(body);
        if (rejectUsage && body.snapshots?.length) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: "invalid_payload" }));
          return;
        }
        for (const snapshot of body.snapshots ?? [])
          sequences.set(snapshot.sourceId, snapshot.syncSequence);
        response.end(JSON.stringify(usageReply(body)));
      } else if (request.url === "/api/installations/current/diagnostics") {
        response.end(JSON.stringify({ acceptedEvents: body.events.length }));
      } else if (request.url === "/api/installations/current/sync/claim") {
        response.end(JSON.stringify({ requestId, sourceIds: claimedIds }));
      } else if (request.url === "/api/installations/current/sync/result") {
        reports.push(body);
        response.statusCode = 204;
        response.end();
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "not_found" }));
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const installation = await config.readOrCreateInstallation();
  const profileRoot = join(root, "cursor");
  await mkdir(profileRoot, { mode: 0o700 });
  const { source } = await config.addSource({
    agentId: "cursor",
    collectionMethod: "cursor_local_events",
    supportedSurface: "desktop",
    suggestedLabel: "Cursor",
    dataPath: profileRoot,
  });
  await config.writeConfig({
    version: 2,
    origin,
    installationId: installation.id,
    deviceToken: "synthetic-device-token",
    sources: [
      {
        ...source,
        sourceId: primarySourceId,
        agentAccountId: primaryAccountId,
        accountLabel: "Cursor account 1",
      },
    ],
  });
  const salt = await config.readOrCreateProviderIdentitySalt();
  const now = new Date().toISOString();
  await initializeCursorLedger(stateRoot, source.clientSourceId, now);
  const environment = {
    ...process.env,
    HOME: join(root, "home"),
    USERPROFILE: join(root, "home"),
    VIBERACING_STATE_DIR: stateRoot,
    NODE_ENV: "test",
    VIBERACING_TEST_MAX_HISTORY_CHUNKS: "1",
    VIBERACING_TEST_AUTOMATIC_SYNC_TIMINGS: "5,5,20",
  };
  const outputs = [];
  async function run(...args) {
    const output = await exec(process.execPath, [cli, ...args], {
      env: environment,
      // Native Windows ACL validation launches PowerShell for durable filesystem operations.
      timeout: process.platform === "win32" ? 120_000 : 30_000,
    });
    outputs.push(output);
    return output;
  }
  async function record(account, generation, input, version = "3.19.7") {
    return recordCursorCapture(stateRoot, source.clientSourceId, {
      kind: "stop",
      salt,
      capturedAt: new Date().toISOString(),
      payload: {
        hook_event_name: "stop",
        cursor_version: version,
        status: "completed",
        user_email: `${account}@canary-private.test`,
        generation_id: generation,
        session_id: `canary-session-${account}`,
        input_tokens: input,
        output_tokens: 2,
        cache_read_tokens: 3,
        cache_write_tokens: 4,
        prompt: "canary-prompt",
        response: "canary-response",
        tool_arguments: "canary-tool",
        code: "canary-source-code",
        repository: "canary-repository",
        cwd: "/canary-absolute-path",
        account_id: "canary-account-id",
        access_token: "canary-token",
        api_key: "canary-api-key",
        model: "canary-model",
        cost: "canary-cost",
      },
    });
  }
  function rollingSince(index) {
    return usages
      .slice(index)
      .flatMap((body) => body.snapshots ?? [])
      .filter((s) => s.kind === "rolling");
  }
  function total(snapshot) {
    return snapshot.entries.reduce((sum, entry) => sum + BigInt(entry.totalTokens), 0n).toString();
  }
  await record("A", "canary-generation-a1", 10);
  await run("sync");
  assert.equal(registrations.length, 0);
  assert.equal(total(rollingSince(0)[0]), "19");
  assert.equal(rollingSince(0)[0].completeness, "partial");
  const boundA = (await config.readSources())[0];
  assert.match(boundA.providerAccountKey, /^acct1_/);

  await record("B", "canary-generation-b1", 100, "2026.09.02-c22c1a3");
  await runtime.markDirty(source.clientSourceId);
  let before = usages.length;
  assert.match((await run("sync")).stderr, /provider_account_registration_pending/);
  assert.deepEqual(
    rollingSince(before).map((s) => s.sourceId),
    [primarySourceId],
  );
  assert.ok((await runtime.readDirty()).sources[source.clientSourceId]);
  const pendingB = (await config.readSources())[1];
  assert.equal(pendingB.profileClientSourceId, source.clientSourceId);

  await record("A", "canary-generation-a2", 20);
  before = usages.length;
  await run("sync");
  assert.equal(registrations.length, 2);
  assert.equal(registrations[0].clientSourceId, registrations[1].clientSourceId);
  assert.equal(registrations[1].clientSourceId, pendingB.clientSourceId);
  const secondary = mappings.get(pendingB.clientSourceId);
  assert.deepEqual(
    new Map(rollingSince(before).map((s) => [s.sourceId, total(s)])),
    new Map([
      [primarySourceId, "48"],
      [secondary.sourceId, "109"],
    ]),
  );
  assert.equal((await config.readSources())[0].providerAccountKey, boundA.providerAccountKey);
  assert.equal(await runtime.readDirty(), null);

  await runtime.markDirty(source.clientSourceId);
  const dirtyBefore = await readFile(join(stateRoot, "dirty.json"), "utf8");
  claimedIds = [secondary.sourceId];
  before = usages.length;
  await run(
    "handle-url",
    `viberacing://sync?requestId=${requestId}&accountId=${secondary.accountId}&grant=${"g".repeat(32)}`,
  );
  assert.deepEqual(
    rollingSince(before).map((s) => s.sourceId),
    [secondary.sourceId],
  );
  assert.equal(await readFile(join(stateRoot, "dirty.json"), "utf8"), dirtyBefore);
  assert.equal(reports.at(-1).status, "succeeded");

  // A newly captured account is included even though the installation claim predates registration.
  await record("C", "canary-generation-c1", 1000);
  claimedIds = [primarySourceId, secondary.sourceId];
  before = usages.length;
  await run(
    "handle-url",
    `viberacing://sync?requestId=${requestId}&scope=installation&grant=${"g".repeat(32)}`,
  );
  assert.equal(rollingSince(before).length, 3);
  assert.deepEqual(rollingSince(before).map(total).sort(), ["1009", "109", "48"]);
  assert.equal(await runtime.readDirty(), null);
  assert.equal(reports.at(-1).status, "succeeded");

  await record("A", "canary-generation-a2", 20); // Durable replay is numerically idempotent.
  before = usages.length;
  await run("sync", "--full");
  assert.equal(total(rollingSince(before).find((s) => s.sourceId === primarySourceId)), "48");
  assert.equal((await config.readSources()).length, 3);
  assert.equal(registrations.length, 3);
  await record("B", "canary-generation-b2", 200);
  await runtime.markDirty(source.clientSourceId);
  before = usages.length;
  await run("auto-sync", "--quiet");
  const automatic = rollingSince(before);
  assert.equal(
    total(automatic.find((snapshot) => snapshot.sourceId === secondary.sourceId)),
    "318",
  );
  assert.equal(await runtime.readDirty(), null);
  assert.equal(registrations.length, 3);
  // A known logical source without its account in the available ledger cannot borrow B's usage.
  const missing = await config.bindProviderAccount(
    "cursor",
    source.clientSourceId,
    `acct1_${"d".repeat(43)}`,
  );
  const missingSourceId = randomUUID();
  const missingAccountId = randomUUID();
  const configured = await config.readConfig();
  await config.writeConfig({
    ...configured,
    sources: [
      ...configured.sources,
      {
        ...missing.source,
        sourceId: missingSourceId,
        agentAccountId: missingAccountId,
        accountLabel: "Cursor account 4",
        profileSourceId: primarySourceId,
      },
    ],
  });
  await runtime.markDirty(source.clientSourceId);
  claimedIds = [missingSourceId];
  before = usages.length;
  await run(
    "handle-url",
    `viberacing://sync?requestId=${requestId}&accountId=${missingAccountId}&grant=${"g".repeat(32)}`,
  );
  assert.equal(usages.length, before);
  assert.equal(reports.at(-1).resultCode, "account_not_active");
  assert.ok((await runtime.readDirty()).sources[source.clientSourceId]);
  claimedIds = [primarySourceId, ...mappings.values()]
    .map((item) => (typeof item === "string" ? item : item.sourceId))
    .concat(missingSourceId);
  before = usages.length;
  await run(
    "handle-url",
    `viberacing://sync?requestId=${requestId}&scope=installation&grant=${"g".repeat(32)}`,
  );
  assert.equal(
    rollingSince(before).some((snapshot) => snapshot.sourceId === missingSourceId),
    false,
  );
  assert.equal(rollingSince(before).length, 3);
  assert.equal(reports.at(-1).resultCode, "partial_accounts_inactive");
  // Reset creates new server sources, while historical source_sum rows remain on the server.
  // Re-pairing must send only events not already reserved to an earlier server source.
  const oldConfig = await config.readConfig();
  await config.resetInstallation();
  const replacementInstallation = await config.readOrCreateInstallation();
  const replacementPrimary = randomUUID();
  const replacementSources = oldConfig.sources
    .filter((item) => item.sourceId !== missingSourceId)
    .map((item) => ({
      ...item,
      sourceId: item.sourceId === primarySourceId ? replacementPrimary : randomUUID(),
      ...(item.profileSourceId ? { profileSourceId: replacementPrimary } : {}),
      lastAcceptedSyncSequence: "0",
    }));
  await config.writeConfig({
    ...oldConfig,
    installationId: replacementInstallation.id,
    sources: replacementSources,
  });
  before = usages.length;
  await run("sync", "--full");
  assert.equal(rollingSince(before).length, 3);
  assert.ok(rollingSince(before).every((snapshot) => total(snapshot) === "0"));
  await record("A", "canary-generation-a3", 30);
  before = usages.length;
  await run("sync", "--full");
  assert.equal(
    total(rollingSince(before).find((snapshot) => snapshot.sourceId === replacementPrimary)),
    "39",
  );
  assert.equal((await config.readSources())[0].providerAccountKey, boundA.providerAccountKey);
  // Summing the last snapshot from each physical server source gives each event exactly once.
  const lastBySource = new Map(
    rollingSince(0).map((snapshot) => [snapshot.sourceId, total(snapshot)]),
  );
  assert.equal(
    BigInt(lastBySource.get(primarySourceId)) + BigInt(lastBySource.get(replacementPrimary)),
    87n,
  );
  rejectUsage = true;
  await record("A", "canary-generation-rejected", 40);
  assert.match((await run("sync")).stderr, /payload quarantined/);
  const quarantine = join(stateRoot, "pending", "quarantine");
  const quarantined = await readdir(quarantine);
  assert.ok(quarantined.some((file) => file.endsWith(".json")));
  for (const file of quarantined)
    if (file.endsWith(".json"))
      assert.doesNotMatch(
        await readFile(join(quarantine, file), "utf8"),
        /canary-|acct1_|alias1_|evt1_/,
      );
  for (const body of registrations)
    assert.deepEqual(Object.keys(body).sort(), [
      "agentId",
      "clientSourceId",
      "collectionMethod",
      "profileClientSourceId",
      "supportedSurface",
    ]);
  assert.doesNotMatch(JSON.stringify({ allRequests, outputs }), /canary-|acct1_|alias1_|evt1_/);
  assert.doesNotMatch(
    JSON.stringify(allRequests),
    /cursorAcknowledgements|eventOwners|checkpoint|proof\.json/,
  );
  for (const file of [
    "sources.json",
    "installation.json",
    ...(await readdir(join(stateRoot, "captures")))
      .filter((name) => name.endsWith(".jsonl") || name.endsWith(".proof.json"))
      .map((name) => join("captures", name)),
  ])
    assert.doesNotMatch(await readFile(join(stateRoot, file), "utf8"), /canary-/);
  assert.doesNotMatch(
    await readFile(join(stateRoot, "config.json"), "utf8"),
    /canary-|acct1_|alias1_|evt1_/,
  );
  assert.doesNotMatch(
    await readFile(join(stateRoot, "state.json"), "utf8"),
    /canary-|acct1_|alias1_|evt1_/,
  );
  for (const file of await readdir(join(stateRoot, "pending"))) {
    if (file.endsWith(".json"))
      assert.doesNotMatch(
        await readFile(join(stateRoot, "pending", file), "utf8"),
        /canary-|acct1_|alias1_|evt1_/,
      );
  }
});
