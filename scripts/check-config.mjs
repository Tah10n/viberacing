import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";
import { parseDocument } from "yaml";

const root = resolve(import.meta.dirname, "..");
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const exactPackageSelector = /^(?:@[^/\s]+\/[^@\s]+|[^@\s]+)@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const exactOverrideSelector =
  /^(?:@[^/\s]+\/[^@\s>]+|[^@\s>]+)@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?>(?:@[^/\s]+\/[^@\s>]+|[^@\s>]+)$/;
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
    ["enableGlobalVirtualStore", false],
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
  findings.push(...validateDependencyDeclarations(manifest));
  findings.push(...validatePackageScripts(manifest));
  return findings;
}

function validateDependencyDeclarations(manifest) {
  const findings = [];
  const declared = new Map();
  for (const group of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const dependencies = manifest?.[group] ?? {};
    if (!isObject(dependencies)) {
      findings.push(`${group} must be a dependency map`);
      continue;
    }
    for (const [name, version] of Object.entries(dependencies)) {
      if (declared.has(name)) {
        findings.push(`${name} must not be declared in both ${declared.get(name)} and ${group}`);
      }
      declared.set(name, group);
      const workspaceReference = version === "workspace:*";
      if (typeof version !== "string" || (!exactVersion.test(version) && !workspaceReference)) {
        findings.push(`${group}.${name} must use an exact version, received ${String(version)}`);
      }
      if (workspaceReference && !name.startsWith("@viberacing/")) {
        findings.push(`${group}.${name} uses workspace:* but is outside the @viberacing scope`);
      }
      if (name.startsWith("@viberacing/") && !workspaceReference) {
        findings.push(`${group}.${name} must use workspace:* for an internal package`);
      }
    }
  }
  return findings;
}

function validatePackageScripts(manifest) {
  const findings = [];
  if (!isObject(manifest?.scripts ?? {})) {
    return ["scripts must be a command map"];
  }
  for (const [name, command] of Object.entries(manifest?.scripts ?? {})) {
    if (typeof command !== "string") {
      findings.push(`script ${name} must be a string`);
    } else if (/\b(?:curl|wget|Invoke-WebRequest)\b/i.test(command)) {
      findings.push(`script ${name} must not download and execute remote content`);
    }
  }
  return findings;
}

export function validateWorkspacePackage(path, manifest) {
  const findings = [];
  const match = /^(?:apps|packages)\/([A-Za-z0-9._-]+)\/package\.json$/.exec(path);
  if (!match) {
    return ["workspace manifest path is outside apps/* or packages/*"];
  }
  if (manifest?.private !== true) {
    findings.push("workspace package must remain private until a separate publication review");
  }
  if (manifest?.name !== `@viberacing/${match[1]}`) {
    findings.push(`workspace name must be @viberacing/${match[1]}`);
  }
  if (!exactVersion.test(manifest?.version ?? "")) {
    findings.push("workspace version must be an exact semantic version");
  }
  if (manifest?.type !== "module") {
    findings.push("workspace package must use type: module");
  }
  if (manifest?.engines?.node !== ">=24.14.0 <25") {
    findings.push("workspace Node engine must match >=24.14.0 <25");
  }
  if (manifest?.packageManager !== undefined) {
    findings.push("workspace packageManager must be inherited from the root");
  }
  findings.push(...validateDependencyDeclarations(manifest));
  findings.push(...validatePackageScripts(manifest));
  return findings;
}

function parseDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export function validateDependencyOverrides(workspace, policy, now = new Date()) {
  const findings = [];
  if (policy?.schemaVersion !== 1 || !Array.isArray(policy?.overrides)) {
    return ["dependency override policy must use schemaVersion 1 with an overrides array"];
  }
  const declaredOverrides = workspace?.overrides ?? {};
  if (!isObject(declaredOverrides)) {
    return ["pnpm-workspace.yaml overrides must be a map"];
  }

  const documented = new Map();
  let previousSelector = "";
  for (const [index, entry] of policy.overrides.entries()) {
    const scope = `dependency override policy entry ${index + 1}`;
    if (
      !isObject(entry) ||
      Object.keys(entry).sort().join(",") !==
        "expiresOn,reason,removalCondition,replacement,reviewedOn,selector"
    ) {
      findings.push(`${scope} has an invalid shape`);
      continue;
    }
    if (!exactOverrideSelector.test(entry.selector)) {
      findings.push(`${scope} selector must pin one exact parent and one child package`);
    }
    if (entry.replacement !== "-" && !exactVersion.test(entry.replacement)) {
      findings.push(`${scope} replacement must be one exact version or an explicit removal`);
    }
    if (typeof entry.reason !== "string" || entry.reason.length < 100) {
      findings.push(`${scope} reason must contain at least 100 characters of review evidence`);
    }
    if (typeof entry.removalCondition !== "string" || entry.removalCondition.length < 80) {
      findings.push(`${scope} removalCondition must contain at least 80 characters`);
    }
    if (documented.has(entry.selector)) {
      findings.push(`${scope} duplicates selector ${entry.selector}`);
    }
    if (previousSelector && previousSelector.localeCompare(entry.selector) >= 0) {
      findings.push("dependency override policy entries must be uniquely sorted by selector");
    }
    previousSelector = entry.selector;
    documented.set(entry.selector, entry.replacement);

    const reviewedOn = parseDateOnly(entry.reviewedOn);
    const expiresOn = parseDateOnly(entry.expiresOn);
    if (reviewedOn === null || expiresOn === null) {
      findings.push(`${scope} review dates must be real YYYY-MM-DD dates`);
    } else {
      const lifetimeDays = (expiresOn.valueOf() - reviewedOn.valueOf()) / 86_400_000;
      if (lifetimeDays <= 0 || lifetimeDays > 120) {
        findings.push(`${scope} review window must be between 1 and 120 days`);
      }
      const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      if (reviewedOn.valueOf() > today) {
        findings.push(`${scope} reviewedOn must not be in the future`);
      }
      if (expiresOn.valueOf() < today) {
        findings.push(`${scope} expired on ${entry.expiresOn}`);
      }
    }
  }

  for (const [selector, replacement] of Object.entries(declaredOverrides)) {
    if (documented.get(selector) !== replacement) {
      findings.push(`pnpm-workspace.yaml override is undocumented or stale: ${selector}`);
    }
  }
  for (const [selector, replacement] of documented) {
    if (declaredOverrides[selector] !== replacement) {
      findings.push(`documented override is missing or stale in pnpm-workspace.yaml: ${selector}`);
    }
  }
  return findings;
}

function workspaceManifestPaths(failures) {
  const paths = [];
  for (const parent of ["apps", "packages"]) {
    const parentPath = resolve(root, parent);
    if (!existsSync(parentPath)) {
      continue;
    }
    for (const entry of readdirSync(parentPath, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        failures.push(`${parent}/${entry.name} — symbolic workspace directories are not allowed`);
        continue;
      }
      if (!entry.isDirectory()) {
        continue;
      }
      const path = `${parent}/${entry.name}/package.json`;
      if (!existsSync(resolve(root, path))) {
        failures.push(`${parent}/${entry.name} — workspace directory must contain package.json`);
      } else {
        paths.push(path);
      }
    }
  }
  return paths.sort((left, right) => left.localeCompare(right));
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

  for (const manifestName of ["package.json", ...workspaceManifestPaths(failures)]) {
    const manifestPath = resolve(root, manifestName);
    if (lstatSync(manifestPath).isSymbolicLink()) {
      failures.push(`${manifestName} — symbolic configuration files are not allowed`);
      continue;
    }
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const manifestFindings =
        manifestName === "package.json"
          ? validateRootPackage(manifest)
          : validateWorkspacePackage(manifestName, manifest);
      for (const finding of manifestFindings) {
        failures.push(`${manifestName} — ${finding}`);
      }
    } catch (error) {
      failures.push(`${manifestName} — invalid JSON: ${error.message}`);
    }
  }
  try {
    const workspace = parseYaml("pnpm-workspace.yaml", failures);
    const overridePolicy = JSON.parse(
      readFileSync(resolve(root, "config/dependency-overrides.json"), "utf8"),
    );
    for (const finding of validateDependencyOverrides(workspace, overridePolicy)) {
      failures.push(`config/dependency-overrides.json — ${finding}`);
    }
  } catch (error) {
    failures.push(`config/dependency-overrides.json — invalid JSON: ${error.message}`);
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
