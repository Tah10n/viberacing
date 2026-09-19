import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { writeFile, readFile } from "node:fs/promises";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { Pool } = require("pg");
if (process.env.VIBERACING_TEST_ADMISSION_DATABASE !== "synthetic-local")
  throw Error("explicit synthetic opt-in required");
const deadline = setTimeout(() => process.exit(1), 120000);
const pool = new Pool({
  connectionString: "postgresql://viberacing:synthetic-local@127.0.0.1:55439/viberacing",
});
const origin = process.argv[2];
if (!["http://127.0.0.1:3021", "http://127.0.0.1:3022"].includes(origin))
  throw Error("isolated origin required");
if (process.argv.includes("--seed")) {
  await pool.query("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
  await pool.query(
    "INSERT INTO users (github_id,handle) SELECT 900000000+i, 'synthetic-'||i FROM generate_series(1,2000) i ON CONFLICT DO NOTHING",
  );
  await pool.query(
    "INSERT INTO daily_agent_usage(usage_date,user_id,agent_id,tokens) SELECT d::date,u.id,a.agent,((u.id*12347+extract(doy FROM d)::int*71)%1000000+1) FROM users u CROSS JOIN generate_series(date_trunc('year',now()),date_trunc('day',now()),interval '1 day') d CROSS JOIN (VALUES ('codex'),('opencode')) a(agent) WHERE u.handle LIKE 'synthetic-%' ON CONFLICT DO NOTHING",
  );
  await pool.query("ANALYZE");
}
const today = new Date().toISOString().slice(0, 10);
const scenarios = [
  "/",
  "/?period=year",
  `/?period=custom&from=${today.slice(0, 4)}-02-01&to=${today}`,
  "/?page=2",
  "/?page=99999",
  "/u/synthetic-1",
  "/u/synthetic-absent",
  "/sitemap.xml",
];
const pid = execFileSync("lsof", ["-tiTCP:" + new URL(origin).port, "-sTCP:LISTEN"], {
  encoding: "utf8",
}).trim();
if (!/^[0-9]+$/.test(pid)) throw Error("expected one isolated server process");
const rss = () =>
  Number(execFileSync("ps", ["-o", "rss=", "-p", pid], { encoding: "utf8" }).trim());
const initialRssKiB = rss();
const initialBuckets = (await pool.query("SELECT count(*)::int n FROM rate_limit_buckets")).rows[0]
  .n;
let peakRssKiB = initialRssKiB;
const output = [];
for (const route of scenarios) {
  await fetch(origin + route, {
    headers: { "x-real-ip": `192.0.2.${scenarios.indexOf(route) + 10}` },
  }).then((r) => r.arrayBuffer());
  await pool.query("SELECT pg_stat_statements_reset()");
  const times = [],
    statuses = {};
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    const r = await fetch(origin + route, {
      headers: { "x-real-ip": `192.0.2.${scenarios.indexOf(route) + 10}` },
    });
    await r.arrayBuffer();
    times.push(performance.now() - start);
    statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  }
  peakRssKiB = Math.max(peakRssKiB, rss());
  times.sort((a, b) => a - b);
  const stats = (
    await pool.query(
      "SELECT sum(calls)::int calls,round(sum(total_exec_time)::numeric,2)::text sql_ms FROM pg_stat_statements WHERE query NOT LIKE '%pg_stat_statements%' AND query NOT LIKE 'SET %'",
    )
  ).rows[0];
  output.push({ route, p50: times[9], p95: times[18], statuses, ...stats });
}
const loadStart = performance.now();
const loadTimes = [],
  loadStatuses = {};
for (let batch = 0; batch < 5; batch++) {
  await Promise.all(
    Array.from({ length: 8 }, async (_, index) => {
      const started = performance.now();
      const response = await fetch(origin + "/?period=year", {
        headers: { "x-real-ip": `192.0.2.${100 + index}` },
      });
      await response.arrayBuffer();
      loadTimes.push(performance.now() - started);
      loadStatuses[response.status] = (loadStatuses[response.status] ?? 0) + 1;
    }),
  );
  peakRssKiB = Math.max(peakRssKiB, rss());
}
const elapsedSeconds = (performance.now() - loadStart) / 1000;
loadTimes.sort((a, b) => a - b);
await new Promise((resolve) => setTimeout(resolve, 250));
const recovery = await fetch(origin + "/", { headers: { "x-real-ip": "192.0.2.220" } });
await recovery.arrayBuffer();
const load = {
  requests: 40,
  concurrency: 8,
  statuses: loadStatuses,
  p50: loadTimes[19],
  p95: loadTimes[37],
  elapsedSeconds,
  observedCompletedRps: 40 / elapsedSeconds,
  recoveryStatusAfter250ms: recovery.status,
};
await writeFile(
  process.argv[3],
  JSON.stringify(
    {
      users: 2000,
      agents: 2,
      samples: 20,
      concurrency: 1,
      load,
      initialRssKiB,
      peakRssKiB,
      initialBuckets,
      finalBuckets: (await pool.query("SELECT count(*)::int n FROM rate_limit_buckets")).rows[0].n,
      results: output,
    },
    null,
    2,
  ),
);
const sources = {
  before: execFileSync(
    "git",
    ["show", "e5e5000db9fef6257e7a831a85e93f7d1aceb68a:apps/web/lib/leaderboard.ts"],
    { encoding: "utf8" },
  ),
  after: await readFile(new URL("../apps/web/lib/leaderboard.ts", import.meta.url), "utf8"),
};
const plans = {};
for (const [version, source] of Object.entries(sources)) {
  const ranked = source.match(/const rankedSummarySql = `([^`]+)`;/)[1];
  const visibility = source.match(/const publicProfileVisibilitySql = `([^`]+)`;/)[1];
  const sql = [...source.matchAll(/`(\$\{rankedSummarySql\}[^`]+)`/g)].map((m) =>
    m[1]
      .replace("${rankedSummarySql}", ranked)
      .replace("${publicProfileVisibilitySql}", visibility),
  );
  const week = new Date(today + "T00:00:00Z");
  week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
  const end = new Date(week);
  end.setUTCDate(end.getUTCDate() + 7);
  const ranges = {
    week: [week.toISOString().slice(0, 10), end.toISOString().slice(0, 10)],
    year: [today.slice(0, 4) + "-01-01", String(Number(today.slice(0, 4)) + 1) + "-01-01"],
    custom: [today.slice(0, 4) + "-02-01", today],
  };
  for (const [period, range] of Object.entries(ranges)) {
    plans[version + ":" + period] = (
      await pool.query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql[0], [...range, 101, 0])
    ).rows;
  }
  for (const page of [2, 99999])
    plans[version + ":page" + page] = (
      await pool.query(
        "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " +
          (version === "after" && page === 99999
            ? "SELECT count(*)::text AS count FROM users"
            : sql[0]),
        version === "after" && page === 99999 ? [] : [...ranges.week, 101, (page - 1) * 100],
      )
    ).rows;
  for (const handle of ["synthetic-1", "synthetic-absent"])
    plans[version + ":" + handle] = (
      await pool.query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql[1], [
        ...ranges.week,
        handle,
      ])
    ).rows;
}
await writeFile(process.argv[3] + ".plans.json", JSON.stringify(plans, null, 2));
await pool.end();
clearTimeout(deadline);
