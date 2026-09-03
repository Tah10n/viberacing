import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkWeeklyBridgeContract,
  migrationPath,
  productionSource,
} from "./check-weekly-bridge-contract.mjs";

async function fixture(t, { source, migration }) {
  const cwd = await mkdtemp(join(tmpdir(), "viberacing-weekly-contract-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, "apps/web/database"), { recursive: true });
  await mkdir(join(cwd, "apps/web/lib"), { recursive: true });
  await writeFile(join(cwd, "apps/web/database/011_cleanup.sql"), migration);
  await writeFile(join(cwd, "apps/web/lib/summary.ts"), source);
  return cwd;
}

test("rejects dropping weekly storage while production still references it", async (t) => {
  const cwd = await fixture(t, {
    source: "export const table = 'weekly_agent_usage';\n",
    migration: "DROP TABLE weekly_agent_usage;\n",
  });
  await assert.rejects(checkWeeklyBridgeContract({ cwd }), /code-only cleanup first/);
});

test("allows the contract migration only after production references are gone", async (t) => {
  const cwd = await fixture(t, {
    source: "export const table = 'daily_agent_usage';\n",
    migration: "DROP TRIGGER weekly_agent_usage_daily_compatibility ON weekly_agent_usage;\n",
  });
  await assert.doesNotReject(checkWeeklyBridgeContract({ cwd }));
});

test("ignores prose and test-only references", async (t) => {
  const cwd = await fixture(t, {
    source: "export const table = 'daily_agent_usage';\n",
    migration: "-- DROP TABLE weekly_agent_usage in Deployment B\nSELECT 1;\n",
  });
  await writeFile(
    join(cwd, "apps/web/lib/summary.test.ts"),
    "export const oldTable = 'weekly_agent_usage';\n",
  );
  await assert.doesNotReject(checkWeeklyBridgeContract({ cwd }));
});

test("classifies Windows migration and production paths portably", () => {
  assert.equal(migrationPath("C:\\repo\\apps\\web\\database\\011_cleanup.sql"), true);
  assert.equal(productionSource("C:\\repo\\apps\\web\\lib\\summary.ts"), true);
  assert.equal(productionSource("C:\\repo\\apps\\web\\database\\helper.ts"), false);
  assert.equal(productionSource("C:\\repo\\apps\\web\\e2e\\dashboard.ts"), false);
  assert.equal(productionSource("C:\\repo\\apps\\web\\lib\\summary.test.ts"), false);
});

test("rejects removing the inner refresh helper while production references remain", async (t) => {
  const cwd = await fixture(t, {
    source: "export const table = 'weekly_agent_usage';\n",
    migration: "DROP FUNCTION refresh_daily_agent_usage_compatibility(date, bigint, varchar);\n",
  });
  await assert.rejects(checkWeeklyBridgeContract({ cwd }), /code-only cleanup first/);
});

test("rejects removing the source coverage bridge while production references remain", async (t) => {
  const cwd = await fixture(t, {
    source: "export const trigger = 'installation_sources_legacy_partial_coverage';\n",
    migration:
      "DROP FUNCTION materialize_legacy_partial_source_coverage();\nDROP TRIGGER installation_sources_legacy_partial_coverage ON installation_sources;\n",
  });
  await assert.rejects(checkWeeklyBridgeContract({ cwd }), /code-only cleanup first/);
});
