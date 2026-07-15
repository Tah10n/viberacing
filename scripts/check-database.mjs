import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const manifestPath = "database/migrations/manifest.json";
const bootstrapPath = "database/roles/bootstrap.sql";
const migrationPathPattern = /^database\/migrations\/(\d{4})_([a-z][a-z0-9_]{2,62})\.sql$/;
const assertionPathPattern = /^database\/tests\/[a-z][a-z0-9_]*_assertions\.sql$/;
const runtimeRolePattern = /\bviberacing_(?:web|ingest|jobs|admin)\b/i;
const missingRowUnsafeAssertionPattern = /\bIF\s+NOT\s*\(\s*SELECT\b/i;

function exactKeys(value, expected) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function digest(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function maskSqlCommentsAndQuotedText(sql) {
  let masked = "";
  let index = 0;
  const appendMasked = (value) => {
    masked += value === "\r" || value === "\n" ? value : " ";
  };

  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];

    if (current === "'" || current === '"') {
      const quote = current;
      appendMasked(current);
      index += 1;
      while (index < sql.length) {
        const quoted = sql[index];
        appendMasked(quoted);
        index += 1;
        if (quoted !== quote) {
          continue;
        }
        if (sql[index] === quote) {
          appendMasked(sql[index]);
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }

    if (current === "-" && next === "-") {
      appendMasked(current);
      appendMasked(next);
      index += 2;
      while (index < sql.length && sql[index] !== "\r" && sql[index] !== "\n") {
        appendMasked(sql[index]);
        index += 1;
      }
      continue;
    }

    if (current === "/" && next === "*") {
      let depth = 1;
      appendMasked(current);
      appendMasked(next);
      index += 2;
      while (index < sql.length && depth > 0) {
        const commentCurrent = sql[index];
        const commentNext = sql[index + 1];
        if (commentCurrent === "/" && commentNext === "*") {
          depth += 1;
          appendMasked(commentCurrent);
          appendMasked(commentNext);
          index += 2;
          continue;
        }
        if (commentCurrent === "*" && commentNext === "/") {
          depth -= 1;
          appendMasked(commentCurrent);
          appendMasked(commentNext);
          index += 2;
          continue;
        }
        appendMasked(commentCurrent);
        index += 1;
      }
      continue;
    }

    masked += current;
    index += 1;
  }

  return masked;
}

export function validateMigrationSql(path, sql) {
  const findings = [];
  const pathMatch = migrationPathPattern.exec(path);
  if (!pathMatch) {
    return ["migration path must use database/migrations/NNNN_snake_case.sql"];
  }
  const revision = Number.parseInt(pathMatch[1], 10);
  const name = pathMatch[2];

  if (typeof sql !== "string" || sql.length === 0) {
    return ["migration must be non-empty UTF-8 text"];
  }
  if (Buffer.byteLength(sql, "utf8") > 512 * 1024) {
    findings.push("migration exceeds the reviewed 512 KiB source limit");
  }
  if (!/^\\set ON_ERROR_STOP on\r?$/m.test(sql)) {
    findings.push("migration must make psql stop on the first error");
  }
  if (!/^BEGIN;\r?$/m.test(sql) || !/^COMMIT;\r?$/m.test(sql)) {
    findings.push("migration must use one explicit transaction");
  }
  if (!/^SET LOCAL ROLE viberacing_owner;\r?$/m.test(sql)) {
    findings.push("migration must execute as the non-login schema owner");
  }
  if (!/^SET LOCAL lock_timeout = '[^']+';\r?$/m.test(sql)) {
    findings.push("migration must bound lock acquisition time");
  }
  if (!/^SET LOCAL statement_timeout = '[^']+';\r?$/m.test(sql)) {
    findings.push("migration must bound statement execution time");
  }
  if (!/\bpg_catalog\.pg_advisory_xact_lock\s*\(/i.test(sql)) {
    findings.push("migration must serialize through a transaction advisory lock");
  }

  const unsafePatterns = [
    [/\\(?:i|include|ir|include_relative)\b/i, "psql file inclusion is forbidden"],
    [/\bCOPY\b[\s\S]{0,300}\bPROGRAM\b/i, "COPY PROGRAM is forbidden"],
    [/\bCREATE\s+EXTENSION\b/i, "extensions require a separate reviewed dependency decision"],
    [/\bALTER\s+SYSTEM\b/i, "ALTER SYSTEM is forbidden in application migrations"],
    [/\bCREATE\s+ROLE\b/i, "cluster roles belong only in the reviewed bootstrap"],
    [/\bALTER\s+ROLE\b/i, "cluster role mutation belongs only in the reviewed bootstrap"],
  ];
  for (const [pattern, message] of unsafePatterns) {
    if (pattern.test(sql)) {
      findings.push(message);
    }
  }

  for (const statement of sql.split(";")) {
    if (!/^\s*GRANT\b/i.test(statement)) {
      continue;
    }
    if (/\bTO\s+PUBLIC\b/i.test(statement)) {
      findings.push("migrations must never grant a capability to PUBLIC");
    }
    if (
      runtimeRolePattern.test(statement) &&
      /\bON\s+(?:(?:ALL\s+)?TABLES?|(?:ALL\s+)?SEQUENCES?)\b/i.test(statement)
    ) {
      findings.push("runtime roles must not receive direct table or sequence grants");
    }
  }

  const functionSegments = sql.split(/(?=CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\b)/i).slice(1);
  for (const segment of functionSegments) {
    if (
      /\bSECURITY\s+DEFINER\b/i.test(segment) &&
      !/\bSET\s+search_path\s*=\s*pg_catalog\s*,\s*pg_temp\b/i.test(segment)
    ) {
      findings.push("every SECURITY DEFINER function must pin search_path to pg_catalog, pg_temp");
    }
  }

  const migrationRecord = new RegExp(
    `INSERT\\s+INTO\\s+viberacing_private\\.schema_migrations[\\s\\S]{0,240}VALUES\\s*\\(\\s*${revision}\\s*,\\s*'${name}'\\s*\\)`,
    "i",
  );
  if (!migrationRecord.test(sql)) {
    findings.push("migration must record its exact filename revision and name");
  }
  return [...new Set(findings)];
}

export function validateBootstrapSql(sql) {
  const findings = [];
  const roles = [
    "viberacing_owner",
    "viberacing_web",
    "viberacing_ingest",
    "viberacing_jobs",
    "viberacing_admin",
  ];
  if (!/^\\set ON_ERROR_STOP on\r?$/m.test(sql)) {
    findings.push("role bootstrap must make psql stop on the first error");
  }
  if (!/^BEGIN;\r?$/m.test(sql) || !/^COMMIT;\r?$/m.test(sql)) {
    findings.push("role bootstrap must be transactional");
  }
  for (const role of roles) {
    if (!sql.includes(`'${role}'::name`)) {
      findings.push(`role bootstrap must declare ${role}`);
    }
    const alteration = new RegExp(`ALTER\\s+ROLE\\s+${role}[\\s\\S]{0,240}?;`, "i").exec(sql)?.[0];
    for (const option of [
      "NOLOGIN",
      "NOSUPERUSER",
      "NOCREATEDB",
      "NOCREATEROLE",
      "NOINHERIT",
      "NOREPLICATION",
      "NOBYPASSRLS",
      "PASSWORD NULL",
    ]) {
      if (!alteration?.toUpperCase().includes(option)) {
        findings.push(`${role} must enforce ${option}`);
      }
    }
  }
  if (
    !/GRANT\s+viberacing_owner\s+TO\s+CURRENT_USER\s+WITH\s+INHERIT\s+FALSE\s*,\s*SET\s+TRUE/i.test(
      sql,
    )
  ) {
    findings.push("only the protected bootstrap principal may SET ROLE to the owner");
  }
  if (/GRANT\s+viberacing_owner\s+TO\s+viberacing_(?:web|ingest|jobs|admin)/i.test(sql)) {
    findings.push("a runtime role must never become a member of the owner role");
  }
  if (!/REVOKE\s+ALL\s+ON\s+DATABASE[\s\S]{0,120}\sFROM\s+PUBLIC/i.test(sql)) {
    findings.push("bootstrap must revoke default database capability from PUBLIC");
  }
  if (!/GRANT\s+CONNECT\s+ON\s+DATABASE[\s\S]{0,120}\sTO\s+CURRENT_USER/i.test(sql)) {
    findings.push("bootstrap must preserve connect for the protected migration principal");
  }
  if (!/ALTER\s+DATABASE\s+%I\s+SET\s+search_path\s+TO\s+pg_catalog\s*,\s*pg_temp/i.test(sql)) {
    findings.push("database default search_path must exclude writable schemas");
  }
  if (!/REVOKE\s+ALL\s+ON\s+SCHEMA\s+public\s+FROM\s+PUBLIC/i.test(sql)) {
    findings.push("bootstrap must lock the default public schema");
  }
  if (
    !/ALTER\s+ROLE\s+%I\s+IN\s+DATABASE\s+%I\s+SET\s+search_path\s+TO\s+pg_catalog\s*,\s*pg_temp/i.test(
      sql,
    )
  ) {
    findings.push("runtime search_path must be pinned per database");
  }
  if (/PASSWORD\s+(?!NULL\b)(?:'[^']*'|\S+)/i.test(sql)) {
    findings.push("tracked SQL must not contain a role password");
  }
  return [...new Set(findings)];
}

export function validateAssertionSql(path, sql) {
  if (!assertionPathPattern.test(path)) {
    return ["assertion path must use database/tests/*_assertions.sql"];
  }
  if (typeof sql !== "string" || sql.length === 0) {
    return ["assertion file must be non-empty UTF-8 text"];
  }
  if (Buffer.byteLength(sql, "utf8") > 512 * 1024) {
    return ["assertion file exceeds the reviewed 512 KiB source limit"];
  }
  if (missingRowUnsafeAssertionPattern.test(maskSqlCommentsAndQuotedText(sql))) {
    return [
      "scalar-subquery IF NOT assertions are missing-row unsafe; use IF NOT EXISTS with the expected state in its predicate",
    ];
  }
  return [];
}

export function validateManifest(manifest, filesByPath) {
  const findings = [];
  if (!exactKeys(manifest, ["schemaVersion", "migrations"])) {
    return ["manifest must contain only schemaVersion and migrations"];
  }
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.migrations)) {
    return ["manifest must use schemaVersion 1 with a migrations array"];
  }

  let previousRevision = 0;
  const listedPaths = new Set();
  const names = new Set();
  for (const [index, entry] of manifest.migrations.entries()) {
    const scope = `migration entry ${index + 1}`;
    if (!exactKeys(entry, ["revision", "name", "path", "sha256"])) {
      findings.push(`${scope} has an invalid shape`);
      continue;
    }
    if (!Number.isInteger(entry.revision) || entry.revision !== previousRevision + 1) {
      findings.push(`${scope} revisions must be contiguous and start at 1`);
    }
    previousRevision = entry.revision;
    if (typeof entry.name !== "string" || !/^[a-z][a-z0-9_]{2,62}$/.test(entry.name)) {
      findings.push(`${scope} name must be bounded snake_case`);
    }
    if (names.has(entry.name)) {
      findings.push(`${scope} duplicates migration name ${entry.name}`);
    }
    names.add(entry.name);

    const pathMatch = typeof entry.path === "string" ? migrationPathPattern.exec(entry.path) : null;
    if (
      pathMatch === null ||
      Number.parseInt(pathMatch[1], 10) !== entry.revision ||
      pathMatch[2] !== entry.name
    ) {
      findings.push(`${scope} path must match its zero-padded revision and name`);
    }
    if (listedPaths.has(entry.path)) {
      findings.push(`${scope} duplicates migration path ${entry.path}`);
    }
    listedPaths.add(entry.path);
    if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      findings.push(`${scope} sha256 must be a lowercase SHA-256 digest`);
    }

    const content = filesByPath.get(entry.path);
    if (content === undefined) {
      findings.push(`${scope} file is missing`);
      continue;
    }
    if (digest(content) !== entry.sha256) {
      findings.push(`${scope} checksum does not match the reviewed migration`);
    }
    for (const finding of validateMigrationSql(entry.path, content)) {
      findings.push(`${scope} — ${finding}`);
    }
  }

  for (const path of filesByPath.keys()) {
    if (!listedPaths.has(path)) {
      findings.push(`unlisted migration file: ${path}`);
    }
  }
  return findings;
}

function readSafeFile(path, failures) {
  const absolutePath = resolve(root, path);
  const rootPrefix = `${root}${sep}`;
  if (absolutePath !== root && !absolutePath.startsWith(rootPrefix)) {
    failures.push(`${path} — resolved path escapes the repository`);
    return null;
  }
  if (!existsSync(absolutePath)) {
    failures.push(`${path} — required file is missing`);
    return null;
  }
  if (lstatSync(absolutePath).isSymbolicLink()) {
    failures.push(`${path} — symbolic files are not allowed`);
    return null;
  }
  return readFileSync(absolutePath, "utf8");
}

function main() {
  const failures = [];
  const manifestText = readSafeFile(manifestPath, failures);
  const bootstrapText = readSafeFile(bootstrapPath, failures);
  if (manifestText === null || bootstrapText === null) {
    report(failures);
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    failures.push(`${manifestPath} — invalid JSON: ${error.message}`);
    report(failures);
    return;
  }

  const filesByPath = new Map();
  const migrationDirectory = resolve(root, "database", "migrations");
  for (const entry of readdirSync(migrationDirectory, { withFileTypes: true })) {
    if (entry.name === "manifest.json") {
      continue;
    }
    const path = `database/migrations/${entry.name}`;
    if (entry.isSymbolicLink() || !entry.isFile()) {
      failures.push(`${path} — migration entries must be regular files`);
      continue;
    }
    if (!entry.name.endsWith(".sql")) {
      failures.push(`${path} — migration directory accepts only SQL and manifest.json`);
      continue;
    }
    filesByPath.set(path, readFileSync(resolve(migrationDirectory, entry.name), "utf8"));
  }

  for (const finding of validateManifest(manifest, filesByPath)) {
    failures.push(`${manifestPath} — ${finding}`);
  }
  for (const finding of validateBootstrapSql(bootstrapText)) {
    failures.push(`${bootstrapPath} — ${finding}`);
  }

  const testsDirectory = resolve(root, "database", "tests");
  for (const entry of readdirSync(testsDirectory, { withFileTypes: true })) {
    if (!entry.name.endsWith("_assertions.sql")) {
      continue;
    }
    const path = `database/tests/${entry.name}`;
    if (entry.isSymbolicLink() || !entry.isFile()) {
      failures.push(`${path} — assertion entries must be regular files`);
      continue;
    }
    const sql = readFileSync(resolve(testsDirectory, entry.name), "utf8");
    for (const finding of validateAssertionSql(path, sql)) {
      failures.push(`${path} — ${finding}`);
    }
  }

  report(failures, manifest.migrations?.length ?? 0);
}

function report(failures, count = 0) {
  if (failures.length > 0) {
    console.error(`Database check failed with ${failures.length} finding(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Database check passed (${count} immutable migration(s)).`);
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
