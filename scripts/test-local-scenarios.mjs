import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");

const appUrl = "http://127.0.0.1:3000";
const publicOrigin = new URL(process.env.VIBERACING_PUBLIC_ORIGIN ?? "http://localhost:3000")
  .origin;
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const digest = (value) => createHash("sha256").update(value, "utf8").digest();
const token = () => randomBytes(32).toString("base64url");
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};

const sessionToken = token();
let firstDeviceToken = token();
const secondDeviceToken = token();
let firstConnectionId = randomUUID();
const secondConnectionId = randomUUID();
const handle = `local-test-${randomBytes(5).toString("hex")}`;
const githubId =
  800_000_000_000_000_000n +
  (BigInt(`0x${randomBytes(7).toString("hex")}`) % 100_000_000_000_000_000n);
const today = new Date().toISOString().slice(0, 10);
let userId;

async function addConnection(id, name, agents, deviceToken) {
  await pool.query(
    `INSERT INTO connections
       (id, user_id, name, status, agents, code_hash, poll_token_hash, device_token_hash, expires_at)
     VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, now() + interval '1 day')`,
    [id, userId, name, agents, digest(token()), digest(token()), digest(deviceToken)],
  );
}

async function uploadResponse(deviceToken, agent, tokens) {
  return fetch(`${appUrl}/api/usage`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${deviceToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ entries: [{ agent, date: today, tokens }] }),
  });
}

async function upload(deviceToken, agent, tokens) {
  const response = await uploadResponse(deviceToken, agent, tokens);
  check(response.status === 200, `usage upload failed with ${response.status}`);
}

async function postForm(path, body) {
  return fetch(`${appUrl}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: `vr_session=${sessionToken}`,
      origin: publicOrigin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
}

async function postJson(path, body) {
  return fetch(`${appUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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

  await addConnection(firstConnectionId, "Computer 1", ["codex", "claude_code"], firstDeviceToken);
  await addConnection(
    secondConnectionId,
    "Computer 2",
    ["codex", "claude_code"],
    secondDeviceToken,
  );
  const malformedStart = await fetch(`${appUrl}/api/pairing/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "null",
  });
  const malformedPoll = await postJson("/api/pairing/poll", {
    connectionId: "not-a-uuid",
    pollToken: "x",
  });
  const malformedUsage = await fetch(`${appUrl}/api/usage`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${firstDeviceToken}`,
      "content-type": "application/json",
    },
    body: "null",
  });
  check(
    malformedStart.status === 400 && malformedPoll.status === 400 && malformedUsage.status === 400,
    "malformed API input did not return a client error",
  );
  console.log("ok - malformed JSON and identifiers return 400 responses");
  const active = await pool.query(
    "SELECT count(*)::int AS count FROM connections WHERE user_id = $1 AND status = 'active'",
    [userId],
  );
  check(active.rows[0].count === 2, "two active computers were not preserved");
  console.log("ok - two computers can stay active with different agent sets");

  await upload(firstDeviceToken, "codex", "2600000");
  await upload(secondDeviceToken, "codex", "2400000");
  await upload(firstDeviceToken, "claude_code", "400000");
  await upload(secondDeviceToken, "claude_code", "600000");
  const usage = await pool.query(
    `SELECT agent,
            (CASE WHEN agent = 'codex' THEN max(tokens) ELSE sum(tokens) END)::text AS tokens
       FROM daily_usage
      WHERE user_id = $1 AND usage_date = $2::date
      GROUP BY agent
      ORDER BY agent`,
    [userId, today],
  );
  check(
    JSON.stringify(usage.rows) ===
      JSON.stringify([
        { agent: "claude_code", tokens: "1000000" },
        { agent: "codex", tokens: "2600000" },
      ]),
    "provider-aware multi-computer aggregation was incorrect",
  );
  console.log("ok - Codex is deduplicated while machine-local Claude totals are combined");

  const replacementStart = await postJson("/api/pairing/start", {
    agents: ["codex", "claude_code"],
    previousDeviceToken: firstDeviceToken,
  });
  check(
    replacementStart.status === 201,
    `replacement pairing failed with ${replacementStart.status}`,
  );
  const replacement = await replacementStart.json();
  const replacementApprove = await postForm("/api/pairing/approve", { code: replacement.code });
  check(
    replacementApprove.status === 303,
    `replacement approval failed with ${replacementApprove.status}`,
  );
  const replacementPoll = await postJson("/api/pairing/poll", {
    connectionId: replacement.connectionId,
    pollToken: replacement.pollToken,
  });
  check(
    replacementPoll.status === 200 && (await replacementPoll.json()).status === "active",
    "replacement connection did not activate",
  );
  const afterReplacement = await pool.query(
    `SELECT
       count(*) FILTER (WHERE status = 'active')::int AS active,
       count(*) FILTER (WHERE id = $2)::int AS old_connections,
       (SELECT count(*)::int FROM daily_usage WHERE connection_id = $3) AS moved_rows
     FROM connections WHERE user_id = $1 OR id = $2`,
    [userId, firstConnectionId, replacement.connectionId],
  );
  check(
    afterReplacement.rows[0].active === 2 &&
      afterReplacement.rows[0].old_connections === 0 &&
      afterReplacement.rows[0].moved_rows === 2,
    "reconnecting duplicated the computer or lost its history",
  );
  firstConnectionId = replacement.connectionId;
  firstDeviceToken = replacement.deviceToken;
  console.log("ok - reconnecting one computer preserves history without creating a duplicate");

  const disconnected = await postForm("/api/connections/revoke", {
    connectionId: firstConnectionId,
  });
  check(disconnected.status === 303, `disconnect failed with ${disconnected.status}`);
  const afterDisconnect = await pool.query(
    `SELECT
       count(*) FILTER (WHERE status = 'active')::int AS active,
       (SELECT count(*)::int FROM daily_usage WHERE user_id = $1) AS usage_rows
     FROM connections WHERE user_id = $1`,
    [userId],
  );
  check(
    afterDisconnect.rows[0].active === 1 && afterDisconnect.rows[0].usage_rows === 4,
    "disconnect did not preserve history or affected another computer",
  );
  const disconnectedUpload = await uploadResponse(firstDeviceToken, "codex", "2700000");
  check(disconnectedUpload.status === 401, "disconnected computer could still upload");
  console.log(
    "ok - disconnect revokes one computer without removing history or the other computer",
  );

  const left = await postForm("/api/leaderboard/leave", { confirm: "leave" });
  check(left.status === 303, `leave leaderboard failed with ${left.status}`);
  const afterLeave = await pool.query(
    `SELECT
       count(*) FILTER (WHERE status = 'active')::int AS active,
       (SELECT count(*)::int FROM daily_usage WHERE user_id = $1) AS usage_rows
     FROM connections WHERE user_id = $1`,
    [userId],
  );
  check(
    afterLeave.rows[0].active === 0 && afterLeave.rows[0].usage_rows === 0,
    "leaving did not revoke computers and clear leaderboard data",
  );
  const leftUpload = await uploadResponse(secondDeviceToken, "codex", "2700000");
  check(leftUpload.status === 401, "computer could still upload after leaving");
  console.log("ok - leaving removes leaderboard data and revokes every computer");
} finally {
  if (userId !== undefined) await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.end();
}
