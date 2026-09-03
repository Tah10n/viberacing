import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = new Set([".js", ".mjs", ".ts", ".tsx"]);

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else files.push(path);
  }
  return files;
}

function portablePath(path) {
  return path.replaceAll("\\", "/");
}

export function productionSource(path) {
  const normalized = portablePath(path);
  return (
    sourceExtensions.has(extname(normalized)) &&
    !/\.(?:test|spec)\.[^.]+$/.test(normalized) &&
    !normalized.includes("/database/") &&
    !normalized.includes("/e2e/")
  );
}

export function migrationPath(path) {
  return /^\d{3}_[a-z0-9_]+\.sql$/.test(portablePath(path).split("/").at(-1) ?? "");
}

function withoutSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

export async function checkWeeklyBridgeContract({ cwd = root } = {}) {
  const migrations = (await filesUnder(resolve(cwd, "apps/web/database"))).filter(migrationPath);
  const destructive = [];
  for (const path of migrations) {
    const sql = withoutSqlComments(await readFile(path, "utf8"));
    const dropsTable =
      /\bDROP\s+TABLE(?:\s+IF\s+EXISTS)?\s+(?:public\.)?weekly_agent_usage\b/i.test(sql);
    const removesTrigger =
      /\bDROP\s+TRIGGER(?:\s+IF\s+EXISTS)?\s+weekly_agent_usage_daily_compatibility\b/i.test(sql) &&
      !/\bCREATE\s+TRIGGER\s+weekly_agent_usage_daily_compatibility\b/i.test(sql);
    const removesFunction =
      /\bDROP\s+FUNCTION(?:\s+IF\s+EXISTS)?\s+mirror_weekly_agent_usage_to_daily\b/i.test(sql) &&
      !/\bCREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+mirror_weekly_agent_usage_to_daily\b/i.test(sql);
    const removesRefreshFunction =
      /\bDROP\s+FUNCTION(?:\s+IF\s+EXISTS)?\s+refresh_daily_agent_usage_compatibility\b/i.test(
        sql,
      ) &&
      !/\bCREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+refresh_daily_agent_usage_compatibility\b/i.test(
        sql,
      );
    if (dropsTable || removesTrigger || removesFunction || removesRefreshFunction)
      destructive.push(path);
  }
  if (destructive.length === 0) return;

  const applicationFiles = (await filesUnder(resolve(cwd, "apps/web"))).filter(productionSource);
  const references = [];
  for (const path of applicationFiles) {
    const source = await readFile(path, "utf8");
    if (/weekly_agent_usage|weekly_agent_usage_daily_compatibility/.test(source))
      references.push(path);
  }
  if (references.length > 0)
    throw new Error(
      "A destructive weekly compatibility migration is forbidden while production application references remain. Deploy code-only cleanup first.",
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkWeeklyBridgeContract();
  process.stdout.write("Weekly compatibility bridge contract passed.\n");
}
