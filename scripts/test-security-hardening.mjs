import { createConnection } from "node:net";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, request } from "node:http";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const origins = process.argv.slice(2);
assert.deepEqual(
  origins,
  ["http://127.0.0.1:3022", "http://127.0.0.1:3023"],
  "Explicit isolated origins required",
);
const db = new URL(process.env.DATABASE_URL ?? "");
assert.equal(db.hostname, "127.0.0.1");
assert.equal(db.port, "55439");
assert.equal(process.env.VIBERACING_TEST_ADMISSION_DATABASE, "synthetic-local");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const pool = new (require("pg").Pool)({ connectionString: db.href, max: 3 });
const timeout = setTimeout(() => {
  process.stderr.write("Bounded scenario timed out\n");
  process.exit(1);
}, 120000);
const digest = (value) => createHash("sha256").update(value).digest();
const results = {};
let requests = 0;
const proxies = new Map();
let fixtureId;
async function send(index, path, { ip = "127.0.0.2", headers = {}, method = "GET", body } = {}) {
  assert.ok(++requests <= 400, "Request budget exceeded");
  const proxyKey = `${index}:${ip}`;
  if (!proxies.has(proxyKey)) {
    // Each local listener models one known edge client/NAT group. Client headers
    // cannot choose the forwarded identity, and the backend sees only loopback.
    const proxy = createServer((incoming, outgoing) => {
      const forwarded = { ...incoming.headers };
      delete forwarded["x-real-ip"];
      delete forwarded["x-forwarded-for"];
      if (ip !== null) forwarded["x-real-ip"] = ip;
      const upstream = request(
        origins[index] + incoming.url,
        { method: incoming.method, headers: forwarded },
        (response) => {
          outgoing.writeHead(response.statusCode, response.headers);
          response.pipe(outgoing);
        },
      );
      upstream.on("error", () => {
        outgoing.writeHead(502);
        outgoing.end();
      });
      incoming.pipe(upstream);
    });
    const ready = new Promise((resolve) => proxy.listen(0, "127.0.0.1", () => resolve(proxy)));
    proxies.set(proxyKey, ready);
  }
  const proxy = await proxies.get(proxyKey);
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "127.0.0.1", port: proxy.address().port, path, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.setTimeout(12000, () => req.destroy(new Error("request deadline")));
    req.on("error", reject);
    req.end(body);
  });
}
try {
  await pool.query("TRUNCATE rate_limit_buckets");
  for (let i = 0; i < 6; i++)
    assert.equal(
      (await send(i % 2, "/api/pairing/start", { method: "POST", body: "{}" })).status,
      400,
    );
  const before = (
    await pool.query(
      "SELECT scope,request_count FROM rate_limit_buckets WHERE scope IN ('admit_public','admit_pairing_start') ORDER BY scope",
    )
  ).rows;
  for (let i = 0; i < 30; i++)
    assert.equal(
      (
        await send(i % 2, "/api/pairing/start", {
          method: "POST",
          body: "{}",
          headers: { "x-real-ip": `192.0.2.${i + 1}`, "x-forwarded-for": "198.51.100.1" },
        })
      ).status,
      429,
    );
  assert.deepEqual(
    (
      await pool.query(
        "SELECT scope,request_count FROM rate_limit_buckets WHERE scope IN ('admit_public','admit_pairing_start') ORDER BY scope",
      )
    ).rows,
    before,
  );
  assert.equal(
    (await send(1, "/api/pairing/start", { ip: "127.0.0.3", method: "POST", body: "{}" })).status,
    400,
  );
  results.twoInstancesClientIsolation = "passed";
  results.proxyOverwrite = "passed";
  // Saturate only the shared public-read bucket, retaining auth and sync budgets.
  await pool.query(
    `INSERT INTO rate_limit_buckets(scope,key_hash,window_started_at,request_count,expires_at)
    VALUES ('public_read',$1,to_timestamp(floor(extract(epoch FROM now())/60)*60),120,to_timestamp((floor(extract(epoch FROM now())/60)+1)*60))`,
    [digest("127.0.0.4")],
  );
  for (const headers of [
    {},
    { rsc: "1" },
    { "next-router-prefetch": "1" },
    { purpose: "prefetch" },
  ]) {
    for (const path of ["/", "/u/synthetic-1", "/sitemap.xml"]) {
      const denied = await send(0, path, { ip: "127.0.0.4", headers });
      assert.equal(denied.status, 429);
      assert.equal(denied.headers["retry-after"], "60");
    }
  }
  assert.equal((await send(1, "/api/auth/github/start", { ip: "127.0.0.4" })).status, 307);
  assert.equal(
    (await send(1, "/api/usage", { ip: "127.0.0.4", method: "POST", body: "{}" })).status,
    401,
  );
  results.readIsolationAndHeaders = "passed";
  assert.equal((await send(0, "/?page=99999", { ip: "127.0.0.5" })).status, 404);
  assert.equal((await send(0, "/u/absent-synthetic", { ip: "127.0.0.5" })).status, 404);
  assert.equal(
    (await send(0, "/?page=invalid&period=custom&from=bad&to=bad", { ip: "127.0.0.5" })).status,
    200,
  );
  results.invalidAndAbsent = "passed";
  for (const [ip, key] of [
    [null, "untrusted:missing_header"],
    ["invalid", "untrusted:invalid_header"],
  ]) {
    await pool.query(
      `INSERT INTO rate_limit_buckets(scope,key_hash,window_started_at,request_count,expires_at)
      VALUES ('public_read',$1,to_timestamp(floor(extract(epoch FROM now())/60)*60),20,to_timestamp((floor(extract(epoch FROM now())/60)+1)*60))`,
      [digest(key)],
    );
    assert.equal(
      (await send(0, "/", { ip, headers: { "x-forwarded-for": "198.51.100.99" } })).status,
      429,
    );
  }
  results.missingInvalidAndNatIdentity = "bounded fallback; NAT shares edge identity";

  const priorRank = (await send(0, "/u/synthetic-1", { ip: "127.0.0.6" })).body.match(
    /<strong>#([0-9]+)<\/strong>/,
  )?.[1];
  assert.ok(priorRank);
  fixtureId = (
    await pool.query(
      "INSERT INTO users(github_id,handle) VALUES (999900001,'moderation-fixture') RETURNING id::text",
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO daily_agent_usage(usage_date,user_id,agent_id,tokens) VALUES ((now() AT TIME ZONE 'UTC')::date,$1,'codex',9999999999999999)",
    [fixtureId],
  );
  const session = "synthetic-moderation-owner-session";
  await pool.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 day')",
    [digest(session), fixtureId],
  );
  const installationId = randomUUID(),
    sourceId = randomUUID(),
    accountId = randomUUID();
  const device = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO agent_accounts(id,user_id,agent_id,label,aggregation_mode) VALUES ($1,$2,'opencode','Synthetic','account_max')",
    [accountId, fixtureId],
  );
  await pool.query(
    "INSERT INTO installations(id,user_id,name,status,installation_secret_hash,device_token_hash,connector_version,protocol_version) VALUES ($1,$2,'Synthetic','active',$3,$4,'0.7.2',5)",
    [installationId, fixtureId, digest("synthetic-installation"), digest(device)],
  );
  await pool.query(
    "INSERT INTO installation_sources(id,installation_id,user_id,agent_account_id,client_source_id,agent_id,collection_method,supported_surface,status) VALUES ($1,$2,$3,$4,'synthetic','opencode','opencode_db','cli','active')",
    [sourceId, installationId, fixtureId, accountId],
  );
  const today = new Date().toISOString().slice(0, 10);
  const sync = () =>
    send(1, "/api/usage", {
      ip: "127.0.0.4",
      method: "POST",
      headers: { authorization: `Bearer ${device}`, "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 5,
        snapshots: [
          {
            sourceId,
            syncSequence: "1",
            kind: "rolling",
            rangeStart: today,
            rangeEnd: today,
            completeness: "complete",
            entries: [{ date: today, totalTokens: "1" }],
          },
        ],
      }),
    });
  const liveWork = await Promise.all([
    ...Array.from({ length: 4 }, () => send(1, "/?period=year", { ip: "127.0.0.7" })),
    sync(),
    send(1, "/api/auth/github/start", { ip: "127.0.0.4" }),
  ]);
  assert.equal(liveWork[4].status, 200);
  assert.equal(liveWork[5].status, 307);
  results.validSyncAndOAuthDuringReads = "passed";
  const totalBefore = (
    await pool.query("SELECT tokens::text FROM daily_agent_usage WHERE user_id=$1", [fixtureId])
  ).rows;
  const moderate = (action) =>
    execFileSync(process.execPath, ["apps/web/scripts/moderate.mjs", action, fixtureId], {
      env: process.env,
      stdio: "pipe",
    });
  assert.equal((await send(0, "/u/moderation-fixture", { ip: "127.0.0.6" })).status, 200);
  moderate("hide");
  moderate("hide");
  assert.equal(
    (await send(1, "/u/synthetic-1", { ip: "127.0.0.6" })).body.match(
      /<strong>#([0-9]+)<\/strong>/,
    )?.[1],
    priorRank,
  );
  const privatePage = await send(1, "/dashboard", { headers: { cookie: `vr_session=${session}` } });
  assert.equal(privatePage.status, 200);
  assert.ok(privatePage.body.includes("moderation-fixture"));
  assert.ok(!(await send(1, "/dashboard")).body.includes("moderation-fixture"));
  assert.equal(
    (
      await send(1, "/api/moderation", {
        method: "POST",
        headers: { cookie: `vr_session=${session}`, authorization: `Bearer ${device}` },
        body: "{}",
      })
    ).status,
    404,
  );
  for (let i = 0; i < 2; i++) {
    assert.equal((await send(i, "/u/moderation-fixture", { ip: "127.0.0.6" })).status, 404);
    assert.ok(
      !(await send(i, "/sitemap.xml", { ip: "127.0.0.6" })).body.includes("/u/moderation-fixture"),
    );
    assert.ok(!(await send(i, "/", { ip: "127.0.0.6" })).body.includes("moderation-fixture"));
  }
  assert.deepEqual(
    (await pool.query("SELECT tokens::text FROM daily_agent_usage WHERE user_id=$1", [fixtureId]))
      .rows,
    totalBefore,
  );
  assert.equal(
    (
      await pool.query("SELECT count(*)::int n FROM ranking_moderation_log WHERE user_id=$1", [
        fixtureId,
      ])
    ).rows[0].n,
    1,
  );
  moderate("restore");
  moderate("restore");
  assert.equal((await send(1, "/u/moderation-fixture", { ip: "127.0.0.6" })).status, 200);
  assert.equal(
    (
      await pool.query("SELECT count(*)::int n FROM ranking_moderation_log WHERE user_id=$1", [
        fixtureId,
      ])
    ).rows[0].n,
    2,
  );
  assert.equal(
    Number(
      (await send(1, "/u/synthetic-1", { ip: "127.0.0.6" })).body.match(
        /<strong>#([0-9]+)<\/strong>/,
      )?.[1],
    ),
    Number(priorRank) + 1,
  );
  moderate("hide");
  assert.equal(
    (
      await send(1, "/api/account/delete", {
        method: "POST",
        headers: {
          cookie: `vr_session=${session}`,
          origin: origins[1],
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "confirm=delete-account",
      })
    ).status,
    303,
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM users WHERE id=$1", [fixtureId])).rows[0].n,
    0,
  );
  results.moderationAcrossInstances = "passed";
  const statuses = {},
    times = [];
  for (let batch = 0; batch < 5; batch++) {
    await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const start = performance.now();
        const response = await send(0, "/?period=year", { ip: `127.0.0.${20 + i}` });
        times.push(performance.now() - start);
        statuses[response.status] = (statuses[response.status] ?? 0) + 1;
      }),
    );
  }
  assert.ok(statuses[503] > 0);
  assert.ok(statuses[200] > 0);
  assert.equal(statuses[500], undefined);
  await delay(250);
  assert.equal((await send(0, "/", { ip: "127.0.0.40" })).status, 200);
  times.sort((a, b) => a - b);
  results.boundedLoad = {
    requests: 40,
    concurrency: 8,
    statuses,
    p50: times[19],
    p95: times[37],
    recoveryWithinMs: 250,
  };
  const locked = await pool.connect();
  try {
    await locked.query("BEGIN");
    await locked.query("LOCK daily_agent_usage IN ACCESS EXCLUSIVE MODE");
    const blocked = await send(0, "/", { ip: "127.0.0.41" });
    assert.equal(blocked.status, 503);
    assert.equal(blocked.headers["retry-after"], "1");
  } finally {
    await locked.query("ROLLBACK");
    locked.release();
  }
  results.downstreamSqlTimeout = "503 with Retry-After";
  async function rawHttp(payload) {
    assert.ok(++requests <= 400, "Request budget exceeded");
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: "127.0.0.1", port: 3022 });
      let body = "";
      socket.setTimeout(12000, () => socket.destroy(new Error("raw fixture deadline")));
      socket.on("connect", () => socket.write(payload));
      socket.on("data", (chunk) => {
        body += chunk.toString();
      });
      socket.on("error", reject);
      socket.on("end", () => resolve(Number(body.match(/^HTTP\/1\.1 ([0-9]+)/)?.[1])));
    });
  }
  assert.equal(
    await rawHttp(
      "GET / HTTP/1.1\r\nHost: localhost\r\nX-Large: " +
        "x".repeat(20000) +
        "\r\nConnection: close\r\n\r\n",
    ),
    431,
  );
  assert.equal(
    await rawHttp(
      "POST /api/pairing/start HTTP/1.1\r\nHost: localhost\r\nX-Real-IP: 192.0.2.200\r\nContent-Length: 100\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{",
    ),
    408,
  );
  assert.equal(await rawHttp("GET / HTTP/1.1\r\nHost: localhost\r\nX-Incomplete: "), 408);
  results.headerAndBodyDeadlines = "431 oversized header; 408 slow body and headers";
  results.totalRequests = requests;
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
} finally {
  clearTimeout(timeout);
  if (fixtureId) await pool.query("DELETE FROM users WHERE id=$1", [fixtureId]);
  for (const ready of proxies.values()) {
    const proxy = await ready;
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  }
  await pool.end();
}
