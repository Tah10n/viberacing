import { createHash, randomBytes, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createRequire } from "node:module";

const requireFromWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const pg = requireFromWeb("pg");
const { Pool } = pg;
const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://viberacing:viberacing@127.0.0.1:55432/viberacing";
const appUrl = process.env.VIBERACING_TEST_ORIGIN ?? "http://127.0.0.1:3000";
const browserOrigin = new URL(process.env.VIBERACING_PUBLIC_ORIGIN ?? "http://localhost:3000")
  .origin;
const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const digest = (value) => createHash("sha256").update(value, "utf8").digest();
const token = () => randomBytes(32).toString("base64url");
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const today = new Date().toISOString().slice(0, 10);
const dateOffset = (days) => {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const yesterdayDate = new Date(`${today}T00:00:00Z`);
yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
const yesterday = yesterdayDate.toISOString().slice(0, 10);
const tooOldDate = new Date(`${today}T00:00:00Z`);
tooOldDate.setUTCDate(tooOldDate.getUTCDate() - 31);
const tooOld = tooOldDate.toISOString().slice(0, 10);
const tomorrowDate = new Date(`${today}T00:00:00Z`);
tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
const tomorrow = tomorrowDate.toISOString().slice(0, 10);
const sessionToken = token();
const handle = `local-test-${randomBytes(5).toString("hex")}`;
const githubId = 800_000_000_000_000_000n + BigInt(`0x${randomBytes(7).toString("hex")}`);
let userId;

async function json(path, body, headers = {}) {
  return fetch(`${appUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    redirect: "manual",
  });
}

async function form(path, body) {
  return fetch(`${appUrl}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: `vr_session=${sessionToken}`,
      origin: browserOrigin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
}

async function authenticatedGet(path) {
  return fetch(`${appUrl}${path}`, {
    headers: { cookie: `vr_session=${sessionToken}` },
    redirect: "manual",
  });
}

const definitions = {
  codex: ["codex_app_server", "desktop"],
  claude_code: ["claude_jsonl", "cli"],
  opencode: ["opencode_sqlite", "cli"],
  kimi_code: ["kimi_wire_jsonl", "cli"],
};

function source(clientSourceId, agentId) {
  return {
    clientSourceId,
    agentId,
    collectionMethod: definitions[agentId][0],
    supportedSurface: definitions[agentId][1],
    suggestedLabel: agentId,
  };
}

async function beginPairing(installation, sources, supersededClientSourceIds = []) {
  const response = await json(
    "/api/pairing/start",
    {
      protocolVersion: 2,
      connectorVersion: "0.2.0",
      installationId: installation.id,
      installationSecret: installation.secret,
      sources,
      supersededClientSourceIds,
    },
    { "x-real-ip": `127.0.0.${Math.floor(Math.random() * 200) + 2}` },
  );
  if (response.status !== 201)
    throw new Error(`pairing start failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function submitPairingApproval(pairing, selections = {}) {
  const pending = await pool.query(
    "SELECT id::text, client_source_id FROM installation_sources WHERE installation_id = $1 AND pending_pairing_code_hash = $2 AND NOT pending_disconnect ORDER BY created_at, id",
    [pairing.installationId, digest(pairing.code)],
  );
  const body = { code: pairing.code };
  for (const row of pending.rows) {
    const selected = selections[row.client_source_id] ?? "new";
    body[`account_${row.id}`] = selected;
    body[`label_${row.id}`] = `${row.client_source_id} account`;
  }
  return { approval: await form("/api/pairing/approve", body), pending };
}

async function approvePairing(pairing, selections) {
  const { approval, pending } = await submitPairingApproval(pairing, selections);
  check(approval.status === 303, `pairing approval failed: ${approval.status}`);
  const polled = await json("/api/pairing/poll", {
    installationId: pairing.installationId,
    pollToken: pairing.pollToken,
  });
  check(polled.status === 200, `pairing poll failed: ${polled.status}`);
  const result = await polled.json();
  check(
    result.status === "active" && result.sources.length === pending.rows.length,
    "pairing result was incomplete",
  );
  return result;
}

async function pair(installation, sources, selections = {}, supersededClientSourceIds = []) {
  return approvePairing(
    await beginPairing(installation, sources, supersededClientSourceIds),
    selections,
  );
}

async function usage(deviceToken, snapshots, sourceErrors = []) {
  return json(
    "/api/usage",
    { protocolVersion: 2, snapshots, sourceErrors },
    { authorization: `Bearer ${deviceToken}` },
  );
}

function rawUsage(deviceToken, snapshots, sourceErrors = []) {
  const payload = Buffer.from(JSON.stringify({ protocolVersion: 2, snapshots, sourceErrors }));
  const target = new URL("/api/usage", appUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      target,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${deviceToken}`,
          "content-length": payload.length,
          "content-type": "application/json",
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    request.on("error", reject);
    request.end(payload);
  });
}

function snapshot(
  sourceId,
  sequence,
  entries,
  completeness = "complete",
  start = yesterday,
  end = today,
) {
  return {
    sourceId,
    syncSequence: String(sequence),
    rangeStart: start,
    rangeEnd: end,
    completeness,
    entries: entries.map(([date, totalTokens]) => ({ date, totalTokens: String(totalTokens) })),
  };
}

try {
  const inserted = await pool.query(
    "INSERT INTO users (github_id, handle) VALUES ($1, $2) RETURNING id::text",
    [githubId.toString(), handle],
  );
  userId = inserted.rows[0].id;
  await pool.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
    [digest(sessionToken), userId],
  );
  const duplicate = await pool.query(
    "INSERT INTO users (github_id, handle) VALUES ($1, $2) ON CONFLICT (github_id) DO UPDATE SET handle = EXCLUDED.handle RETURNING id::text",
    [githubId.toString(), handle],
  );
  check(duplicate.rows[0].id === userId, "one GitHub ID created multiple users");
  console.log("ok - GitHub identity is unique");

  const firstInstallation = { id: randomUUID(), secret: token() };
  const first = await pair(firstInstallation, [
    source("codex-personal-a", "codex"),
    source("codex-work", "codex"),
    source("claude-personal", "claude_code"),
    source("opencode-personal", "opencode"),
  ]);
  check(
    new Set(first.sources.map((item) => item.agentAccountId)).size === 4,
    "multiple accounts were not created",
  );
  check(
    first.sources.every((item) => item.lastAcceptedSyncSequence === "0"),
    "pairing poll omitted the initial server sequence",
  );
  console.log("ok - one pairing maps multiple agents and two Codex sources to separate accounts");

  const byClient = new Map(first.sources.map((item) => [item.clientSourceId, item]));
  const secondInstallation = { id: randomUUID(), secret: token() };
  const secondPairing = await beginPairing(secondInstallation, [
    source("codex-personal-b", "codex"),
    source("claude-work", "claude_code"),
  ]);
  const second = await approvePairing(secondPairing, {
    "codex-personal-b": byClient.get("codex-personal-a").agentAccountId,
    "claude-work": "new",
  });
  const secondByClient = new Map(second.sources.map((item) => [item.clientSourceId, item]));

  const initial = await usage(first.deviceToken, [
    snapshot(byClient.get("codex-personal-a").sourceId, 1, [[today, 100]]),
    snapshot(byClient.get("codex-work").sourceId, 1, [[today, 40]]),
    snapshot(byClient.get("claude-personal").sourceId, 1, [[today, 30]]),
    snapshot(byClient.get("opencode-personal").sourceId, 1, [[today, 7]]),
  ]);
  check(initial.status === 200, `first usage batch failed: ${initial.status}`);
  const secondUsage = await usage(second.deviceToken, [
    snapshot(secondByClient.get("codex-personal-b").sourceId, 1, [[today, 80]]),
    snapshot(secondByClient.get("claude-work").sourceId, 1, [[today, 20]]),
  ]);
  if (secondUsage.status !== 200)
    throw new Error(`second usage batch failed: ${secondUsage.status} ${await secondUsage.text()}`);
  const totals = await pool.query(
    "SELECT agent_id, tokens::text FROM weekly_agent_usage WHERE user_id = $1 ORDER BY agent_id",
    [userId],
  );
  check(
    JSON.stringify(totals.rows) ===
      JSON.stringify([
        { agent_id: "claude_code", tokens: "50" },
        { agent_id: "codex", tokens: "140" },
        { agent_id: "opencode", tokens: "7" },
      ]),
    `aggregation mismatch: ${JSON.stringify(totals.rows)}`,
  );
  console.log(
    "ok - account_max, source_sum, multiple accounts, and multiple agents aggregate correctly",
  );

  const previousWeek = dateOffset(-7);
  const concurrentWeeklyUpdates = await Promise.all([
    usage(first.deviceToken, [
      snapshot(
        byClient.get("claude-personal").sourceId,
        2,
        [[previousWeek, 31]],
        "complete",
        previousWeek,
        previousWeek,
      ),
    ]),
    usage(second.deviceToken, [
      snapshot(
        secondByClient.get("claude-work").sourceId,
        2,
        [[previousWeek, 23]],
        "complete",
        previousWeek,
        previousWeek,
      ),
    ]),
  ]);
  const concurrentClaudeSummary = await pool.query(
    "SELECT tokens::text FROM weekly_agent_usage WHERE user_id = $1 AND agent_id = 'claude_code' AND week_start = date_trunc('week', $2::date)::date",
    [userId, previousWeek],
  );
  check(
    concurrentWeeklyUpdates.every((item) => item.status === 200) &&
      concurrentClaudeSummary.rows[0]?.tokens === "54",
    `concurrent weekly summary update was lost: ${JSON.stringify({
      statuses: concurrentWeeklyUpdates.map((item) => item.status),
      summary: concurrentClaudeSummary.rows[0]?.tokens,
    })}`,
  );
  console.log("ok - concurrent usage from two installations preserves the weekly summary");

  const orderClient = await pool.connect();
  let orderedUsage;
  try {
    await orderClient.query("BEGIN");
    await orderClient.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
    orderedUsage = rawUsage(
      first.deviceToken,
      [],
      [{ sourceId: byClient.get("claude-personal").sourceId, code: "collector_failed" }],
    );
    let waitingForUser = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const waiting = await pool.query(
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FROM users%' AND query LIKE '%FOR UPDATE%'",
      );
      if ((waiting.rows[0]?.count ?? 0) > 0) {
        waitingForUser = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    check(waitingForUser, "usage did not acquire the user lock before child rows");
    await orderClient.query("SET LOCAL lock_timeout = '1s'");
    await orderClient.query("SELECT id FROM installations WHERE id = $1 FOR UPDATE", [
      firstInstallation.id,
    ]);
    await orderClient.query("COMMIT");
    check((await orderedUsage).status === 200, "ordered usage request failed after lock release");
  } finally {
    await orderClient.query("ROLLBACK").catch(() => {});
    orderClient.release();
    if (orderedUsage) await orderedUsage.catch(() => {});
  }
  console.log("ok - usage and browser mutations share user-first lock ordering");

  const target = byClient.get("codex-work").sourceId;
  const lockClient = await pool.connect();
  const replacementDeviceToken = token();
  try {
    await lockClient.query("BEGIN");
    await lockClient.query("SELECT id FROM installations WHERE id = $1 FOR UPDATE", [
      firstInstallation.id,
    ]);
    const racingUsage = rawUsage(
      first.deviceToken,
      [],
      [{ sourceId: target, code: "collector_failed" }],
    );
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const waiting = await pool.query(
        "SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FROM installations%' AND query LIKE '%FOR UPDATE%'",
      );
      if ((waiting.rows[0]?.count ?? 0) > 0) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    check(blocked, "usage request did not reach the locked authentication boundary");
    await lockClient.query("UPDATE installations SET device_token_hash = $2 WHERE id = $1", [
      firstInstallation.id,
      digest(replacementDeviceToken),
    ]);
    await lockClient.query("COMMIT");
    const raced = await racingUsage;
    check(
      raced.status === 401,
      `old token crossed concurrent rotation boundary: ${raced.status} ${raced.body}`,
    );
    first.deviceToken = replacementDeviceToken;
  } catch (error) {
    await lockClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    lockClient.release();
  }
  console.log("ok - token hash is rechecked under the ingestion row lock");

  let diagnostic = await usage(
    first.deviceToken,
    [],
    [{ sourceId: target, code: "collector_failed" }],
  );
  check(diagnostic.status === 200, "source diagnostic update failed");
  let diagnosticRow = await pool.query(
    "SELECT last_error_summary FROM installation_sources WHERE id = $1",
    [target],
  );
  check(
    diagnosticRow.rows[0]?.last_error_summary === "Collector failed",
    "source diagnostic was not persisted",
  );
  let response = await usage(first.deviceToken, [
    snapshot(target, 2, [
      [yesterday, 50],
      [today, 35],
    ]),
  ]);
  check(response.status === 200, "complete correction failed");
  diagnosticRow = await pool.query(
    "SELECT last_error_summary FROM installation_sources WHERE id = $1",
    [target],
  );
  check(diagnosticRow.rows[0]?.last_error_summary === null, "successful sync did not clear error");
  console.log("ok - safe source diagnostics persist and clear after a successful snapshot");
  response = await usage(first.deviceToken, [snapshot(target, 2, [[today, 999]])]);
  const staleBody = await response.json();
  check(
    response.status === 200 &&
      staleBody.staleSnapshots === 1 &&
      staleBody.sourceSequences[0]?.lastAcceptedSyncSequence === "2" &&
      staleBody.sourceSequences[0]?.accepted === false,
    "same sequence was not idempotent",
  );
  const currentInstallation = await fetch(`${appUrl}/api/installations/current`, {
    headers: { authorization: `Bearer ${first.deviceToken}` },
  });
  const currentInstallationBody = await currentInstallation.json();
  check(
    currentInstallation.status === 200 &&
      currentInstallationBody.sources.find((item) => item.sourceId === target)
        ?.lastAcceptedSyncSequence === "2",
    "current installation response omitted the accepted server sequence",
  );
  response = await usage(first.deviceToken, [snapshot(target, 1, [[today, 999]])]);
  check(response.status === 200, "stale request failed unexpectedly");
  response = await usage(first.deviceToken, [snapshot(target, 3, [[today, 25]], "partial")]);
  check(response.status === 200, "partial correction failed");
  let rows = await pool.query(
    "SELECT usage_date::text, total_tokens::text FROM daily_usage WHERE source_id = $1 ORDER BY usage_date",
    [target],
  );
  check(
    rows.rows.length === 2 && rows.rows[1].total_tokens === "35",
    "partial snapshot deleted an absent date or decreased a previously exact day",
  );
  response = await usage(first.deviceToken, [snapshot(target, 4, [[today, 20]])]);
  check(response.status === 200, "final complete correction failed");
  rows = await pool.query(
    "SELECT usage_date::text, total_tokens::text FROM daily_usage WHERE source_id = $1 ORDER BY usage_date",
    [target],
  );
  check(
    rows.rows.length === 1 && rows.rows[0].total_tokens === "20",
    "complete snapshot did not delete absent dates",
  );
  const correctedSummary = await pool.query(
    "SELECT tokens::text FROM weekly_agent_usage WHERE user_id = $1 AND agent_id = 'codex' AND week_start = date_trunc('week', current_date)::date",
    [userId],
  );
  check(
    correctedSummary.rows[0]?.tokens === "120",
    "weekly summary did not decrease after correction",
  );
  console.log(
    "ok - snapshots decrease values and weekly summaries, reject stale writes, and distinguish complete from partial",
  );

  const randomSource = randomUUID();
  const future = await usage(first.deviceToken, [
    snapshot(target, 5, [[tomorrow, 1]], "complete", tomorrow, tomorrow),
  ]);
  const old = await usage(first.deviceToken, [
    snapshot(target, 5, [[tooOld, 1]], "complete", tooOld, tooOld),
  ]);
  const unsupported = await usage(first.deviceToken, [snapshot(randomSource, 1, [[today, 1]])]);
  const excessive = await usage(first.deviceToken, [
    snapshot(target, 5, [[today, "10000000000000000"]]),
  ]);
  check(
    future.status === 400 &&
      old.status === 400 &&
      unsupported.status === 400 &&
      excessive.status === 400,
    "usage bounds were not enforced",
  );
  console.log("ok - date, source, and technical token bounds are enforced");

  const bulkSource = byClient.get("opencode-personal").sourceId;
  const bulkEntries = Array.from({ length: 31 }, (_, index) => [dateOffset(index - 30), index + 1]);
  response = await usage(first.deviceToken, [
    snapshot(bulkSource, 2, bulkEntries, "complete", dateOffset(-30), today),
  ]);
  check(
    response.status === 200 && (await response.json()).acceptedEntries === 31,
    "large bulk snapshot failed",
  );
  response = await usage(first.deviceToken, [
    snapshot(bulkSource, 3, [[today, 7]], "complete", dateOffset(-30), today),
  ]);
  const restoredBulk = await pool.query(
    "SELECT count(*)::int AS count, sum(total_tokens)::text AS tokens FROM daily_usage WHERE source_id = $1",
    [bulkSource],
  );
  check(
    response.status === 200 &&
      restoredBulk.rows[0].count === 1 &&
      restoredBulk.rows[0].tokens === "7",
    "bulk complete replacement did not remove missing dates",
  );
  console.log("ok - 31-day snapshots use bulk upsert/delete and remain correctable");

  const mondayDate = new Date(`${today}T00:00:00Z`);
  mondayDate.setUTCDate(mondayDate.getUTCDate() - ((mondayDate.getUTCDay() + 6) % 7));
  const monday = mondayDate.toISOString().slice(0, 10);
  const sundayDate = new Date(mondayDate);
  sundayDate.setUTCDate(sundayDate.getUTCDate() - 1);
  const sunday = sundayDate.toISOString().slice(0, 10);
  response = await usage(first.deviceToken, [
    snapshot(
      bulkSource,
      4,
      [
        [sunday, 11],
        [monday, 13],
      ],
      "complete",
      sunday,
      monday,
    ),
  ]);
  check(response.status === 200, "UTC week-boundary snapshot failed");
  const boundary = await pool.query(
    "SELECT week_start::text, tokens::text FROM weekly_agent_usage WHERE user_id = $1 AND agent_id = 'opencode' AND week_start IN ($2::date - 7, $2::date) ORDER BY week_start",
    [userId, monday],
  );
  check(
    boundary.rows.length === 2 &&
      boundary.rows[0].tokens === "11" &&
      boundary.rows[1].tokens === (today === monday ? "13" : "20"),
    `UTC week aggregation mismatch: ${JSON.stringify(boundary.rows)}`,
  );
  response = await usage(first.deviceToken, [
    snapshot(bulkSource, 5, [[today, 7]], "complete", sunday, today),
  ]);
  check(response.status === 200, "UTC boundary cleanup failed");
  console.log("ok - UTC Sunday/Monday usage lands in separate weekly summaries");

  const reconnectSources = [
    source("codex-personal-a", "codex"),
    source("codex-work", "codex"),
    source("claude-personal", "claude_code"),
    source("opencode-personal", "opencode"),
  ];
  const abandoned = await beginPairing(firstInstallation, reconnectSources);
  await pool.query(
    "UPDATE installations SET pairing_expires_at = now() - interval '1 second' WHERE id = $1",
    [firstInstallation.id],
  );
  response = await usage(first.deviceToken, [snapshot(target, 5, [[today, 20]])]);
  const activeDuringReconnect = await pool.query(
    "SELECT count(*)::int AS count FROM installation_sources WHERE installation_id = $1 AND status = 'active'",
    [firstInstallation.id],
  );
  check(
    response.status === 200 && activeDuringReconnect.rows[0].count === reconnectSources.length,
    `abandoned reconnect disabled active sources (${abandoned.code})`,
  );
  console.log("ok - abandoned reconnect leaves the current token and sources usable");

  const oldDeviceToken = first.deviceToken;
  const reconnectAssignments = Object.fromEntries(
    first.sources.map((item) => [item.clientSourceId, item.agentAccountId]),
  );
  reconnectAssignments["codex-work"] = byClient.get("codex-personal-a").agentAccountId;
  const reconnect = await pair(firstInstallation, reconnectSources, reconnectAssignments);
  check(reconnect.deviceToken !== oldDeviceToken, "device token did not rotate");
  const rejectedOldToken = await usage(oldDeviceToken, [snapshot(target, 6, [[today, 1]])]);
  check(rejectedOldToken.status === 401, "old device token remained usable");
  const installationCount = await pool.query(
    "SELECT count(*)::int AS count FROM installations WHERE id = $1 AND user_id = $2",
    [firstInstallation.id, userId],
  );
  const history = await pool.query(
    "SELECT count(*)::int AS count FROM daily_usage WHERE source_id = $1",
    [target],
  );
  check(
    installationCount.rows[0].count === 1 && history.rows[0].count === 1,
    "reconnect duplicated installation or lost history",
  );
  let pairingSummary = await pool.query(
    "SELECT tokens::text FROM weekly_agent_usage WHERE user_id = $1 AND agent_id = 'codex' AND week_start = date_trunc('week', current_date)::date",
    [userId],
  );
  check(
    pairingSummary.rows[0]?.tokens === "100",
    "pairing reassignment did not immediately collapse account_max summaries",
  );
  console.log(
    "ok - reconnect preserves identity/history, rotates authorization, and immediately rebuilds reassigned summaries",
  );

  const migratedKimiClientId = "kimi-legacy-migrated";
  const withMigratedKimi = await pair(
    firstInstallation,
    [...reconnectSources, source(migratedKimiClientId, "kimi_code")],
    reconnectAssignments,
  );
  const migratedKimi = withMigratedKimi.sources.find(
    (item) => item.clientSourceId === migratedKimiClientId,
  );
  check(migratedKimi !== undefined, "migrated Kimi source was not paired");
  response = await usage(withMigratedKimi.deviceToken, [
    snapshot(migratedKimi.sourceId, 1, [[today, 41]]),
  ]);
  check(response.status === 200, "migrated Kimi usage was not accepted");
  const abandonedKimiMigration = await beginPairing(firstInstallation, reconnectSources, [
    migratedKimiClientId,
  ]);
  await pool.query(
    "UPDATE installations SET pairing_expires_at = now() - interval '1 second' WHERE id = $1",
    [firstInstallation.id],
  );
  response = await usage(withMigratedKimi.deviceToken, [
    snapshot(migratedKimi.sourceId, 2, [[today, 43]]),
  ]);
  const activeLegacyKimi = await pool.query(
    `SELECT s.status, d.total_tokens::text
       FROM installation_sources s
       JOIN daily_usage d ON d.source_id = s.id AND d.usage_date = $2
      WHERE s.id = $1`,
    [migratedKimi.sourceId, today],
  );
  check(
    response.status === 200 &&
      activeLegacyKimi.rows[0]?.status === "active" &&
      activeLegacyKimi.rows[0]?.total_tokens === "43",
    `abandoned Kimi migration changed the active legacy source (${abandonedKimiMigration.code})`,
  );
  const afterKimiMigration = await pair(firstInstallation, reconnectSources, reconnectAssignments, [
    migratedKimiClientId,
  ]);
  const retiredKimi = await pool.query(
    `SELECT s.status,
            (SELECT count(*)::int FROM daily_usage d WHERE d.source_id = s.id) AS usage_rows
       FROM installation_sources s
      WHERE s.id = $1`,
    [migratedKimi.sourceId],
  );
  const kimiSummary = await pool.query(
    "SELECT count(*)::int AS count FROM weekly_agent_usage WHERE user_id = $1 AND agent_id = 'kimi_code'",
    [userId],
  );
  check(
    afterKimiMigration.sources.length === reconnectSources.length &&
      retiredKimi.rows[0]?.status === "disconnected" &&
      retiredKimi.rows[0]?.usage_rows === 0 &&
      kimiSummary.rows[0].count === 0,
    "superseded Kimi source remained active or retained duplicated ranking history",
  );
  console.log("ok - approved Kimi migration retires the legacy mapping and duplicated history");

  const concurrent = await Promise.all([
    beginPairing(firstInstallation, reconnectSources),
    beginPairing(firstInstallation, reconnectSources),
  ]);
  const currentCode = await pool.query(
    "SELECT pairing_code_hash FROM installations WHERE id = $1",
    [firstInstallation.id],
  );
  const winner = concurrent.find((item) =>
    digest(item.code).equals(currentCode.rows[0].pairing_code_hash),
  );
  const finalReconnect = await approvePairing(
    winner,
    Object.fromEntries(first.sources.map((item) => [item.clientSourceId, item.agentAccountId])),
  );
  const countAfterConcurrent = await pool.query(
    "SELECT count(*)::int AS count FROM installations WHERE id = $1",
    [firstInstallation.id],
  );
  check(countAfterConcurrent.rows[0].count === 1, "concurrent reconnect created a duplicate");
  pairingSummary = await pool.query(
    "SELECT tokens::text FROM weekly_agent_usage WHERE user_id = $1 AND agent_id = 'codex' AND week_start = date_trunc('week', current_date)::date",
    [userId],
  );
  check(
    pairingSummary.rows[0]?.tokens === "120",
    "pairing reassignment did not immediately restore separate account totals",
  );
  console.log("ok - concurrent reconnect remains one installation");

  const expiredInstallation = { id: randomUUID(), secret: token() };
  const expired = await beginPairing(expiredInstallation, [source("expired-source", "codex")]);
  await pool.query(
    "UPDATE installations SET pairing_expires_at = now() - interval '1 second' WHERE id = $1",
    [expiredInstallation.id],
  );
  const expiredApproval = await form("/api/pairing/approve", { code: expired.code });
  check(
    expiredApproval.status === 303 &&
      expiredApproval.headers.get("location")?.includes("error=expired"),
    "expired pairing was accepted",
  );
  await pool.query("DELETE FROM installations WHERE id = $1", [expiredInstallation.id]);
  console.log("ok - expired pairing is rejected");

  const activeInstallationCount = await pool.query(
    "SELECT count(*)::int AS count FROM installations WHERE user_id = $1 AND status = 'active'",
    [userId],
  );
  const installationFillers = Array.from(
    { length: 20 - activeInstallationCount.rows[0].count },
    () => randomUUID(),
  );
  for (const [index, id] of installationFillers.entries())
    await pool.query(
      `INSERT INTO installations
         (id, user_id, name, status, installation_secret_hash, device_token_hash,
          connector_version, protocol_version)
       VALUES ($1, $2, $3, 'active', $4, $5, '0.2.1', 2)`,
      [id, userId, `Limit computer ${index + 1}`, digest(token()), digest(token())],
    );
  const installationLimitPairing = await beginPairing({ id: randomUUID(), secret: token() }, [
    source("installation-limit-source", "opencode"),
  ]);
  let limited = await submitPairingApproval(installationLimitPairing);
  check(
    limited.approval.headers.get("location")?.includes("error=limit"),
    "active installation cap was not enforced",
  );
  await pool.query("DELETE FROM installations WHERE id = ANY($1::uuid[])", [
    [...installationFillers, installationLimitPairing.installationId],
  ]);

  const accountCount = await pool.query(
    "SELECT count(*)::int AS count FROM agent_accounts WHERE user_id = $1",
    [userId],
  );
  const accountFillers = Array.from({ length: 100 - accountCount.rows[0].count }, () =>
    randomUUID(),
  );
  if (accountFillers.length > 0)
    await pool.query(
      `INSERT INTO agent_accounts (id, user_id, agent_id, label, aggregation_mode)
       SELECT id::uuid, $2, 'opencode', 'Limit account ' || ordinality, 'source_sum'
         FROM unnest($1::text[]) WITH ORDINALITY AS filler(id, ordinality)`,
      [accountFillers, userId],
    );
  const accountLimitPairing = await beginPairing({ id: randomUUID(), secret: token() }, [
    source("account-limit-source", "opencode"),
  ]);
  limited = await submitPairingApproval(accountLimitPairing);
  check(
    limited.approval.headers.get("location")?.includes("error=limit"),
    "agent account cap was not enforced",
  );
  await pool.query("DELETE FROM installations WHERE id = $1", [accountLimitPairing.installationId]);
  if (accountFillers.length > 0)
    await pool.query("DELETE FROM agent_accounts WHERE id = ANY($1::uuid[])", [accountFillers]);

  const activeSourceCount = await pool.query(
    "SELECT count(*)::int AS count FROM installation_sources WHERE user_id = $1 AND status = 'active'",
    [userId],
  );
  const sourceFillers = Array.from({ length: 100 - activeSourceCount.rows[0].count }, () =>
    randomUUID(),
  );
  if (sourceFillers.length > 0)
    await pool.query(
      `INSERT INTO installation_sources
         (id, installation_id, user_id, agent_account_id, agent_id, client_source_id,
          collection_method, supported_surface, suggested_label, status)
       SELECT id::uuid, $2, $3, $4, 'opencode', 'limit-source-' || ordinality,
              'opencode_sqlite', 'cli', 'Limit source', 'active'
         FROM unnest($1::text[]) WITH ORDINALITY AS filler(id, ordinality)`,
      [
        sourceFillers,
        firstInstallation.id,
        userId,
        byClient.get("opencode-personal").agentAccountId,
      ],
    );
  const sourceLimitPairing = await beginPairing({ id: randomUUID(), secret: token() }, [
    source("source-limit-source", "opencode"),
  ]);
  limited = await submitPairingApproval(sourceLimitPairing, {
    "source-limit-source": byClient.get("opencode-personal").agentAccountId,
  });
  check(
    limited.approval.headers.get("location")?.includes("error=limit"),
    "active source cap was not enforced",
  );
  await pool.query("DELETE FROM installations WHERE id = $1", [sourceLimitPairing.installationId]);
  if (sourceFillers.length > 0)
    await pool.query("DELETE FROM installation_sources WHERE id = ANY($1::uuid[])", [
      sourceFillers,
    ]);
  console.log("ok - per-user installation, source, and agent-account caps are transactional");

  const pendingBeforeQuotaRace = await pool.query(
    "SELECT count(*)::int AS count FROM installations WHERE status = 'pending' AND pairing_expires_at > now()",
  );
  check(
    pendingBeforeQuotaRace.rows[0].count < 1_000,
    "global pending quota was already full before the concurrency scenario",
  );
  const pendingQuotaIds = Array.from({ length: 999 - pendingBeforeQuotaRace.rows[0].count }, () =>
    randomUUID(),
  );
  await pool.query(
    `INSERT INTO installations
       (id, status, installation_secret_hash, pairing_code_hash, poll_token_hash,
        pending_device_token_hash, connector_version, protocol_version, pairing_expires_at)
     SELECT id::uuid, 'pending',
            decode(md5(id || ':secret') || md5(id || ':secret:2'), 'hex'),
            decode(md5(id || ':pair') || md5(id || ':pair:2'), 'hex'),
            decode(md5(id || ':poll') || md5(id || ':poll:2'), 'hex'),
            decode(md5(id || ':device') || md5(id || ':device:2'), 'hex'),
            '0.2.1', 2, now() + interval '10 minutes'
       FROM unnest($1::text[]) AS pending(id)`,
    [pendingQuotaIds],
  );
  const racingPairings = Array.from({ length: 20 }, (_, index) => ({
    id: randomUUID(),
    secret: token(),
    clientSourceId: `quota-race-${index}`,
  }));
  try {
    const quotaResponses = await Promise.all(
      racingPairings.map((installation) =>
        json("/api/pairing/start", {
          protocolVersion: 2,
          connectorVersion: "0.2.1",
          installationId: installation.id,
          installationSecret: installation.secret,
          sources: [source(installation.clientSourceId, "opencode")],
          supersededClientSourceIds: [],
        }),
      ),
    );
    const createdPairings = quotaResponses.filter((item) => item.status === 201).length;
    const busyPairings = quotaResponses.filter((item) => item.status === 429).length;
    const pendingAfterRace = await pool.query(
      "SELECT count(*)::int AS count FROM installations WHERE status = 'pending'",
    );
    check(
      createdPairings === 1 && busyPairings === 19 && pendingAfterRace.rows[0].count === 1_000,
      `global pending quota raced: ${JSON.stringify({
        createdPairings,
        busyPairings,
        pending: pendingAfterRace.rows[0].count,
      })}`,
    );
  } finally {
    await pool.query("DELETE FROM installations WHERE id = ANY($1::uuid[])", [
      [...pendingQuotaIds, ...racingPairings.map((item) => item.id)],
    ]);
  }
  console.log("ok - concurrent pairing starts cannot exceed the global pending quota");

  const other = await pool.query(
    "INSERT INTO users (github_id, handle) VALUES ($1, $2) RETURNING id::text",
    [(githubId + 1n).toString(), `${handle}-other`],
  );
  const foreign = await pool.query(
    "INSERT INTO agent_accounts (id, user_id, agent_id, label, aggregation_mode) VALUES ($1, $2, 'codex', 'Foreign', 'account_max') RETURNING id::text",
    [randomUUID(), other.rows[0].id],
  );
  const ownedSource = byClient.get("codex-personal-a").sourceId;
  let reassigned = await form("/api/sources/reassign", {
    sourceId: ownedSource,
    accountId: foreign.rows[0].id,
  });
  check(reassigned.status === 404, "source was linked across users");
  const wrongAgent = await pool.query(
    "INSERT INTO agent_accounts (id, user_id, agent_id, label, aggregation_mode) VALUES ($1, $2, 'claude_code', 'Wrong agent', 'source_sum') RETURNING id::text",
    [randomUUID(), userId],
  );
  reassigned = await form("/api/sources/reassign", {
    sourceId: ownedSource,
    accountId: wrongAgent.rows[0].id,
  });
  check(
    reassigned.status === 404,
    `source was linked to a different agent type (${reassigned.status})`,
  );
  console.log("ok - source ownership and agent invariants hold");

  const personalAccount = byClient.get("codex-personal-a").agentAccountId;
  const workAccount = byClient.get("codex-work").agentAccountId;
  const dashboardResponse = await authenticatedGet("/dashboard");
  const dashboardHtml = await dashboardResponse.text();
  const moveTargetLists = Array.from(
    dashboardHtml.matchAll(
      /<select[^>]*aria-label="Move source to account"[^>]*>([\s\S]*?)<\/select>/g,
    ),
    (match) => match[1],
  );
  check(
    dashboardResponse.status === 200 &&
      moveTargetLists.some(
        (options) =>
          options.includes(`value="${personalAccount}"`) &&
          options.includes(`value="${workAccount}"`),
      ),
    "dashboard did not offer both Codex accounts as source targets",
  );
  reassigned = await form("/api/sources/reassign", {
    sourceId: target,
    accountId: personalAccount,
  });
  check(reassigned.status === 303, "owned source could not be reassigned");
  let reassignedSource = await pool.query(
    "SELECT agent_account_id::text FROM installation_sources WHERE id = $1",
    [target],
  );
  check(
    reassignedSource.rows[0]?.agent_account_id === personalAccount,
    "source reassignment was not persisted",
  );
  let codexSummary = await pool.query(
    "SELECT tokens::text FROM weekly_agent_usage WHERE user_id = $1 AND agent_id = 'codex' AND week_start = date_trunc('week', current_date)::date",
    [userId],
  );
  check(codexSummary.rows[0]?.tokens === "100", "account_max was not rebuilt after reassign");
  reassigned = await form("/api/sources/reassign", { sourceId: target, accountId: workAccount });
  check(reassigned.status === 303, "source could not be moved back to its account");
  reassignedSource = await pool.query(
    "SELECT agent_account_id::text FROM installation_sources WHERE id = $1",
    [target],
  );
  check(
    reassignedSource.rows[0]?.agent_account_id === workAccount,
    "source move back was not persisted",
  );
  codexSummary = await pool.query(
    "SELECT tokens::text FROM weekly_agent_usage WHERE user_id = $1 AND agent_id = 'codex' AND week_start = date_trunc('week', current_date)::date",
    [userId],
  );
  check(codexSummary.rows[0]?.tokens === "120", "summary was not restored after reassign");

  const opencodeAccount = byClient.get("opencode-personal").agentAccountId;
  const renamed = await form("/api/accounts/rename", {
    accountId: opencodeAccount,
    label: "Renamed OpenCode",
  });
  const renamedRow = await pool.query("SELECT label FROM agent_accounts WHERE id = $1", [
    opencodeAccount,
  ]);
  check(
    renamed.status === 303 && renamedRow.rows[0]?.label === "Renamed OpenCode",
    "account rename failed",
  );
  console.log("ok - owned account rename and source reassignment rebuild summaries");

  const currentTotal = await pool.query(
    "SELECT sum(tokens)::text AS tokens FROM weekly_agent_usage WHERE user_id = $1 AND week_start = date_trunc('week', current_date)::date",
    [userId],
  );
  await pool.query(
    "INSERT INTO weekly_agent_usage (week_start, user_id, agent_id, tokens) VALUES (date_trunc('week', current_date)::date, $1, 'codex', $2)",
    [other.rows[0].id, currentTotal.rows[0].tokens],
  );
  const ranking = await pool.query(
    `WITH totals AS (
       SELECT user_id, sum(tokens) AS total FROM weekly_agent_usage
        WHERE week_start = date_trunc('week', current_date)::date GROUP BY user_id
     ), ranked AS (
       SELECT user_id, dense_rank() OVER (ORDER BY total DESC)::int AS rank FROM totals
     )
     SELECT user_id::text, rank FROM ranked WHERE user_id IN ($1, $2) ORDER BY user_id`,
    [userId, other.rows[0].id],
  );
  check(
    ranking.rows.length === 2 && ranking.rows[0].rank === ranking.rows[1].rank,
    "equal totals did not receive an equal dense rank",
  );
  const standings = await fetch(`${appUrl}/`);
  const standingsHtml = await standings.text();
  const ownPosition = standingsHtml.indexOf(`@${handle}, rank ${ranking.rows[0].rank}`);
  const otherPosition = standingsHtml.indexOf(`@${handle}-other, rank ${ranking.rows[0].rank}`);
  check(
    standings.status === 200 && ownPosition >= 0 && otherPosition > ownPosition,
    "equal-rank rows were not rendered in deterministic handle order",
  );
  console.log("ok - ties share a dense rank and deterministic ordering survives SSR pagination");

  const disconnectedSource = await form("/api/sources/disconnect", { sourceId: bulkSource });
  const rejectedSource = await usage(finalReconnect.deviceToken, [
    snapshot(bulkSource, 6, [[today, 99]], "partial", today, today),
  ]);
  const preservedHistory = await pool.query(
    "SELECT count(*)::int AS count FROM daily_usage WHERE source_id = $1",
    [bulkSource],
  );
  check(
    disconnectedSource.status === 303 &&
      rejectedSource.status === 400 &&
      preservedHistory.rows[0].count > 0,
    "source disconnect did not stop sync while preserving history",
  );
  let accountDeletion = await form("/api/accounts/delete", { accountId: opencodeAccount });
  check(accountDeletion.status === 400, "linked account deletion skipped confirmation");
  accountDeletion = await form("/api/accounts/delete", {
    accountId: opencodeAccount,
    confirm: "delete",
  });
  const deletedAccount = await pool.query(
    "SELECT count(*)::int AS count FROM agent_accounts WHERE id = $1",
    [opencodeAccount],
  );
  check(
    accountDeletion.status === 303 && deletedAccount.rows[0].count === 0,
    "confirmed agent account deletion failed",
  );
  await pool.query("DELETE FROM users WHERE id = $1", [other.rows[0].id]);
  console.log("ok - source disconnect preserves history and confirmed account deletion removes it");

  const readiness = await fetch(`${appUrl}/ready`);
  check(readiness.status === 200, "production readiness failed after migration");
  const historicalSourceIds = Array.from({ length: 80 }, () => randomUUID());
  const exactSourceIds = Array.from({ length: 100 }, () => randomUUID());
  try {
    await pool.query(
      `INSERT INTO installation_sources
         (id, installation_id, user_id, agent_account_id, agent_id, client_source_id,
          collection_method, supported_surface, suggested_label, status)
       SELECT id::uuid, $2, $3, $4, 'codex', 'historical-source-' || ordinality,
              'codex_app_server', 'desktop', 'Historical source', 'disconnected'
         FROM unnest($1::text[]) WITH ORDINALITY AS historical(id, ordinality)`,
      [
        historicalSourceIds,
        firstInstallation.id,
        userId,
        byClient.get("codex-personal-a").agentAccountId,
      ],
    );
    const boundedInstallation = await fetch(`${appUrl}/api/installations/current`, {
      headers: { authorization: `Bearer ${finalReconnect.deviceToken}` },
    });
    const boundedBody = await boundedInstallation.json();
    const activeInstallationSources = await pool.query(
      "SELECT count(*)::int AS count FROM installation_sources WHERE installation_id = $1 AND status = 'active'",
      [firstInstallation.id],
    );
    check(
      boundedInstallation.status === 200 &&
        boundedBody.sources.length <= 64 &&
        boundedBody.sources.filter((source) => source.status === "active").length ===
          activeInstallationSources.rows[0].count,
      "installation reconciliation response did not bound history while retaining active sources",
    );
    await pool.query(
      `INSERT INTO installation_sources
         (id, installation_id, user_id, agent_account_id, agent_id, client_source_id,
          collection_method, supported_surface, suggested_label, status)
       SELECT id::uuid, $2, $3, $4, 'codex', 'exact-source-' || ordinality,
              'codex_app_server', 'desktop', 'Exact source', 'active'
         FROM unnest($1::text[]) WITH ORDINALITY AS exact_source(id, ordinality)`,
      [
        exactSourceIds,
        firstInstallation.id,
        userId,
        byClient.get("codex-personal-a").agentAccountId,
      ],
    );
    const exactReconciliation = await fetch(`${appUrl}/api/installations/current`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${finalReconnect.deviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sourceIds: exactSourceIds }),
    });
    const exactBody = await exactReconciliation.json();
    check(
      exactReconciliation.status === 200 &&
        exactBody.sources.length === 100 &&
        exactBody.sources.every(
          (source, index) =>
            source.sourceId === exactSourceIds[index] &&
            source.status === "active" &&
            source.lastAcceptedSyncSequence === "0" &&
            Object.keys(source).sort().join(",") === "lastAcceptedSyncSequence,sourceId,status",
        ),
      "exact reconciliation did not return all 100 compact active source states",
    );
    await pool.query("UPDATE installation_sources SET status = 'disconnected' WHERE id = $1", [
      exactSourceIds[73],
    ]);
    const retiredReconciliation = await fetch(`${appUrl}/api/installations/current`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${finalReconnect.deviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sourceIds: exactSourceIds }),
    });
    const retiredBody = await retiredReconciliation.json();
    check(
      retiredReconciliation.status === 200 &&
        retiredBody.sources[73]?.sourceId === exactSourceIds[73] &&
        retiredBody.sources[73]?.status === "disconnected",
      "exact reconciliation did not explicitly retire a disconnected source",
    );
  } finally {
    await pool.query("DELETE FROM installation_sources WHERE id = ANY($1::uuid[])", [
      [...historicalSourceIds, ...exactSourceIds],
    ]);
  }
  console.log("ok - bounded dashboard history and exact reconciliation cover 100 active sources");
  const originalRequiredMigration = await pool.query(
    "SELECT version, checksum FROM schema_migrations WHERE version = '004_integrity_hardening.sql'",
  );
  try {
    await pool.query(
      "INSERT INTO schema_migrations (version, checksum) VALUES ('005_synthetic_future.sql', repeat('f', 64)) ON CONFLICT DO NOTHING",
    );
    check(
      (await fetch(`${appUrl}/ready`)).status === 200,
      "readiness rejected a later migration ledger row",
    );
    await pool.query("DELETE FROM schema_migrations WHERE version = '005_synthetic_future.sql'");
    await pool.query("DELETE FROM schema_migrations WHERE version = '004_integrity_hardening.sql'");
    const missingExpectedSchema = await fetch(`${appUrl}/ready`);
    check(missingExpectedSchema.status === 503, "readiness accepted a missing required migration");
  } finally {
    await pool.query("DELETE FROM schema_migrations WHERE version = '005_synthetic_future.sql'");
    const original = originalRequiredMigration.rows[0];
    if (original) {
      await pool.query(
        `INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)
         ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum`,
        [original.version, original.checksum],
      );
    } else {
      await pool.query(
        "DELETE FROM schema_migrations WHERE version = '004_integrity_hardening.sql'",
      );
    }
  }
  const disconnect = await fetch(`${appUrl}/api/installations/current`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${finalReconnect.deviceToken}` },
  });
  check(disconnect.status === 204, "current installation did not disconnect");
  const afterDisconnect = await usage(finalReconnect.deviceToken, [
    snapshot(target, 7, [[today, 1]]),
  ]);
  check(afterDisconnect.status === 401, "disconnected installation could still sync");
  console.log("ok - readiness and authorization lifecycle behave as expected");

  const fullAccountDeletion = await form("/api/account/delete", { confirm: "delete-account" });
  const deletedUser = await pool.query("SELECT count(*)::int AS count FROM users WHERE id = $1", [
    userId,
  ]);
  check(
    fullAccountDeletion.status === 303 && deletedUser.rows[0].count === 0,
    "full Vibe Racing account deletion failed",
  );
  userId = undefined;
  console.log("ok - full account deletion cascades all Vibe Racing data");
} finally {
  if (userId) await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.end();
}
