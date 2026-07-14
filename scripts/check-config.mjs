import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";
import { parseDocument } from "yaml";

const root = resolve(import.meta.dirname, "..");
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const exactPackageSelector = /^(?:@[^/\s]+\/[^@\s]+|[^@\s]+)@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const hostedRunners = new Set(["ubuntu-24.04", "windows-2025", "macos-15"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function permissionFindings(scope, permissions) {
  if (!isObject(permissions)) {
    return [`${scope} must declare an explicit permission map`];
  }

  const findings = [];
  for (const [permission, access] of Object.entries(permissions)) {
    if (access !== "read" && access !== "none") {
      findings.push(`${scope} grants ${permission}: ${String(access)}; CI is read-only`);
    }
  }
  return findings;
}

function hasTrigger(triggers, name) {
  return (
    triggers === name ||
    (Array.isArray(triggers) && triggers.includes(name)) ||
    (isObject(triggers) && Object.hasOwn(triggers, name))
  );
}

function pinnedContainerImage(image) {
  return typeof image === "string" && /^[^\s@]+@sha256:[a-f0-9]{64}$/.test(image);
}

export function validateWorkflow(path, workflow) {
  const findings = [];
  if (!isObject(workflow)) {
    return ["workflow root must be a mapping"];
  }

  const triggers = workflow.on;
  if (hasTrigger(triggers, "pull_request_target")) {
    findings.push("pull_request_target is forbidden for untrusted repository code");
  }

  findings.push(...permissionFindings("top-level permissions", workflow.permissions));

  if (!isObject(workflow.jobs) || Object.keys(workflow.jobs).length === 0) {
    findings.push("workflow must define at least one job");
    return findings;
  }

  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (!isObject(job)) {
      findings.push(`job ${jobName} must be a mapping`);
      continue;
    }
    if (
      !Number.isInteger(job["timeout-minutes"]) ||
      job["timeout-minutes"] <= 0 ||
      job["timeout-minutes"] > 60
    ) {
      findings.push(`job ${jobName} must set timeout-minutes between 1 and 60`);
    }
    if (!hostedRunners.has(job["runs-on"])) {
      findings.push(`job ${jobName} must use an allowlisted GitHub-hosted runner`);
    }
    if (job.environment !== undefined) {
      findings.push(`job ${jobName} must not attach a privileged environment`);
    }
    const jobContainer = typeof job.container === "string" ? job.container : job.container?.image;
    if (job.container !== undefined && !pinnedContainerImage(jobContainer)) {
      findings.push(`job ${jobName} container must be pinned to a sha256 digest`);
    }
    for (const [serviceName, service] of Object.entries(job.services ?? {})) {
      const serviceImage = typeof service === "string" ? service : service?.image;
      if (!pinnedContainerImage(serviceImage)) {
        findings.push(`job ${jobName} service ${serviceName} must be pinned to a sha256 digest`);
      }
    }
    if (job.permissions !== undefined) {
      findings.push(...permissionFindings(`job ${jobName} permissions`, job.permissions));
    }
    if (!Array.isArray(job.steps)) {
      findings.push(`job ${jobName} must define steps`);
      continue;
    }

    for (const [stepIndex, step] of job.steps.entries()) {
      if (!isObject(step)) {
        findings.push(`job ${jobName} step ${stepIndex + 1} must be a mapping`);
        continue;
      }

      if (typeof step.uses === "string") {
        const action = step.uses;
        const localAction = action.startsWith("./");
        const pinnedRemoteAction =
          /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*@[a-f0-9]{40}$/.test(action);
        const pinnedContainer = /^docker:\/\/[^\s@]+@sha256:[a-f0-9]{64}$/.test(action);
        if (!localAction && !pinnedRemoteAction && !pinnedContainer) {
          findings.push(`job ${jobName} step ${stepIndex + 1} does not pin uses to a digest`);
        }
        if (
          action.startsWith("actions/checkout@") &&
          step.with?.["persist-credentials"] !== false
        ) {
          findings.push(`job ${jobName} checkout must set persist-credentials: false`);
        }
        if (action.startsWith("actions/checkout@") && step.with?.["fetch-depth"] !== 0) {
          findings.push(`job ${jobName} checkout must fetch complete history for leak scanning`);
        }
        if (action.startsWith("actions/cache@")) {
          findings.push(`job ${jobName} must not use a writable dependency cache`);
        }
        if (
          action.startsWith("actions/setup-node@") &&
          step.with?.["package-manager-cache"] !== false
        ) {
          findings.push(`job ${jobName} setup-node must disable package-manager-cache`);
        }
      }

      if (typeof step.run === "string" && /\$\{\{[^}]+\}\}/.test(step.run)) {
        findings.push(
          `job ${jobName} step ${stepIndex + 1} interpolates an expression directly in shell code`,
        );
      }
    }
  }

  if (JSON.stringify(workflow).includes("${{ secrets.")) {
    findings.push(`${path} references secrets; pull-request CI must remain secretless`);
  }
  return findings;
}

export function validateCompose(compose) {
  const findings = [];
  const postgres = compose?.services?.postgres;
  if (!isObject(postgres)) {
    return ["compose.yaml must define the local postgres service"];
  }

  if (!/^[^\s@]+@sha256:[a-f0-9]{64}$/.test(postgres.image ?? "")) {
    findings.push("PostgreSQL image must be pinned to a sha256 index digest");
  }
  if (
    !Array.isArray(postgres.ports) ||
    postgres.ports.length === 0 ||
    postgres.ports.some((port) => typeof port !== "string" || !port.startsWith("127.0.0.1:"))
  ) {
    findings.push("PostgreSQL ports must bind explicitly to 127.0.0.1");
  }
  if (postgres.privileged === true || postgres.network_mode === "host") {
    findings.push("PostgreSQL must not use privileged or host-network mode");
  }
  if (
    !Array.isArray(postgres.security_opt) ||
    !postgres.security_opt.includes("no-new-privileges:true")
  ) {
    findings.push("PostgreSQL must enable no-new-privileges");
  }
  if (postgres.environment?.POSTGRES_PASSWORD !== "local-development-only") {
    findings.push("compose.yaml must use only the documented synthetic local password");
  }
  return findings;
}

export function validatePnpmWorkspace(workspace) {
  const findings = [];
  const requiredValues = [
    ["nodeVersion", "24.18.0"],
    ["engineStrict", true],
    ["verifyDepsBeforeRun", "error"],
    ["autoInstallPeers", false],
    ["strictPeerDependencies", true],
    ["savePrefix", ""],
    ["minimumReleaseAgeIgnoreMissingTime", false],
    ["minimumReleaseAgeStrict", true],
    ["trustLockfile", false],
    ["blockExoticSubdeps", true],
    ["strictDepBuilds", true],
  ];
  for (const [key, expected] of requiredValues) {
    if (workspace?.[key] !== expected) {
      findings.push(`pnpm setting ${key} must equal ${JSON.stringify(expected)}`);
    }
  }
  if (!Number.isInteger(workspace?.minimumReleaseAge) || workspace.minimumReleaseAge < 1440) {
    findings.push("minimumReleaseAge must enforce at least a 24-hour quarantine");
  }
  if (workspace?.trustPolicy !== "no-downgrade") {
    findings.push("trustPolicy must be no-downgrade");
  }
  if (!isObject(workspace?.allowBuilds)) {
    findings.push("allowBuilds must be an explicit map");
  } else {
    for (const [selector, allowed] of Object.entries(workspace.allowBuilds)) {
      if (!exactPackageSelector.test(selector) || typeof allowed !== "boolean") {
        findings.push(`allowBuilds entry ${selector} must pin one exact version to true or false`);
      }
    }
  }
  if (workspace?.dangerouslyAllowAllBuilds === true) {
    findings.push("dangerouslyAllowAllBuilds must never be enabled");
  }
  for (const key of ["registry", "registries", "namedRegistries"]) {
    if (workspace?.[key] !== undefined) {
      findings.push(`${key} must not redirect package resolution in tracked configuration`);
    }
  }
  for (const key of ["minimumReleaseAgeExclude", "trustPolicyExclude"]) {
    for (const selector of workspace?.[key] ?? []) {
      if (!exactPackageSelector.test(selector)) {
        findings.push(`${key} entry ${selector} must name one exact package version`);
      }
    }
  }
  const expectedPackages = ["apps/*", "packages/*"];
  if (
    !Array.isArray(workspace?.packages) ||
    workspace.packages.length !== expectedPackages.length ||
    expectedPackages.some((pattern) => !workspace.packages.includes(pattern))
  ) {
    findings.push("workspace package globs must remain bounded to apps/* and packages/*");
  }
  return findings;
}

export function validateRootPackage(manifest) {
  const findings = [];
  if (manifest?.private !== true) {
    findings.push("root package must remain private");
  }
  if (manifest?.packageManager !== "pnpm@11.7.0") {
    findings.push("root packageManager must pin pnpm@11.7.0");
  }
  for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, version] of Object.entries(manifest?.[group] ?? {})) {
      if (!exactVersion.test(version)) {
        findings.push(`${group}.${name} must use an exact version, received ${version}`);
      }
    }
  }
  for (const [name, command] of Object.entries(manifest?.scripts ?? {})) {
    if (/\b(?:curl|wget|Invoke-WebRequest)\b/i.test(command)) {
      findings.push(`script ${name} must not download and execute remote content`);
    }
  }
  return findings;
}

function yamlPaths() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.yml", "*.yaml"],
    { cwd: root, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 },
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function parseYaml(path, failures) {
  const safePath = JSON.stringify(path).slice(1, -1);
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath)) {
    return null;
  }
  if (lstatSync(absolutePath).isSymbolicLink()) {
    failures.push(`${safePath} — symbolic configuration files are not allowed`);
    return null;
  }
  const text = readFileSync(absolutePath, "utf8");
  const document = parseDocument(text, { strict: true, uniqueKeys: true, version: "1.2" });
  for (const error of document.errors) {
    failures.push(`${safePath} — ${error.message.split("\n", 1)[0]}`);
  }
  return document.errors.length === 0 ? document.toJS() : null;
}

function validateEnvExample(failures) {
  const path = resolve(root, ".env.example");
  if (lstatSync(path).isSymbolicLink()) {
    failures.push(".env.example — symbolic configuration files are not allowed");
    return;
  }
  const text = readFileSync(path, "utf8");
  const seen = new Set();
  for (const [index, line] of text.split("\n").entries()) {
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const match = /^([A-Z][A-Z0-9_]*)=(.+)$/.exec(line);
    if (!match) {
      failures.push(`.env.example:${index + 1} — expected UPPER_SNAKE_CASE=value`);
      continue;
    }
    if (seen.has(match[1])) {
      failures.push(`.env.example:${index + 1} — duplicate key ${match[1]}`);
    }
    seen.add(match[1]);
  }
}

function main() {
  const failures = [];
  for (const path of yamlPaths()) {
    const safePath = JSON.stringify(path).slice(1, -1);
    const value = parseYaml(path, failures);
    if (value === null) {
      continue;
    }
    if (path.startsWith(".github/workflows/")) {
      for (const finding of validateWorkflow(path, value)) {
        failures.push(`${safePath} — ${finding}`);
      }
    } else if (path === "compose.yaml") {
      for (const finding of validateCompose(value)) {
        failures.push(`${safePath} — ${finding}`);
      }
    } else if (path === "pnpm-workspace.yaml") {
      for (const finding of validatePnpmWorkspace(value)) {
        failures.push(`${safePath} — ${finding}`);
      }
    }
  }

  const manifestPath = resolve(root, "package.json");
  if (lstatSync(manifestPath).isSymbolicLink()) {
    failures.push("package.json — symbolic configuration files are not allowed");
  } else {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      for (const finding of validateRootPackage(manifest)) {
        failures.push(`package.json — ${finding}`);
      }
    } catch (error) {
      failures.push(`package.json — invalid JSON: ${error.message}`);
    }
  }
  validateEnvExample(failures);

  if (failures.length > 0) {
    console.error(`Configuration check failed with ${failures.length} finding(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`Configuration check passed (${yamlPaths().length} YAML file(s)).`);
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
