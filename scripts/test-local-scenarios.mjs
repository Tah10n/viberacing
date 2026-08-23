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
const trustedProxyScenario = process.env.VIBERACING_TEST_TRUSTED_PROXY === "true";
let userId;

function syntheticEdgeHeader(address) {
  return trustedProxyScenario ? { "x-real-ip": address } : {};
}

async function json(path, body, headers = {}) {
  return fetch(`${appUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...syntheticEdgeHeader("127.0.0.2"),
      ...headers,
    },
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
      ...syntheticEdgeHeader("127.0.0.3"),
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

async function browserSyncGrant(installationId) {
  return fetch(`${appUrl}/api/accounts/sync/grant`, {
    method: "POST",
    headers: {
      cookie: `vr_session=${sessionToken}; vr_local_installation=${installationId}`,
      origin: browserOrigin,
      "content-type": "application/x-www-form-urlencoded",
      ...syntheticEdgeHeader("127.0.0.4"),
    },
    body: "",
    redirect: "manual",
  });
}

async function connectorSyncRequest(path, deviceToken, body) {
  return json(path, body, { authorization: `Bearer ${deviceToken}` });
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
    syntheticEdgeHeader(`127.0.0.${Math.floor(Math.random() * 200) + 2}`),
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

async function cancelPairing(pairing) {
  return json("/api/pairing/cancel", {
    installationId: pairing.installationId,
    pollToken: pairing.pollToken,
  });
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
    entries: entries.map(([date, totalTokens, components]) => ({
      date,
      totalTokens: String(totalTokens),
      ...(components
        ? Object.fromEntries(Object.entries(components).map(([key, value]) => [key, String(value)]))
        : {}),
    })),
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

  if (!trustedProxyScenario) {
    const directInstallation = { id: randomUUID(), secret: token() };
    const directPairing = await beginPairing(directInstallation, [
      source("direct-local-poll-source", "codex"),
    ]);
    for (let attempt = 0; attempt < 21; attempt += 1) {
      const response = await json("/api/pairing/poll", {
        installationId: directPairing.installationId,
        pollToken: directPairing.pollToken,
      });
      check(response.status === 200, `direct local pairing poll ${attempt + 1} failed`);
      check((await response.json()).status === "pending", "direct local pairing stopped pending");
    }
    check(
      (await cancelPairing(directPairing)).status === 204,
      "direct local pairing cleanup failed",
    );
    console.log("ok - direct local connector can poll more than 20 times without X-Real-IP");
  }

  if (trustedProxyScenario) {
    const isolatedClientAddress = "203.0.113.99";
    const isolatedInstallation = { id: randomUUID(), secret: token() };
    const survivingInstallation = { id: randomUUID(), secret: token() };
    try {
      await pool.query(
        `INSERT INTO rate_limit_buckets
         (scope, key_hash, window_started_at, request_count, expires_at)
       VALUES (
         'pairing_start', $1,
         to_timestamp(floor(extract(epoch FROM now()) / 60) * 60),
         6,
         to_timestamp((floor(extract(epoch FROM now()) / 60) + 1) * 60)
       )
       ON CONFLICT (scope, key_hash, window_started_at) DO UPDATE
         SET request_count = EXCLUDED.request_count, expires_at = EXCLUDED.expires_at`,
        [digest(isolatedClientAddress)],
      );
      const globalBefore = await pool.query(
        `SELECT coalesce(sum(request_count), 0)::int AS count
         FROM rate_limit_buckets
        WHERE scope = 'pairing_start_global' AND expires_at > now()`,
      );
      const rejected = await json(
        "/api/pairing/start",
        {
          protocolVersion: 2,
          connectorVersion: "0.2.0",
          installationId: isolatedInstallation.id,
          installationSecret: isolatedInstallation.secret,
          sources: [source("isolated-client-source", "codex")],
          supersededClientSourceIds: [],
        },
        { "x-real-ip": isolatedClientAddress },
      );
      const globalAfter = await pool.query(
        `SELECT coalesce(sum(request_count), 0)::int AS count
         FROM rate_limit_buckets
        WHERE scope = 'pairing_start_global' AND expires_at > now()`,
      );
      const surviving = await json(
        "/api/pairing/start",
        {
          protocolVersion: 2,
          connectorVersion: "0.2.0",
          installationId: survivingInstallation.id,
          installationSecret: survivingInstallation.secret,
          sources: [source("surviving-client-source", "codex")],
          supersededClientSourceIds: [],
        },
        { "x-real-ip": "203.0.113.100" },
      );
      check(
        rejected.status === 429 &&
          globalAfter.rows[0].count === globalBefore.rows[0].count &&
          surviving.status === 201,
        "client admission did not isolate the shared pairing quota",
      );
    } finally {
      await pool.query("DELETE FROM installations WHERE id = ANY($1::uuid[])", [
        [isolatedInstallation.id, survivingInstallation.id],
      ]);
      await pool.query(
        "DELETE FROM rate_limit_buckets WHERE scope IN ('pairing_start', 'pairing_start_global')",
      );
    }
    console.log("ok - exhausted client admission does not spend shared pairing quota");
  }

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
  await pool.query(
    "UPDATE installations SET browser_sync_capable = true WHERE id = $1 AND user_id = $2",
    [firstInstallation.id, userId],
  );
  const grantResponses = await Promise.all(
    Array.from({ length: 12 }, () => browserSyncGrant(firstInstallation.id)),
  );
  check(
    grantResponses.every((response) => response.status === 200),
    "browser sync grants were not issued",
  );
  const grants = await Promise.all(grantResponses.map((response) => response.json()));
  const syncRequests = grants.map((grant, index) => ({
    account: byClient.get(index % 2 === 0 ? "codex-personal-a" : "codex-work"),
    grant,
    requestId: randomUUID(),
  }));
  const claims = await Promise.all(
    syncRequests.map(({ account, grant, requestId: browserRequestId }) =>
      connectorSyncRequest("/api/installations/current/sync/claim", first.deviceToken, {
        requestId: browserRequestId,
        accountId: account.agentAccountId,
        grant: grant.token,
      }),
    ),
  );
  const winningIndexes = claims
    .map((claim, index) => (claim.status === 200 ? index : -1))
    .filter((index) => index >= 0);
  check(
    winningIndexes.length === 1 &&
      claims.every(
        (claim, index) =>
          claim.status === (index === winningIndexes[0] ? 200 : 429) &&
          (index === winningIndexes[0] || claim.headers.get("retry-after") === "60"),
      ),
    `browser sync cooldown admitted an invalid claim set (${claims.map((claim) => claim.status).join(", ")})`,
  );
  const claimBodies = await Promise.all(claims.map((claim) => claim.json()));
  const winningIndex = winningIndexes[0];
  check(
    JSON.stringify(claimBodies[winningIndex].sourceIds) ===
      JSON.stringify([syncRequests[winningIndex].account.sourceId]) &&
      claimBodies.every(
        (claim, index) => index === winningIndex || claim.error === "sync_rate_limited",
      ),
    "browser sync claim crossed account source boundaries",
  );
  const winningRequest = syncRequests[winningIndex];
  const syncResult = await connectorSyncRequest(
    "/api/installations/current/sync/result",
    first.deviceToken,
    {
      requestId: winningRequest.requestId,
      status: "succeeded",
      resultCode: "unchanged",
    },
  );
  check(syncResult.status === 204, `browser sync winner result failed: ${syncResult.status}`);
  const browserStatuses = await Promise.all(
    syncRequests.map(({ requestId: browserRequestId }) =>
      authenticatedGet(`/api/accounts/sync/${browserRequestId}`),
    ),
  );
  const browserStatusBodies = await Promise.all(browserStatuses.map((response) => response.json()));
  check(
    browserStatuses.every((response) => response.status === 200) &&
      browserStatusBodies.every((status, index) =>
        index === winningIndex
          ? status.status === "succeeded" && status.resultCode === "unchanged"
          : status.status === "failed" && status.resultCode === "busy",
      ),
    "browser sync completion was not visible to its owner",
  );
  await pool.query(
    `UPDATE browser_sync_runs
        SET created_at = now() - interval '61 seconds',
            updated_at = now() - interval '61 seconds'
      WHERE id = $1 AND installation_id = $2`,
    [winningRequest.requestId, firstInstallation.id],
  );
  const recoveryGrantResponse = await browserSyncGrant(firstInstallation.id);
  check(
    recoveryGrantResponse.status === 200,
    `terminal busy rows extended the browser sync cooldown: ${recoveryGrantResponse.status}`,
  );
  const recoveryGrant = await recoveryGrantResponse.json();
  const recoveryRequestId = randomUUID();
  const recoveryClaim = await connectorSyncRequest(
    "/api/installations/current/sync/claim",
    first.deviceToken,
    {
      requestId: recoveryRequestId,
      accountId: winningRequest.account.agentAccountId,
      grant: recoveryGrant.token,
    },
  );
  check(
    recoveryClaim.status === 200,
    `terminal busy rows blocked the next browser sync claim: ${recoveryClaim.status}`,
  );
  const recoveryClaimBody = await recoveryClaim.json();
  check(
    JSON.stringify(recoveryClaimBody.sourceIds) ===
      JSON.stringify([winningRequest.account.sourceId]),
    "browser sync recovery claim crossed account source boundaries",
  );
  const recoveryResult = await connectorSyncRequest(
    "/api/installations/current/sync/result",
    first.deviceToken,
    {
      requestId: recoveryRequestId,
      status: "succeeded",
      resultCode: "unchanged",
    },
  );
  check(recoveryResult.status === 204, "browser sync recovery result failed");
  console.log(
    "ok - twelve concurrent browser claims admit one winner, settle busy, and preserve cooldown recovery",
  );
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
    snapshot(byClient.get("codex-personal-a").sourceId, 1, [
      [
        today,
        100,
        {
          inputTokens: 30,
          outputTokens: 20,
          cacheReadTokens: 20,
          cacheWriteTokens: 10,
          reasoningTokens: 10,
        },
      ],
    ]),
    snapshot(byClient.get("codex-work").sourceId, 1, [
      [
        today,
        40,
        {
          inputTokens: 10,
          outputTokens: 10,
          cacheReadTokens: 5,
          cacheWriteTokens: 5,
          reasoningTokens: 5,
        },
      ],
    ]),
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

  let componentDashboard = await authenticatedGet("/dashboard");
  let componentDashboardHtml = await componentDashboard.text();
  let componentBreakdownCount = (
    componentDashboardHtml.match(/aria-label="Weekly token breakdown"/g) ?? []
  ).length;
  let independentComponentNoteCount = (
    componentDashboardHtml.match(/Local component counters total/g) ?? []
  ).length;
  check(
    componentDashboard.status === 200 &&
      componentBreakdownCount === 2 &&
      independentComponentNoteCount >= 2,
    `account_max component display mismatch: status=${componentDashboard.status}, breakdowns=${componentBreakdownCount}, notes=${independentComponentNoteCount}`,
  );
  const rejectedMachineLocalMismatch = await usage(first.deviceToken, [
    snapshot(byClient.get("claude-personal").sourceId, 2, [
      [
        today,
        30,
        {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 3,
          cacheWriteTokens: 2,
          reasoningTokens: 0,
        },
      ],
    ]),
  ]);
  check(
    rejectedMachineLocalMismatch.status === 400,
    "source_sum accepted components that did not match its authoritative total",
  );
  const conflictingComponents = await usage(second.deviceToken, [
    snapshot(secondByClient.get("codex-personal-b").sourceId, 2, [
      [
        today,
        100,
        {
          inputTokens: 50,
          outputTokens: 10,
          cacheReadTokens: 10,
          cacheWriteTokens: 10,
          reasoningTokens: 10,
        },
      ],
    ]),
  ]);
  check(conflictingComponents.status === 200, "conflicting component snapshot failed");
  componentDashboard = await authenticatedGet("/dashboard");
  componentDashboardHtml = await componentDashboard.text();
  componentBreakdownCount = (
    componentDashboardHtml.match(/aria-label="Weekly token breakdown"/g) ?? []
  ).length;
  check(
    componentDashboard.status === 200 && componentBreakdownCount === 1,
    `account_max conflict display mismatch: status=${componentDashboard.status}, breakdowns=${componentBreakdownCount}`,
  );
  const restoredComponents = await usage(second.deviceToken, [
    snapshot(secondByClient.get("codex-personal-b").sourceId, 3, [[today, 80]]),
  ]);
  check(restoredComponents.status === 200, "component conflict restoration failed");
  console.log("ok - account_max component tuples are exact, deduplicated, and fail closed");

  const dedupBaseline = await pool.query(
    "SELECT coalesce(sum(tokens), 0)::text AS tokens FROM weekly_agent_usage WHERE user_id = $1 AND agent_id = 'codex'",
    [userId],
  );
  const dedupBaselineTokens = BigInt(dedupBaseline.rows[0].tokens);
  const guardFirstInstallation = { id: randomUUID(), secret: token() };
  const guardSecondInstallation = { id: randomUUID(), secret: token() };
  const guardFirst = await pair(guardFirstInstallation, [source("guard-codex-a", "codex")]);
  const guardSecond = await pair(guardSecondInstallation, [source("guard-codex-b", "codex")]);
  const guardFirstSource = guardFirst.sources[0];
  const guardSecondSource = guardSecond.sources[0];
  const guardDates = [dateOffset(-6), dateOffset(-5), dateOffset(-4)];
  check(
    guardFirstSource !== undefined && guardSecondSource !== undefined,
    "deduplication guard pairing omitted a source",
  );
  let guardUsage = await usage(guardFirst.deviceToken, [
    snapshot(
      guardFirstSource.sourceId,
      1,
      [
        [guardDates[0], 11111],
        [guardDates[1], 22222],
        [guardDates[2], 33333],
      ],
      "complete",
      guardDates[0],
      guardDates[2],
    ),
  ]);
  check(guardUsage.status === 200, "deduplication guard history was rejected");
  guardUsage = await usage(guardSecond.deviceToken, [
    snapshot(
      guardSecondSource.sourceId,
      1,
      [
        [guardDates[0], 11111],
        [guardDates[1], 22222],
        [guardDates[2], 33333],
      ],
      "partial",
      guardDates[0],
      guardDates[2],
    ),
  ]);
  let guardEvents = await pool.query(
    "SELECT count(*)::int AS count FROM account_dedup_events WHERE source_id = $1",
    [guardSecondSource.sourceId],
  );
  check(
    guardUsage.status === 200 && guardEvents.rows[0].count === 0,
    "partial history triggered automatic account matching",
  );
  guardUsage = await usage(guardSecond.deviceToken, [
    snapshot(
      guardSecondSource.sourceId,
      2,
      [
        [guardDates[0], 11111],
        [guardDates[1], 22222],
        [guardDates[2], 0],
      ],
      "complete",
      guardDates[0],
      guardDates[2],
    ),
  ]);
  guardEvents = await pool.query(
    "SELECT count(*)::int AS count FROM account_dedup_events WHERE source_id = $1",
    [guardSecondSource.sourceId],
  );
  check(
    guardUsage.status === 200 && guardEvents.rows[0].count === 0,
    "a complete zero-versus-positive contradiction was ignored",
  );
  for (const accountId of [guardFirstSource.agentAccountId, guardSecondSource.agentAccountId]) {
    const deletion = await form("/api/accounts/delete", { accountId, confirm: "delete" });
    check(deletion.status === 303, "deduplication guard account cleanup failed");
  }
  await pool.query("DELETE FROM installations WHERE id = ANY($1::uuid[])", [
    [guardFirstInstallation.id, guardSecondInstallation.id],
  ]);
  const guardCleanupTotals = await pool.query(
    "SELECT coalesce(sum(tokens), 0)::text AS tokens FROM weekly_agent_usage WHERE user_id = $1 AND agent_id = 'codex'",
    [userId],
  );
  check(
    BigInt(guardCleanupTotals.rows[0].tokens) === dedupBaselineTokens,
    "deduplication guard cleanup left stale leaderboard totals",
  );
  const dedupFixtureTokens = 13_579n + 24_680n;
  const dedupFirstInstallation = { id: randomUUID(), secret: token() };
  const dedupSecondInstallation = { id: randomUUID(), secret: token() };
  const dedupFirstPairing = await beginPairing(dedupFirstInstallation, [
    source("dedup-codex-a", "codex"),
  ]);
  const dedupConnectPage = await authenticatedGet(`/connect?code=${dedupFirstPairing.code}`);
  const dedupConnectHtml = await dedupConnectPage.text();
  check(
    dedupConnectPage.status === 200 &&
      dedupConnectHtml.includes("automatically match this account after its first") &&
      !dedupConnectHtml.includes("If this is the same provider account"),
    "Codex pairing still required a technical account-mapping decision",
  );
  const dedupFirst = await approvePairing(dedupFirstPairing);
  const dedupSecond = await pair(dedupSecondInstallation, [source("dedup-codex-b", "codex")]);
  const dedupFirstSource = dedupFirst.sources[0];
  const dedupSecondSource = dedupSecond.sources[0];
  const dedupStart = dateOffset(-3);
  const dedupEnd = dateOffset(-2);
  check(
    dedupFirstSource !== undefined && dedupSecondSource !== undefined,
    "deduplication pairing omitted a source",
  );
  let dedupUsage = await usage(dedupSecond.deviceToken, [
    snapshot(
      dedupSecondSource.sourceId,
      1,
      [
        [dedupStart, 13579],
        [dedupEnd, 24680],
      ],
      "complete",
      dedupStart,
      dedupEnd,
    ),
  ]);
  const dedupEvents = await pool.query(
    "SELECT count(*)::int AS count FROM account_dedup_events WHERE source_id = $1",
    [dedupSecondSource.sourceId],
  );
  check(
    dedupUsage.status === 200 && dedupEvents.rows[0].count === 0,
    "a source was matched before another account had comparable history",
  );
  dedupUsage = await usage(dedupFirst.deviceToken, [
    snapshot(
      dedupFirstSource.sourceId,
      1,
      [
        [dedupStart, 13579],
        [dedupEnd, 24680],
      ],
      "complete",
      dedupStart,
      dedupEnd,
    ),
  ]);
  const dedupEvent = await pool.query(
    `SELECT event.id::text,
            event.previous_account_id::text,
            event.target_account_id::text,
            event.matched_days,
            previous.merged_into_account_id::text,
            source.agent_account_id::text AS current_account_id,
            source.auto_dedup_decided_at IS NOT NULL AS has_durable_decision
       FROM account_dedup_events event
       JOIN agent_accounts previous ON previous.id = event.previous_account_id
       JOIN installation_sources source ON source.id = event.source_id
      WHERE event.source_id = $1 AND event.status = 'active'`,
    [dedupSecondSource.sourceId],
  );
  const activeDedup = dedupEvent.rows[0];
  const mergedCodexTotals = await pool.query(
    "SELECT coalesce(sum(tokens), 0)::text AS tokens FROM weekly_agent_usage WHERE user_id = $1 AND agent_id = 'codex'",
    [userId],
  );
  check(
    dedupUsage.status === 200 &&
      activeDedup?.matched_days === 2 &&
      activeDedup.previous_account_id === dedupSecondSource.agentAccountId &&
      activeDedup.target_account_id === dedupFirstSource.agentAccountId &&
      activeDedup.merged_into_account_id === activeDedup.target_account_id &&
      activeDedup.current_account_id === activeDedup.target_account_id &&
      activeDedup.has_durable_decision === true &&
      BigInt(mergedCodexTotals.rows[0].tokens) === dedupBaselineTokens + dedupFixtureTokens,
    "matching complete Codex histories were not combined",
  );
  const dedupDashboard = await authenticatedGet("/dashboard");
  const dedupDashboardHtml = await dedupDashboard.text();
  check(
    dedupDashboard.status === 200 &&
      dedupDashboardHtml.includes("AUTOMATIC ACCOUNT MATCH") &&
      dedupDashboardHtml.includes("Undo automatic match") &&
      dedupDashboardHtml.includes("completed daily totals matched exactly"),
    "dashboard did not explain the automatic match or offer Undo",
  );
  const undoneDedup = await form("/api/accounts/dedup/undo", { eventId: activeDedup.id });
  const undoneState = await pool.query(
    `SELECT event.status,
            event.undone_at IS NOT NULL AS has_undone_at,
            previous.merged_into_account_id::text,
            source.agent_account_id::text AS current_account_id
       FROM account_dedup_events event
       JOIN agent_accounts previous ON previous.id = event.previous_account_id
       JOIN installation_sources source ON source.id = event.source_id
      WHERE event.id = $1`,
    [activeDedup.id],
  );
  const undoneCodexTotals = await pool.query(
    "SELECT coalesce(sum(tokens), 0)::text AS tokens FROM weekly_agent_usage WHERE user_id = $1 AND agent_id = 'codex'",
    [userId],
  );
  check(
    undoneDedup.status === 303 &&
      undoneState.rows[0]?.status === "undone" &&
      undoneState.rows[0].has_undone_at === true &&
      undoneState.rows[0].merged_into_account_id === null &&
      undoneState.rows[0].current_account_id === activeDedup.previous_account_id &&
      BigInt(undoneCodexTotals.rows[0].tokens) === dedupBaselineTokens + dedupFixtureTokens * 2n,
    "Undo did not restore the original account mapping",
  );
  dedupUsage = await usage(dedupSecond.deviceToken, [
    snapshot(
      dedupSecondSource.sourceId,
      2,
      [
        [dedupStart, 13579],
        [dedupEnd, 24680],
      ],
      "complete",
      dedupStart,
      dedupEnd,
    ),
  ]);
  const remerged = await pool.query("SELECT status FROM account_dedup_events WHERE id = $1", [
    activeDedup.id,
  ]);
  check(
    dedupUsage.status === 200 && remerged.rows[0]?.status === "undone",
    "an undone account match was applied again",
  );
  await pool.query("DELETE FROM account_dedup_events WHERE id = $1", [activeDedup.id]);
  dedupUsage = await usage(dedupSecond.deviceToken, [
    snapshot(
      dedupSecondSource.sourceId,
      3,
      [
        [dedupStart, 13579],
        [dedupEnd, 24680],
      ],
      "complete",
      dedupStart,
      dedupEnd,
    ),
  ]);
  const durableDecision = await pool.query(
    `SELECT source.agent_account_id::text,
            source.auto_dedup_decided_at IS NOT NULL AS has_durable_decision,
            (SELECT count(*)::int FROM account_dedup_events event
              WHERE event.source_id = source.id) AS event_count
       FROM installation_sources source
      WHERE source.id = $1`,
    [dedupSecondSource.sourceId],
  );
  check(
    dedupUsage.status === 200 &&
      durableDecision.rows[0]?.agent_account_id === activeDedup.previous_account_id &&
      durableDecision.rows[0].has_durable_decision === true &&
      durableDecision.rows[0].event_count === 0,
    "deleting account-match history removed the durable no-remerge decision",
  );
  for (const accountId of [dedupFirstSource.agentAccountId, dedupSecondSource.agentAccountId]) {
    const deletion = await form("/api/accounts/delete", { accountId, confirm: "delete" });
    check(deletion.status === 303, "deduplication fixture account cleanup failed");
  }
  await pool.query("DELETE FROM installations WHERE id = ANY($1::uuid[])", [
    [dedupFirstInstallation.id, dedupSecondInstallation.id],
  ]);
  const cleanedCodexTotals = await pool.query(
    "SELECT coalesce(sum(tokens), 0)::text AS tokens FROM weekly_agent_usage WHERE user_id = $1 AND agent_id = 'codex'",
    [userId],
  );
  check(
    BigInt(cleanedCodexTotals.rows[0].tokens) === dedupBaselineTokens,
    "deduplication fixture cleanup left stale leaderboard totals",
  );
  console.log(
    "ok - complete contradictions stay separate, reverse Codex matching deduplicates totals, and Undo remains durable",
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
    method: "POST",
    headers: {
      authorization: `Bearer ${first.deviceToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ sourceIds: [target] }),
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
    `SELECT agent_account_id::text,
            auto_dedup_decided_at IS NOT NULL AS has_durable_decision
       FROM installation_sources WHERE id = $1`,
    [target],
  );
  check(
    reassignedSource.rows[0]?.agent_account_id === personalAccount &&
      reassignedSource.rows[0].has_durable_decision === true,
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
    const removedDetailedInstallation = await fetch(`${appUrl}/api/installations/current`, {
      headers: { authorization: `Bearer ${finalReconnect.deviceToken}` },
    });
    check(
      removedDetailedInstallation.status === 405,
      "unused detailed installation GET contract is still exposed",
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

    await pool.query(
      `INSERT INTO rate_limit_buckets
         (scope, key_hash, window_started_at, request_count, expires_at)
       VALUES (
         'reconciliation_global', $1,
         to_timestamp(floor(extract(epoch FROM now()) / 60) * 60),
         10000,
         to_timestamp((floor(extract(epoch FROM now()) / 60) + 1) * 60)
       )
       ON CONFLICT (scope, key_hash, window_started_at) DO UPDATE
         SET request_count = EXCLUDED.request_count, expires_at = EXCLUDED.expires_at`,
      [digest("all")],
    );
    let limitedReconciliation = await fetch(`${appUrl}/api/installations/current`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${finalReconnect.deviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sourceIds: [exactSourceIds[0]] }),
    });
    check(
      limitedReconciliation.status === 429 &&
        limitedReconciliation.headers.get("retry-after") === "60",
      "global reconciliation rate limit did not return Retry-After",
    );
    await pool.query("DELETE FROM rate_limit_buckets WHERE scope = 'reconciliation_global'");
    await pool.query(
      `INSERT INTO rate_limit_buckets
         (scope, key_hash, window_started_at, request_count, expires_at)
       VALUES (
         'reconciliation_installation', $1,
         to_timestamp(floor(extract(epoch FROM now()) / 60) * 60),
         60,
         to_timestamp((floor(extract(epoch FROM now()) / 60) + 1) * 60)
       )
       ON CONFLICT (scope, key_hash, window_started_at) DO UPDATE
         SET request_count = EXCLUDED.request_count, expires_at = EXCLUDED.expires_at`,
      [digest(firstInstallation.id)],
    );
    limitedReconciliation = await fetch(`${appUrl}/api/installations/current`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${finalReconnect.deviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sourceIds: [exactSourceIds[0]] }),
    });
    check(
      limitedReconciliation.status === 429 &&
        limitedReconciliation.headers.get("retry-after") === "60",
      "per-installation reconciliation rate limit did not return Retry-After",
    );
  } finally {
    await pool.query(
      "DELETE FROM rate_limit_buckets WHERE scope IN ('reconciliation_global', 'reconciliation_installation')",
    );
    await pool.query("DELETE FROM installation_sources WHERE id = ANY($1::uuid[])", [
      [...historicalSourceIds, ...exactSourceIds],
    ]);
  }
  console.log(
    "ok - compact exact reconciliation covers 100 active sources, large history, and both rate limits",
  );

  const cancellationInstallation = { id: randomUUID(), secret: token() };
  const cancellationSource = source("pairing-cancellation-source", "codex");
  const cancelledInitial = await beginPairing(cancellationInstallation, [cancellationSource]);
  check(
    (await cancelPairing(cancelledInitial)).status === 204,
    "initial pairing was not cancelled",
  );
  check(
    (await cancelPairing(cancelledInitial)).status === 204,
    "repeated initial pairing cancellation was not idempotent",
  );
  check(
    (await submitPairingApproval(cancelledInitial)).approval.status === 303,
    "cancelled initial pairing was approved",
  );
  check(
    (
      await json("/api/pairing/poll", {
        installationId: cancelledInitial.installationId,
        pollToken: cancelledInitial.pollToken,
      })
    ).status === 404,
    "cancelled initial pairing remained pollable",
  );
  const initialCancellationState = await pool.query(
    `SELECT status,
            pairing_code_hash IS NULL AS pairing_cleared,
            poll_token_hash IS NULL AS poll_cleared,
            pending_device_token_hash IS NULL AS pending_token_cleared,
            pairing_expires_at IS NULL AS expiry_cleared,
            (SELECT count(*)::int FROM installation_sources WHERE installation_id = installations.id) AS sources
       FROM installations WHERE id = $1`,
    [cancellationInstallation.id],
  );
  check(
    initialCancellationState.rows[0]?.status === "revoked" &&
      initialCancellationState.rows[0]?.pairing_cleared &&
      initialCancellationState.rows[0]?.poll_cleared &&
      initialCancellationState.rows[0]?.pending_token_cleared &&
      initialCancellationState.rows[0]?.expiry_cleared &&
      initialCancellationState.rows[0]?.sources === 0,
    "initial cancellation retained pairing capability or pending sources",
  );

  const supersededAttempt = await beginPairing(cancellationInstallation, [cancellationSource]);
  const currentAttempt = await beginPairing(cancellationInstallation, [cancellationSource]);
  check(
    (await cancelPairing(supersededAttempt)).status === 204,
    "superseded pairing cancellation was not idempotent",
  );
  const currentConnection = await approvePairing(currentAttempt);
  const cancelledReconnect = await beginPairing(cancellationInstallation, [cancellationSource]);
  check(
    (await cancelPairing(cancelledReconnect)).status === 204,
    "active reconnect pairing was not cancelled",
  );
  check(
    (
      await usage(currentConnection.deviceToken, [
        snapshot(currentConnection.sources[0].sourceId, 1, [[today, 1]]),
      ])
    ).status === 200,
    "cancelling a pending reconnect revoked the previous active token",
  );
  check(
    (await submitPairingApproval(cancelledReconnect)).approval.status === 303,
    "cancelled reconnect was approved",
  );
  const pendingReconnect = await beginPairing(cancellationInstallation, [cancellationSource]);
  const disconnectDuringPairing = await fetch(`${appUrl}/api/installations/current`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${currentConnection.deviceToken}` },
  });
  check(disconnectDuringPairing.status === 204, "disconnect did not cancel pending reconnect");
  check(
    (await submitPairingApproval(pendingReconnect)).approval.status === 303,
    "revoked reconnect was approved",
  );
  check(
    (
      await json("/api/pairing/poll", {
        installationId: pendingReconnect.installationId,
        pollToken: pendingReconnect.pollToken,
      })
    ).status === 404,
    "revoked reconnect remained pollable",
  );
  const revokedPairingState = await pool.query(
    `SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending_sources,
            count(*) FILTER (
              WHERE pending_pairing_code_hash IS NOT NULL OR pending_disconnect
            )::int AS pending_markers
       FROM installation_sources WHERE installation_id = $1`,
    [cancellationInstallation.id],
  );
  check(
    revokedPairingState.rows[0]?.pending_sources === 0 &&
      revokedPairingState.rows[0]?.pending_markers === 0,
    "disconnect retained pending-only sources or pairing markers",
  );

  const restoredConnection = await pair(cancellationInstallation, [cancellationSource]);
  const approvedReplacement = await beginPairing(cancellationInstallation, [cancellationSource]);
  const replacementConnection = await approvePairing(approvedReplacement);
  const staleTokenDisconnect = await fetch(`${appUrl}/api/installations/current`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${restoredConnection.deviceToken}` },
  });
  check(staleTokenDisconnect.status === 401, "rotated device token unexpectedly remained active");
  check(
    (await cancelPairing(approvedReplacement)).status === 204 &&
      (await cancelPairing(approvedReplacement)).status === 204,
    "approved pairing cancellation was not idempotent",
  );
  check(
    (await usage(replacementConnection.deviceToken, [])).status === 401,
    "approved replacement token survived exact-attempt cancellation",
  );
  console.log("ok - exact pairing cancellation defeats late approval and token rotation races");

  const originalRequiredMigration = await pool.query(
    "SELECT version, checksum FROM schema_migrations ORDER BY version DESC LIMIT 1",
  );
  const original = originalRequiredMigration.rows[0];
  check(original, "migration ledger did not contain a required migration");
  const requiredMigrationNumber = /^(\d{3})_/.exec(original.version)?.[1];
  check(requiredMigrationNumber, "latest required migration used an unsupported version");
  const syntheticFutureMigration = `${String(Number(requiredMigrationNumber) + 1).padStart(3, "0")}_synthetic_future.sql`;
  try {
    await pool.query(
      "INSERT INTO schema_migrations (version, checksum) VALUES ($1, repeat('f', 64)) ON CONFLICT DO NOTHING",
      [syntheticFutureMigration],
    );
    check(
      (await fetch(`${appUrl}/ready`)).status === 200,
      "readiness rejected a later migration ledger row",
    );
    await pool.query("DELETE FROM schema_migrations WHERE version = $1", [
      syntheticFutureMigration,
    ]);
    await pool.query("DELETE FROM schema_migrations WHERE version = $1", [original.version]);
    const missingExpectedSchema = await fetch(`${appUrl}/ready`);
    check(missingExpectedSchema.status === 503, "readiness accepted a missing required migration");
  } finally {
    await pool.query("DELETE FROM schema_migrations WHERE version = $1", [
      syntheticFutureMigration,
    ]);
    await pool.query(
      `INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)
       ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum`,
      [original.version, original.checksum],
    );
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
