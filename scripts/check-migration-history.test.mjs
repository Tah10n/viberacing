import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { checkMigrationHistory } from "./check-migration-history.mjs";

const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout.trim();
}

async function commit(cwd, message) {
  await git(cwd, "add", "--all");
  await git(cwd, "commit", "--quiet", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

async function repository() {
  const cwd = await mkdtemp(join(tmpdir(), "viberacing-migration-history-"));
  await git(cwd, "init", "--quiet");
  await git(cwd, "config", "user.name", "Vibe Racing tests");
  await git(cwd, "config", "user.email", "tests@viberacing.local");
  await mkdir(join(cwd, "apps/web/database"), { recursive: true });
  await writeFile(join(cwd, "apps/web/database/001_initial.sql"), "SELECT 1;\n");
  return cwd;
}

async function lockedRepository() {
  const cwd = await repository();
  await writeFile(join(cwd, "apps/web/database/BASELINE.md"), "# Locked baseline\n");
  const base = await commit(cwd, "locked baseline");
  return { cwd, base };
}

test("the first baseline may replace unpublished migration history and locks the marker", async (t) => {
  const cwd = await repository();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const base = await commit(cwd, "unpublished migrations");
  await writeFile(join(cwd, "apps/web/database/001_initial.sql"), "SELECT 2;\n");
  await writeFile(join(cwd, "apps/web/database/BASELINE.md"), "# Locked baseline\n");
  const head = await commit(cwd, "establish baseline");

  await assert.doesNotReject(checkMigrationHistory({ cwd, base, head }));
});

test("an established baseline marker cannot be deleted to bypass migration checks", async (t) => {
  const { cwd, base } = await lockedRepository();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await unlink(join(cwd, "apps/web/database/BASELINE.md"));
  const head = await commit(cwd, "remove marker");

  await assert.rejects(checkMigrationHistory({ cwd, base, head }), /baseline marker must exist/);
});

test("an established baseline marker cannot be changed", async (t) => {
  const { cwd, base } = await lockedRepository();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "apps/web/database/BASELINE.md"), "# Weakened baseline\n");
  const head = await commit(cwd, "change marker");
  await assert.rejects(checkMigrationHistory({ cwd, base, head }), /marker is append-only/);
});

test("an established published migration cannot be changed", async (t) => {
  const { cwd, base } = await lockedRepository();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "apps/web/database/001_initial.sql"), "SELECT 2;\n");
  const head = await commit(cwd, "change migration");
  await assert.rejects(checkMigrationHistory({ cwd, base, head }), /migrations are append-only/);
});

test("an established baseline accepts a higher-numbered new migration", async (t) => {
  const { cwd, base } = await lockedRepository();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "apps/web/database/002_next.sql"), "SELECT 2;\n");
  const head = await commit(cwd, "add next migration");
  await assert.doesNotReject(checkMigrationHistory({ cwd, base, head }));
});

test("an established baseline rejects a lower-numbered new migration", async (t) => {
  const { cwd, base } = await lockedRepository();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "apps/web/database/000_old.sql"), "SELECT 0;\n");
  const head = await commit(cwd, "add old migration");
  await assert.rejects(checkMigrationHistory({ cwd, base, head }), /above base maximum 001/);
});

test("an established baseline rejects duplicate new migration numbers", async (t) => {
  const { cwd, base } = await lockedRepository();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "apps/web/database/002_first.sql"), "SELECT 2;\n");
  await writeFile(join(cwd, "apps/web/database/002_second.sql"), "SELECT 3;\n");
  const head = await commit(cwd, "add duplicate migration numbers");
  await assert.rejects(
    checkMigrationHistory({ cwd, base, head }),
    /Duplicate migration number 002/,
  );
});

test("an established baseline rejects gaps in new migration numbers", async (t) => {
  const { cwd, base } = await lockedRepository();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "apps/web/database/003_later.sql"), "SELECT 3;\n");
  const head = await commit(cwd, "skip a migration number");
  await assert.rejects(checkMigrationHistory({ cwd, base, head }), /expected 002, found 003/);
});

test("an established baseline accepts multiple sequential new migrations", async (t) => {
  const { cwd, base } = await lockedRepository();
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "apps/web/database/002_first.sql"), "SELECT 2;\n");
  await writeFile(join(cwd, "apps/web/database/003_second.sql"), "SELECT 3;\n");
  const head = await commit(cwd, "add sequential migrations");
  await assert.doesNotReject(checkMigrationHistory({ cwd, base, head }));
});

test("the production workflow checks migration history on pull requests and main pushes", async () => {
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(
    workflow,
    /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \}\}/,
  );
  assert.doesNotMatch(workflow, /if: github\.event_name == 'pull_request'/);
});
