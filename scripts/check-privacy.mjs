import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root },
)
  .toString("utf8")
  .split("\0")
  .filter((path) => path && existsSync(resolve(root, path)));

const forbiddenSegments = new Set([
  ".claude",
  ".cursor",
  ".gemini",
  ".kimi-code",
  ".kimi",
  ".codex",
  ".qwen",
  ".local-data",
  ".viberacing",
  "postgres-data",
  "captures",
  "telemetry",
  "temp",
  "tmp",
]);
const forbiddenExtensions = new Set([".backup", ".db", ".dump", ".sqlite", ".sqlite3"]);
const forbiddenPaths = candidates.filter((path) => {
  const segments = path.split("/");
  const name = segments.at(-1) ?? "";
  return (
    (name.startsWith(".env") && name !== ".env.example") ||
    segments.some((segment) => forbiddenSegments.has(segment)) ||
    forbiddenExtensions.has(extname(name)) ||
    name.startsWith("token-usage") ||
    name.startsWith("usage-export")
  );
});

const ignoredExamples = [
  ".env.local",
  "apps/web/.env.local",
  ".codex/hooks.json",
  ".claude/settings.json",
  ".kimi/config.toml",
  ".kimi-code/config.toml",
  ".viberacing/config.json",
  ".local-data/postgres.dump",
  "tmp/local-audit.png",
  "token-usage.json",
  "usage-export.csv",
];
const ignored = new Set(
  execFileSync("git", ["check-ignore", "--no-index", "--stdin"], {
    cwd: root,
    input: `${ignoredExamples.join("\n")}\n`,
  })
    .toString("utf8")
    .trim()
    .split("\n"),
);
const missingIgnoreRules = ignoredExamples.filter((path) => !ignored.has(path));

const textExtensions = new Set([
  "",
  ".css",
  ".json",
  ".md",
  ".mjs",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const sensitiveContent = [];
for (const path of candidates) {
  if (path === "scripts/check-privacy.mjs" || !textExtensions.has(extname(path))) continue;
  let content;
  try {
    content = readFileSync(resolve(root, path), "utf8");
  } catch {
    continue;
  }
  const clientSecret = content.match(/^\s*GITHUB_CLIENT_SECRET\s*=\s*(\S+)\s*$/m)?.[1];
  if (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content) ||
    /\b(?:github_pat_|gh[opusr]_)[A-Za-z0-9_]{20,}\b/.test(content) ||
    (clientSecret !== undefined && !clientSecret.startsWith("<"))
  )
    sensitiveContent.push(path);
}

const fixtureFailures = [];
const fixturePrefix = "packages/connector/test/fixtures/";
const forbiddenFixtureKeys =
  /"(?:args|code|content|credential|file_?path|prompt|repository|response|text|tool_?arguments)"\s*:/i;
for (const path of candidates.filter((candidate) => candidate.startsWith(fixturePrefix))) {
  const content = readFileSync(resolve(root, path), "utf8");
  if (forbiddenFixtureKeys.test(content)) fixtureFailures.push(path);
}

const failures = [
  ...forbiddenPaths.map((path) => `local artifact would be committed: ${path}`),
  ...missingIgnoreRules.map((path) => `missing ignore protection for: ${path}`),
  ...sensitiveContent.map((path) => `possible credential in: ${path}`),
  ...fixtureFailures.map((path) => `fixture contains non-usage payload fields: ${path}`),
];
if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    "Privacy guard passed: local credentials and usage artifacts are ignored.\n",
  );
}
