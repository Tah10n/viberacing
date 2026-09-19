import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const origin = process.argv[2];
assert.equal(origin, "http://127.0.0.1:3024");
assert.equal(process.env.VIBERACING_TEST_ADMISSION_DATABASE, "synthetic-local");
const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "55439");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const pool = new (require("pg").Pool)({ connectionString: url.href, max: 2 });
const deadline = setTimeout(() => {
  process.stderr.write("Static asset fixture deadline\n");
  process.exit(1);
}, 15000);
const fixture = await mkdtemp(join(tmpdir(), "viberacing-static-"));
const request = (path) =>
  fetch(origin + path, {
    headers: { "x-real-ip": "192.0.2.99" },
    signal: AbortSignal.timeout(5000),
  });
let blocked = [];
let locked;
try {
  await (await request("/")).arrayBuffer();
  const fontPath = "/fonts/barlow-regular.ttf";
  const archivePath = "/downloads/viberacing-connector.tgz";
  const expectedFont = await readFile(new URL(`../apps/web/public${fontPath}`, import.meta.url));
  const expectedArchive = await readFile(
    new URL(`../apps/web/public${archivePath}`, import.meta.url),
  );
  locked = await pool.connect();
  await locked.query("BEGIN");
  await locked.query("LOCK daily_agent_usage IN ACCESS EXCLUSIVE MODE");
  const {
    rows: [{ pid }],
  } = await locked.query("SELECT pg_backend_pid() AS pid");
  blocked = Array.from({ length: 4 }, () =>
    request("/").then(async (r) => ({ status: r.status, body: await r.arrayBuffer() })),
  );
  let count = 0;
  for (let i = 0; i < 60; i++) {
    const { rows } = await pool.query(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))",
      [pid],
    );
    count = rows[0].count;
    if (count === 4) break;
    await delay(5);
  }
  assert.equal(count, 4, "Four dynamic requests must actually be blocked");
  const [font, archive, extra, unknown] = await Promise.all(
    [fontPath, archivePath, "/", "/fonts/not-an-asset"].map(async (path) => {
      const r = await request(path);
      return { status: r.status, body: Buffer.from(await r.arrayBuffer()) };
    }),
  );
  await locked.query("ROLLBACK");
  locked.release();
  locked = undefined;
  assert.equal(extra.status, 503);
  assert.equal(unknown.status, 503);
  assert.equal(font.status, 200);
  assert.equal(archive.status, 200);
  assert.deepEqual(font.body, expectedFont);
  assert.deepEqual(archive.body, expectedArchive);
  assert.deepEqual(
    (await Promise.all(blocked)).map((r) => r.status),
    [200, 200, 200, 200],
  );
  const file = join(fixture, "connector.tgz");
  await writeFile(file, archive.body);
  const pkg = JSON.parse(
    execFileSync("tar", ["-xOf", file, "package/package.json"], { encoding: "utf8" }),
  );
  assert.equal(pkg.name, "@viberacing/connector");
  assert.equal(
    pkg.version,
    JSON.parse(
      await readFile(new URL("../packages/connector/package.json", import.meta.url), "utf8"),
    ).version,
  );
  console.log(
    "Passed: four blocked pages; font and verified connector archive 200; extra page and unknown asset 503; blocked pages recover 200.",
  );
} finally {
  if (locked) {
    await locked.query("ROLLBACK");
    locked.release();
  }
  await Promise.allSettled(blocked);
  await pool.end();
  await rm(fixture, { recursive: true, force: true });
  clearTimeout(deadline);
}
