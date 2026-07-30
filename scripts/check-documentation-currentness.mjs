import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
if (!(args.length === 0 || (args.length === 2 && args[0] === "--root" && args[1]))) {
  console.error("Usage: node scripts/check-documentation-currentness.mjs [--root <directory>]");
  process.exit(2);
}

const root = args.length === 0 ? resolve(import.meta.dirname, "..") : resolve(args[1]);
const findings = [];

function read(path) {
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath)) {
    findings.push(`${path} is missing`);
    return "";
  }
  return readFileSync(absolutePath, "utf8");
}

function readJson(path) {
  const text = read(path);
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    findings.push(`${path} is not valid JSON`);
    return undefined;
  }
}

function normalized(text) {
  return text.replace(/\s+/g, " ").trim();
}

function lineCount(text) {
  const trimmed = text.trimEnd();
  return trimmed ? trimmed.split(/\r?\n/).length : 0;
}

function requireNormalized(path, text, expected, message) {
  if (!normalized(text).includes(normalized(expected))) {
    findings.push(`${path} — ${message}`);
  }
}

function requireCompactOnboarding(path, text, options) {
  const lines = text.trimEnd().split(/\r?\n/);
  if (lines.length > options.maximumLines) {
    findings.push(
      `${path} — onboarding exceeds ${options.maximumLines} lines (${lines.length} found)`,
    );
  }

  const quickStartIndex = lines.findIndex((line) => line === options.quickStartHeading);
  if (quickStartIndex < 0 || quickStartIndex >= options.maximumQuickStartLine) {
    findings.push(
      `${path} — ${options.quickStartHeading} must begin within the first ${options.maximumQuickStartLine} lines`,
    );
  }

  const architectureIndex = lines.findIndex((line) => line === options.architectureHeading);
  if (architectureIndex < 0 || architectureIndex <= quickStartIndex) {
    findings.push(`${path} — the architecture section must follow the quick start`);
  }
  if (!text.includes("```mermaid")) {
    findings.push(`${path} — the architecture section must contain one Mermaid thumbnail`);
  }
  for (const required of [
    "pnpm install --frozen-lockfile --ignore-scripts",
    "pnpm run dev:web",
    "pnpm run verify",
    "docs/getting-started/GITHUB_FIRST_PUBLICATION.md",
  ]) {
    if (!text.includes(required)) {
      findings.push(`${path} — onboarding is missing ${required}`);
    }
  }
}

const contractManifest = readJson("contracts/v1/manifest.json");
const migrationManifest = readJson("database/migrations/manifest.json");
const openApi = readJson("contracts/generated/openapi.v1.json");
const schemaCount = Array.isArray(contractManifest?.schemas)
  ? contractManifest.schemas.length
  : undefined;
const policyCount = Array.isArray(contractManifest?.policies)
  ? contractManifest.policies.length
  : undefined;
const operationCount = Array.isArray(contractManifest?.operations)
  ? contractManifest.operations.length
  : undefined;
const implementedLocalOperationCount = Array.isArray(contractManifest?.operations)
  ? contractManifest.operations.filter(
      (operation) => operation?.implementationStatus === "implemented-local",
    ).length
  : undefined;
const contractOnlyOperationCount = Array.isArray(contractManifest?.operations)
  ? contractManifest.operations.filter(
      (operation) => operation?.implementationStatus === "contract-only",
    ).length
  : undefined;
const migrationCount = Array.isArray(migrationManifest?.migrations)
  ? migrationManifest.migrations.length
  : undefined;
const pathCount =
  openApi?.paths && typeof openApi.paths === "object" && !Array.isArray(openApi.paths)
    ? Object.keys(openApi.paths).length
    : undefined;

if (
  schemaCount === undefined ||
  policyCount === undefined ||
  operationCount === undefined ||
  implementedLocalOperationCount === undefined ||
  contractOnlyOperationCount === undefined ||
  migrationCount === undefined ||
  pathCount === undefined
) {
  findings.push("canonical manifests do not expose the required documentation inventory");
}

const readme = read("README.md");
const russianReadme = read("README.ru.md");
const databaseReadme = read("database/README.md");
const implementationStatus = read("docs/IMPLEMENTATION_STATUS.md");
const localDevelopment = read("docs/getting-started/LOCAL_DEVELOPMENT.md");

if (
  schemaCount !== undefined &&
  policyCount !== undefined &&
  operationCount !== undefined &&
  implementedLocalOperationCount !== undefined &&
  contractOnlyOperationCount !== undefined &&
  pathCount !== undefined &&
  migrationCount !== undefined
) {
  requireNormalized(
    "README.md",
    readme,
    `Current contract inventory: **${schemaCount} schemas, ${policyCount} protocol policies, ${operationCount} OpenAPI operations, and ${pathCount} OpenAPI paths**. Current database inventory: **${migrationCount} immutable SQL migration revisions**.`,
    "current contract/database inventory differs from the canonical manifests",
  );
  requireNormalized(
    "README.ru.md",
    russianReadme,
    `Текущий inventory контрактов: **${schemaCount} схем, ${policyCount} protocol policies, ${operationCount} OpenAPI operations и ${pathCount} OpenAPI paths**. Текущий database inventory: **${migrationCount} immutable SQL migration revisions**.`,
    "current contract/database inventory differs from the canonical manifests",
  );
  requireNormalized(
    "database/README.md",
    databaseReadme,
    `This directory contains ${migrationCount} SQL-first revisions`,
    "migration inventory differs from the canonical manifest",
  );
  requireNormalized(
    "docs/IMPLEMENTATION_STATUS.md",
    implementationStatus,
    `- ${migrationCount} checksum-ledgered, transactional SQL migrations`,
    "migration inventory differs from the canonical manifest",
  );
  requireNormalized(
    "docs/getting-started/LOCAL_DEVELOPMENT.md",
    localDevelopment,
    `and ${migrationCount} checksum-ledgered database migrations`,
    "migration inventory differs from the canonical manifest",
  );
  requireNormalized(
    "docs/getting-started/LOCAL_DEVELOPMENT.md",
    localDevelopment,
    `OpenAPI document contains ${pathCount} paths: ${implementedLocalOperationCount} marked \`implemented-local\` and ${contractOnlyOperationCount} marked \`contract-only\``,
    "OpenAPI path inventory differs from the generated document",
  );
}

requireCompactOnboarding("README.md", readme, {
  architectureHeading: "## Architecture",
  maximumLines: 220,
  maximumQuickStartLine: 40,
  quickStartHeading: "## Quick start",
});
requireCompactOnboarding("README.ru.md", russianReadme, {
  architectureHeading: "## Архитектура",
  maximumLines: 220,
  maximumQuickStartLine: 40,
  quickStartHeading: "## Быстрый запуск",
});

if (findings.length > 0) {
  console.error(`Documentation currentness check failed with ${findings.length} finding(s):`);
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(
  `Documentation currentness check passed (${schemaCount} schemas, ${policyCount} policies, ${operationCount} operations: ${implementedLocalOperationCount} implemented-local and ${contractOnlyOperationCount} contract-only; ${pathCount} paths, ${migrationCount} migrations, README ${lineCount(readme)}/${lineCount(russianReadme)} EN/RU lines).`,
);
