import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const baselinePath = "apps/web/database/BASELINE.md";
const migrationsPathspec = "apps/web/database/*.sql";
const migrationPattern = /^apps\/web\/database\/(\d{3})_[a-z0-9_]+\.sql$/;

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

async function requireCommit(cwd, revision) {
  try {
    await git(cwd, ["cat-file", "-e", `${revision}^{commit}`]);
  } catch {
    throw new Error(`Migration history revision is not an available commit: ${revision}`);
  }
}

async function objectExists(cwd, revision, path) {
  try {
    await git(cwd, ["cat-file", "-e", `${revision}:${path}`]);
    return true;
  } catch {
    return false;
  }
}

async function changedPaths(cwd, base, head, diffFilter, pathspec) {
  const args = ["diff"];
  if (diffFilter !== undefined) args.push(`--diff-filter=${diffFilter}`);
  args.push("--name-only", base, head, "--", pathspec);
  const output = await git(cwd, args);
  return output === "" ? [] : output.split("\n");
}

export async function checkMigrationHistory({ cwd = process.cwd(), base, head = "HEAD" }) {
  await requireCommit(cwd, base);
  await requireCommit(cwd, head);

  const baseHasBaseline = await objectExists(cwd, base, baselinePath);
  const headHasBaseline = await objectExists(cwd, head, baselinePath);
  if (!headHasBaseline) {
    throw new Error(`The locked database baseline marker must exist at ${baselinePath}`);
  }
  if (!baseHasBaseline) {
    return "Established the first locked pre-production database baseline.";
  }

  const baselineChanges = await changedPaths(cwd, base, head, undefined, baselinePath);
  if (baselineChanges.length > 0) {
    throw new Error(
      `The locked database baseline marker is append-only: ${baselineChanges.join(", ")}`,
    );
  }

  const migrationChanges = await changedPaths(cwd, base, head, undefined, migrationsPathspec);
  const addedMigrations = await changedPaths(cwd, base, head, "A", migrationsPathspec);
  const addedMigrationSet = new Set(addedMigrations);
  const publishedChanges = migrationChanges.filter((path) => !addedMigrationSet.has(path));
  if (publishedChanges.length > 0) {
    throw new Error(`Published migrations are append-only: ${publishedChanges.join(", ")}`);
  }

  const baseTree = await git(cwd, [
    "ls-tree",
    "-r",
    "--name-only",
    base,
    "--",
    "apps/web/database",
  ]);
  const baseNumbers = baseTree
    .split("\n")
    .map((path) => migrationPattern.exec(path)?.[1])
    .filter((number) => number !== undefined)
    .map(Number);
  const baseMaximum = baseNumbers.length === 0 ? undefined : Math.max(...baseNumbers);
  for (const path of addedMigrations) {
    const match = migrationPattern.exec(path);
    if (match === null) throw new Error(`Invalid migration filename: ${path}`);
    const number = Number(match[1]);
    if (baseMaximum !== undefined && number <= baseMaximum) {
      throw new Error(
        `Added migration ${path.split("/").at(-1)} must be numbered above base maximum ${String(baseMaximum).padStart(3, "0")}`,
      );
    }
  }

  return `Migration history passed: ${addedMigrations.length} new append-only migration(s).`;
}

const mainModule = process.argv[1] === undefined ? undefined : pathToFileURL(process.argv[1]).href;
if (mainModule === import.meta.url) {
  const [base, head = "HEAD", ...extra] = process.argv.slice(2);
  if (base === undefined || extra.length > 0) {
    throw new Error("Usage: node scripts/check-migration-history.mjs <base-commit> [head-commit]");
  }
  process.stdout.write(`${await checkMigrationHistory({ base, head })}\n`);
}
