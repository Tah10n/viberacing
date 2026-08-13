import { createHash, randomBytes, randomUUID } from "node:crypto";
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

const definitions = {
  codex: ["codex_app_server", "desktop"],
  claude_code: ["claude_jsonl", "cli"],
  opencode: ["opencode_sqlite", "cli"],
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

async function beginPairing(installation, sources) {
  const response = await json(
    "/api/pairing/start",
    {
      protocolVersion: 2,
      connectorVersion: "0.2.0",
      installationId: installation.id,
      installationSecret: installation.secret,
      sources,
    },
    { "x-real-ip": `127.0.0.${Math.floor(Math.random() * 200) + 2}` },
  );
  if (response.status !== 201)
    throw new Error(`pairing start failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function approvePairing(pairing, selections) {
  const pending = await pool.query(
    "SELECT id::text, client_source_id FROM installation_sources WHERE installation_id = $1 AND status = 'pending' ORDER BY created_at, id",
    [pairing.installationId],
  );
  const body = { code: pairing.code };
  for (const row of pending.rows) {
    const selected = selections[row.client_source_id] ?? "new";
    body[`account_${row.id}`] = selected;
    body[`label_${row.id}`] = `${row.client_source_id} account`;
  }
  const approval = await form("/api/pairing/approve", body);
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

async function pair(installation, sources, selections = {}) {
  return approvePairing(await beginPairing(installation, sources), selections);
}

async function usage(deviceToken, snapshots) {
  return json(
    "/api/usage",
    { protocolVersion: 2, snapshots },
    { authorization: `Bearer ${deviceToken}` },
  );
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

  const target = byClient.get("codex-work").sourceId;
  let response = await usage(first.deviceToken, [
    snapshot(target, 2, [
      [yesterday, 50],
      [today, 35],
    ]),
  ]);
  check(response.status === 200, "complete correction failed");
  response = await usage(first.deviceToken, [snapshot(target, 2, [[today, 999]])]);
  check(
    response.status === 200 && (await response.json()).staleSnapshots === 1,
    "same sequence was not idempotent",
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
    rows.rows.length === 2 && rows.rows[1].total_tokens === "25",
    "partial snapshot deleted an absent date or failed to decrease",
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

  const oldDeviceToken = first.deviceToken;
  const reconnect = await pair(
    firstInstallation,
    [
      source("codex-personal-a", "codex"),
      source("codex-work", "codex"),
      source("claude-personal", "claude_code"),
      source("opencode-personal", "opencode"),
    ],
    Object.fromEntries(first.sources.map((item) => [item.clientSourceId, item.agentAccountId])),
  );
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
  console.log("ok - reconnect preserves identity/history and rotates device authorization");

  const concurrent = await Promise.all([
    beginPairing(firstInstallation, [
      source("codex-personal-a", "codex"),
      source("codex-work", "codex"),
      source("claude-personal", "claude_code"),
      source("opencode-personal", "opencode"),
    ]),
    beginPairing(firstInstallation, [
      source("codex-personal-a", "codex"),
      source("codex-work", "codex"),
      source("claude-personal", "claude_code"),
      source("opencode-personal", "opencode"),
    ]),
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
  console.log("ok - expired pairing is rejected");

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
  reassigned = await form("/api/sources/reassign", {
    sourceId: target,
    accountId: personalAccount,
  });
  check(reassigned.status === 303, "owned source could not be reassigned");
  let codexSummary = await pool.query(
    "SELECT tokens::text FROM weekly_agent_usage WHERE user_id = $1 AND agent_id = 'codex' AND week_start = date_trunc('week', current_date)::date",
    [userId],
  );
  check(codexSummary.rows[0]?.tokens === "100", "account_max was not rebuilt after reassign");
  reassigned = await form("/api/sources/reassign", { sourceId: target, accountId: workAccount });
  check(reassigned.status === 303, "source could not be moved back to its account");
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
  await pool.query("INSERT INTO schema_migrations (version) VALUES ('999_invalid_test')");
  const wrongSchema = await fetch(`${appUrl}/ready`);
  check(wrongSchema.status === 503, "readiness accepted an unexpected schema version");
  await pool.query("DELETE FROM schema_migrations WHERE version = '999_invalid_test'");
  check(
    (await fetch(`${appUrl}/ready`)).status === 200,
    "readiness did not recover after schema repair",
  );
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
