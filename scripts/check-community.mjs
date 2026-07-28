import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { parseDocument } from "yaml";

const args = process.argv.slice(2);
if (!(args.length === 0 || (args.length === 2 && args[0] === "--root" && args[1]))) {
  console.error("Usage: node scripts/check-community.mjs [--root <directory>]");
  process.exit(2);
}

const root = args.length === 0 ? resolve(import.meta.dirname, "..") : resolve(args[1]);
const findings = [];

function report(path, message) {
  findings.push(`${path} — ${message}`);
}

function readRequired(path) {
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath)) {
    report(path, "required community-health file is missing");
    return null;
  }
  return readFileSync(absolutePath, "utf8");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

const requiredFiles = [
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "DCO.txt",
  "GOVERNANCE.md",
  "MAINTAINERS.md",
  "RELEASE.md",
  "ROADMAP.md",
  "SECURITY.md",
  "SUPPORT.md",
  "THIRD_PARTY_NOTICES.md",
  "TRADEMARKS.md",
  ".github/ISSUE_TEMPLATE/bug.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/documentation.yml",
  ".github/ISSUE_TEMPLATE/feature.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
];

const texts = new Map(requiredFiles.map((path) => [path, readRequired(path)]));
const contentRequirements = new Map([
  ["CHANGELOG.md", ["# Changelog", "## [Unreleased]", "### Security"]],
  [
    "CODE_OF_CONDUCT.md",
    [
      "External participation status:",
      "GitHub public interaction status:",
      "Conduct reporting channel:",
      "Contributor Covenant, version 3.0",
    ],
  ],
  ["DCO.txt", ["Developer Certificate of Origin", "Version 1.1"]],
  ["GOVERNANCE.md", ["# Governance", "## Decision process", "## Security decisions"]],
  ["MAINTAINERS.md", ["# Maintainers", "Public maintainer registry:", "## Publication gate"]],
  ["RELEASE.md", ["# Release policy", "## Required release evidence", "## Rollback"]],
  ["ROADMAP.md", ["# Roadmap", "## Phase 0", "## Phase 1"]],
  ["SECURITY.md", ["# Security policy", "Private vulnerability reporting status:"]],
  ["SUPPORT.md", ["# Support", "## Security reports", "## Unsupported requests"]],
  ["THIRD_PARTY_NOTICES.md", ["# Third-party notices", "## Direct development tools"]],
  ["TRADEMARKS.md", ["# Trademark policy", "Apache License 2.0"]],
]);

for (const [path, fragments] of contentRequirements) {
  const text = texts.get(path);
  if (text === null) {
    continue;
  }
  for (const fragment of fragments) {
    if (!text.includes(fragment)) {
      report(path, `required policy text is missing: ${JSON.stringify(fragment)}`);
    }
  }
}

const policyPaths = [
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "DCO.txt",
  "GOVERNANCE.md",
  "MAINTAINERS.md",
  "RELEASE.md",
  "ROADMAP.md",
  "SUPPORT.md",
  "THIRD_PARTY_NOTICES.md",
  "TRADEMARKS.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
];
const placeholderPattern =
  /\b(?:CHANGE[ _-]?ME|TBD|TODO|YOUR[ _-](?:EMAIL|HANDLE|NAME))\b|@(?:owner|maintainer|username)\b/i;

for (const path of policyPaths) {
  const text = texts.get(path);
  if (text !== null && placeholderPattern.test(text)) {
    report(path, "unresolved owner or policy placeholder is not allowed");
  }
}

const dco = texts.get("DCO.txt");
if (dco !== null) {
  const normalizedDco = dco.replace(/\s+/g, " ");
  const normalizedDcoFile = `${dco.replace(/\r\n/g, "\n").trimEnd()}\n`;
  const expectedDcoDigest = "dac2b0a921aaf4bcaf484dc082fbea072398bedecf5f1d4dcce7e122bbe5d2d5";
  if (createHash("sha256").update(normalizedDcoFile).digest("hex") !== expectedDcoDigest) {
    report("DCO.txt", "official DCO 1.1 text does not match its reviewed digest");
  }
  const requiredDcoClauses = [
    "The contribution was created in whole or in part by me",
    "The contribution is based upon previous work",
    "The contribution was provided directly to me by some other person",
    "I understand and agree that this project and the contribution are public",
  ];
  for (const clause of requiredDcoClauses) {
    if (!normalizedDco.includes(clause)) {
      report("DCO.txt", `DCO 1.1 clause is missing: ${JSON.stringify(clause)}`);
    }
  }
}

const conductPolicy = texts.get("CODE_OF_CONDUCT.md");
const maintainerPolicy = texts.get("MAINTAINERS.md");
const securityPolicy = texts.get("SECURITY.md");
if (conductPolicy !== null && maintainerPolicy !== null && securityPolicy !== null) {
  const participationStatus =
    conductPolicy.match(/^External participation status:\s*(.+?)\s*$/m)?.[1] ?? "";
  const interactionStatus =
    conductPolicy.match(/^GitHub public interaction status:\s*(.+?)\s*$/m)?.[1] ?? "";
  const conductChannel = conductPolicy.match(/^Conduct reporting channel:\s*(.+?)\s*$/m)?.[1] ?? "";
  const maintainerStatus =
    maintainerPolicy.match(/^Public maintainer registry:\s*(.+?)\s*$/m)?.[1] ?? "";
  const vulnerabilityStatus =
    securityPolicy.match(/^Private vulnerability reporting status:\s*(.+?)\s*$/m)?.[1] ?? "";

  if (!new Set(["closed.", "open."]).has(participationStatus)) {
    report("CODE_OF_CONDUCT.md", "external participation status must be exactly closed or open");
  }
  if (
    !new Set([
      "not restricted or verified.",
      "restricted and verified.",
      "enabled for open participation.",
    ]).has(interactionStatus)
  ) {
    report("CODE_OF_CONDUCT.md", "GitHub public interaction status has an unsupported value");
  }

  let conductChannelReady = false;
  if (conductChannel !== "not configured.") {
    try {
      const url = new URL(conductChannel);
      conductChannelReady =
        url.protocol === "https:" &&
        url.hostname !== "localhost" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        !/\/issues(?:\/|$)/.test(url.pathname);
    } catch {
      conductChannelReady = false;
    }
    if (!conductChannelReady) {
      report(
        "CODE_OF_CONDUCT.md",
        "conduct reporting must be not configured or a credential-free private HTTPS endpoint",
      );
    }
  }

  if (!new Set(["not configured.", "configured."]).has(maintainerStatus)) {
    report(
      "MAINTAINERS.md",
      "public maintainer registry status must be exactly configured or not configured",
    );
  }
  if (
    maintainerStatus === "configured." &&
    !/https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?(?=[\s)/?#]|$)/m.test(
      maintainerPolicy,
    )
  ) {
    report(
      "MAINTAINERS.md",
      "a configured registry must contain a public GitHub maintainer profile",
    );
  }
  if (!new Set(["enabled and verified.", "not enabled or verified."]).has(vulnerabilityStatus)) {
    report("SECURITY.md", "private vulnerability reporting status has an unsupported value");
  }

  if (participationStatus === "open.") {
    if (interactionStatus !== "enabled for open participation.") {
      report(
        "CODE_OF_CONDUCT.md",
        "open participation requires GitHub public interactions to be marked enabled",
      );
    }
    if (!conductChannelReady) {
      report(
        "CODE_OF_CONDUCT.md",
        "open participation requires a configured private conduct channel",
      );
    }
    if (maintainerStatus !== "configured.") {
      report(
        "MAINTAINERS.md",
        "open participation requires a configured public maintainer registry",
      );
    }
    if (vulnerabilityStatus !== "enabled and verified.") {
      report("SECURITY.md", "open participation requires verified private vulnerability reporting");
    }
  } else if (interactionStatus === "enabled for open participation.") {
    report(
      "CODE_OF_CONDUCT.md",
      "closed participation cannot claim that GitHub public interactions are enabled",
    );
  }
}

const pullRequestTemplate = texts.get(".github/PULL_REQUEST_TEMPLATE.md");
if (pullRequestTemplate !== null) {
  const requiredSections = [
    "## Summary",
    "## Security and public-data review",
    "## Verification",
    "## Documentation and compatibility",
    "## Contributor attestation",
    "I reviewed the exact staged diff for secrets, personal data, and local paths.",
    "Every commit includes a DCO sign-off.",
  ];
  for (const section of requiredSections) {
    if (!pullRequestTemplate.includes(section)) {
      report(
        ".github/PULL_REQUEST_TEMPLATE.md",
        `required section is missing: ${JSON.stringify(section)}`,
      );
    }
  }
  if ((pullRequestTemplate.match(/- \[ \]/g) ?? []).length < 8) {
    report(
      ".github/PULL_REQUEST_TEMPLATE.md",
      "expected at least eight explicit review checkboxes",
    );
  }
}

function parseYaml(path) {
  const source = texts.get(path);
  if (source === null) {
    return null;
  }
  const document = parseDocument(source, { prettyErrors: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    for (const error of document.errors) {
      report(path, `invalid YAML: ${error.message.split("\n")[0]}`);
    }
    return null;
  }
  try {
    return document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    report(path, `unsupported YAML alias or structure: ${error.message.split("\n")[0]}`);
    return null;
  }
}

const configPath = ".github/ISSUE_TEMPLATE/config.yml";
const config = parseYaml(configPath);
if (config !== null) {
  if (!isRecord(config)) {
    report(configPath, "configuration must be a mapping");
  } else {
    if (config.blank_issues_enabled !== false) {
      report(configPath, "blank issues must remain disabled");
    }
    if (!Array.isArray(config.contact_links)) {
      report(configPath, "contact_links must be an explicit array");
    } else {
      for (const [index, link] of config.contact_links.entries()) {
        if (!isRecord(link) || !nonEmptyString(link.name) || !nonEmptyString(link.about)) {
          report(configPath, `contact_links[${index}] must include name and about`);
          continue;
        }
        try {
          const url = new URL(link.url);
          if (url.protocol !== "https:") {
            report(configPath, `contact_links[${index}] must use HTTPS`);
          }
        } catch {
          report(configPath, `contact_links[${index}] has an invalid URL`);
        }
      }
    }
  }
}

const formPaths = [
  ".github/ISSUE_TEMPLATE/bug.yml",
  ".github/ISSUE_TEMPLATE/documentation.yml",
  ".github/ISSUE_TEMPLATE/feature.yml",
];
const allowedTypes = new Set(["checkboxes", "dropdown", "input", "markdown", "textarea"]);
const allowedFormKeys = new Set(["assignees", "body", "description", "labels", "name", "title"]);
const forbiddenFieldIds = new Set([
  "account",
  "contact",
  "cookie",
  "email",
  "ip",
  "logs",
  "screenshot",
  "token",
]);
const forbiddenFieldRequest =
  /\b(?:account (?:id|identifier)|contact (?:details|method)|cookies?|e-?mail|ip addresses?|raw logs?|screenshots?|tokens?)\b/i;
const formNames = new Set();

for (const path of formPaths) {
  const form = parseYaml(path);
  if (form === null) {
    continue;
  }
  if (!isRecord(form)) {
    report(path, "issue form must be a mapping");
    continue;
  }
  for (const key of Object.keys(form)) {
    if (!allowedFormKeys.has(key)) {
      report(path, `unsupported top-level issue-form key: ${JSON.stringify(key)}`);
    }
  }
  if (!nonEmptyString(form.name)) {
    report(path, "name must be a non-empty string");
  } else if (formNames.has(form.name.trim().toLowerCase())) {
    report(path, "issue form name must be unique");
  } else {
    formNames.add(form.name.trim().toLowerCase());
  }
  if (!nonEmptyString(form.description)) {
    report(path, "description must be a non-empty string");
  }
  if (!nonEmptyString(form.title)) {
    report(path, "title must be a non-empty string");
  }
  if (!Array.isArray(form.labels) || !Array.isArray(form.assignees)) {
    report(path, "labels and assignees must be explicit arrays");
  } else if (
    form.labels.some((label) => !nonEmptyString(label)) ||
    form.assignees.some((assignee) => !nonEmptyString(assignee))
  ) {
    report(path, "labels and assignees may contain only non-empty strings");
  }
  if (Array.isArray(form.assignees) && form.assignees.length > 0) {
    report(path, "assignees must remain empty; triage ownership is explicit after issue creation");
  }
  if (!Array.isArray(form.body) || form.body.length < 3) {
    report(path, "body must contain at least three entries");
    continue;
  }

  const ids = new Set();
  let hasSensitiveDataWarning = false;
  for (const [index, entry] of form.body.entries()) {
    const location = `body[${index}]`;
    if (!isRecord(entry) || !allowedTypes.has(entry.type)) {
      report(path, `${location} has an unsupported type`);
      continue;
    }
    if (!isRecord(entry.attributes)) {
      report(path, `${location}.attributes must be a mapping`);
      continue;
    }

    if (entry.type === "markdown") {
      if (!nonEmptyString(entry.attributes.value)) {
        report(path, `${location} markdown must have a non-empty value`);
      } else if (
        /SECURITY\.md/i.test(entry.attributes.value) &&
        /sensitive/i.test(entry.attributes.value)
      ) {
        hasSensitiveDataWarning = true;
      }
      continue;
    }

    if (!nonEmptyString(entry.id) || !/^[a-z][a-z0-9_-]*$/.test(entry.id)) {
      report(path, `${location}.id must be a stable lowercase identifier`);
    } else {
      if (ids.has(entry.id)) {
        report(path, `${location}.id duplicates ${JSON.stringify(entry.id)}`);
      }
      ids.add(entry.id);
      if (forbiddenFieldIds.has(entry.id)) {
        report(path, `${location}.id requests data that public forms must not collect`);
      }
    }
    if (!nonEmptyString(entry.attributes.label) || !nonEmptyString(entry.attributes.description)) {
      report(path, `${location} must include label and description`);
    } else if (
      forbiddenFieldRequest.test(`${entry.attributes.label} ${entry.attributes.description}`)
    ) {
      report(
        path,
        `${location} must not solicit contact, credential, account, or raw diagnostic data`,
      );
    }
    if (!isRecord(entry.validations) || typeof entry.validations.required !== "boolean") {
      report(path, `${location}.validations.required must be explicit`);
    }
    if (entry.type === "dropdown") {
      if (!Array.isArray(entry.attributes.options) || entry.attributes.options.length < 2) {
        report(path, `${location} dropdown must have at least two options`);
      } else {
        const options = entry.attributes.options;
        if (options.some((option) => !nonEmptyString(option))) {
          report(path, `${location} dropdown options must be non-empty strings`);
        } else if (
          new Set(options.map((option) => option.trim().toLowerCase())).size !== options.length
        ) {
          report(path, `${location} dropdown options must be unique`);
        }
      }
    }
    if (entry.type === "checkboxes") {
      const options = entry.attributes.options;
      if (!Array.isArray(options) || options.length === 0) {
        report(path, `${location} checkboxes must have options`);
      } else {
        for (const [optionIndex, option] of options.entries()) {
          if (
            !isRecord(option) ||
            !nonEmptyString(option.label) ||
            typeof option.required !== "boolean"
          ) {
            report(path, `${location}.options[${optionIndex}] must include label and required`);
          } else if (option.required !== true) {
            report(path, `${location}.options[${optionIndex}] must be required`);
          }
        }
        if (entry.validations.required !== true) {
          report(path, `${location} checkbox validation must be required`);
        }
      }
    }
  }
  if (!hasSensitiveDataWarning) {
    report(path, "form must direct sensitive security details to SECURITY.md");
  }
}

if (findings.length > 0) {
  console.error(`Community-health check failed with ${findings.length} finding(s):`);
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(
  `Community-health check passed (${requiredFiles.length} required file(s), ${formPaths.length} issue form(s)).`,
);
