import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { parse } from "yaml";

const args = process.argv.slice(2);
if (!(args.length === 0 || (args.length === 2 && args[0] === "--root" && args[1]))) {
  console.error("Usage: node scripts/check-agent-skills.mjs [--root <directory>]");
  process.exit(2);
}

const root = args.length === 0 ? resolve(import.meta.dirname, "..") : resolve(args[1]);
const skillDirectory = ".agents/skills/viberacing-propose-car";
const skillPath = `${skillDirectory}/SKILL.md`;
const metadataPath = `${skillDirectory}/agents/openai.yaml`;
const schemaPath = "contracts/v1/car-recipe.schema.json";
const connectorPath = "crates/connector/src/connect.rs";
const proposalCommandPath = "crates/connector/src/connect/car_proposal_command.rs";
const expectedDescription =
  "Turn a user's Vibe Racing pixel-car style request into one closed CarRecipeV1 and submit it through the already paired proposal-only connector command. Use when the user asks an agent to create, restyle, or propose their Vibe Racing car for later browser review; do not use it to connect, sync usage, inspect private state, approve, activate, publish, or administer a profile.";
const expectedDefaultPrompt =
  "Use $viberacing-propose-car to turn my car style idea into a private Vibe Racing proposal for browser review.";
const failures = [];

function report(path, message) {
  failures.push(`${path} — ${message}`);
}

function readRequired(path) {
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath)) {
    report(path, "required agent-skill evidence is missing");
    return null;
  }
  return readFileSync(absolutePath, "utf8");
}

function parseYaml(path, value) {
  try {
    const parsed = parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      report(path, "YAML root must be a mapping");
      return null;
    }
    return parsed;
  } catch {
    report(path, "YAML is malformed");
    return null;
  }
}

function exactKeys(path, value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    report(path, `${label} must be a mapping`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    report(path, `${label} keys must be exactly ${wanted.join(", ")}`);
    return false;
  }
  return true;
}

function exactDirectoryEntries(path, expected) {
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath)) {
    report(path, "required agent-skill directory is missing");
    return;
  }
  const actual = readdirSync(absolutePath).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    report(path, `entries must be exactly ${wanted.join(", ")}`);
  }
}

exactDirectoryEntries(skillDirectory, ["SKILL.md", "agents"]);
exactDirectoryEntries(`${skillDirectory}/agents`, ["openai.yaml"]);

const skill = readRequired(skillPath);
const metadataText = readRequired(metadataPath);
const schemaText = readRequired(schemaPath);
const connector = readRequired(connectorPath);
const proposalCommand = readRequired(proposalCommandPath);

if (skill !== null) {
  const normalizedSkill = skill.replace(/\s+/g, " ");
  if (skill.split(/\r?\n/).length > 500) {
    report(skillPath, "SKILL.md exceeds the 500-line progressive-disclosure bound");
  }

  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(skill);
  if (frontmatterMatch === null) {
    report(skillPath, "YAML frontmatter is missing");
  } else {
    const frontmatter = parseYaml(skillPath, frontmatterMatch[1]);
    if (exactKeys(skillPath, frontmatter, ["description", "name"], "frontmatter")) {
      if (frontmatter.name !== "viberacing-propose-car") {
        report(skillPath, "frontmatter name is not the canonical skill name");
      }
      if (frontmatter.description !== expectedDescription) {
        report(skillPath, "description does not close the trigger and authority scope");
      }
    }
  }

  for (const fragment of [
    "no prompt or conversation text",
    "styling-request text, an arbitrary color, any URL other than the validated origin",
    "Never discover, download, build, update, or replace the connector.",
    "private pending proposal",
    "literal `://` delimiter",
    "remote: scheme = ^https$",
    "remote: authority = ^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(?::[0-9]{1,5})?$",
    "local: scheme = ^http$",
    "local: authority = ^(?:localhost|127\\.0\\.0\\.1|\\[::1\\])(?::[0-9]{1,5})?$",
    "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$",
    "Make one attempt only. Do not retry",
    "Do not invoke `connect`, `sync`, a direct HTTP client",
    "proposal may still be pending",
    "Do not echo raw process output",
  ]) {
    if (!normalizedSkill.includes(fragment)) {
      report(skillPath, `required fail-closed instruction is missing: ${JSON.stringify(fragment)}`);
    }
  }

  let schema;
  if (schemaText !== null) {
    try {
      schema = JSON.parse(schemaText);
    } catch {
      report(schemaPath, "CarRecipe schema is malformed JSON");
    }
  }
  if (schema !== undefined) {
    const properties = schema.properties;
    const recipeFields = ["chassis", "nose", "cockpit", "wing", "wheels", "palette", "trail"];
    const schemaFields = ["schemaVersion", ...recipeFields, "seed"];
    if (
      schema.type !== "object" ||
      schema.additionalProperties !== false ||
      JSON.stringify(schema.required) !== JSON.stringify(schemaFields) ||
      JSON.stringify(Object.keys(properties ?? {})) !== JSON.stringify(schemaFields)
    ) {
      report(schemaPath, "CarRecipeV1 must remain the exact closed nine-field schema source");
    }
    for (const field of recipeFields) {
      const row = new RegExp(`^\\|\\s*${field}\\s*\\|\\s*(.*?)\\s*\\|$`, "m").exec(skill);
      const skillValues =
        row === null ? [] : [...row[1].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
      const schemaValues = properties?.[field]?.enum;
      if (
        !Array.isArray(schemaValues) ||
        JSON.stringify(skillValues) !== JSON.stringify(schemaValues)
      ) {
        report(skillPath, `${field} inventory differs from the canonical CarRecipeV1 schema`);
      }
    }
    if (
      properties?.schemaVersion?.const !== 1 ||
      properties?.seed?.minimum !== 0 ||
      properties?.seed?.maximum !== 65_535 ||
      !skill.includes("`schemaVersion` set to `1`") ||
      !skill.includes("from `0` through `65535`")
    ) {
      report(
        skillPath,
        "schema version or seed bounds differ from the canonical CarRecipeV1 schema",
      );
    }
  }

  const expectedCommand =
    "viberacing-connector propose-car --origin <origin> --label <label> --chassis <chassis> --nose <nose> --cockpit <cockpit> --wing <wing> --wheels <wheels> --palette <palette> --trail <trail> --seed <seed>";
  const expectedOutput = "Car proposal submitted. Review it in your account.";
  const textFences = [...skill.matchAll(/```text\r?\n([\s\S]*?)\r?\n```/g)].map((match) =>
    match[1].trim(),
  );
  if (JSON.stringify(textFences) !== JSON.stringify([expectedCommand, expectedOutput])) {
    report(
      skillPath,
      "executable examples are not the one fixed command and one generic success line",
    );
  }

  if (connector !== null) {
    const usageLine = /viberacing-connector propose-car [^"\r\n]+/.exec(connector)?.[0];
    const connectorFlags = usageLine?.match(/--[a-z-]+/g) ?? [];
    const skillFlags = expectedCommand.match(/--[a-z-]+/g) ?? [];
    if (JSON.stringify(connectorFlags) !== JSON.stringify(skillFlags)) {
      report(skillPath, "fixed command flags drift from the connector CLI");
    }
    if (
      proposalCommand !== null &&
      !proposalCommand.replace(/\s+/g, " ").includes(`writeln!(output, "${expectedOutput}")`)
    ) {
      report(skillPath, "generic success line drifts from the connector CLI");
    }
  }
}

if (metadataText !== null) {
  const metadata = parseYaml(metadataPath, metadataText);
  if (exactKeys(metadataPath, metadata, ["interface"], "metadata")) {
    const interfaceValue = metadata.interface;
    if (
      exactKeys(
        metadataPath,
        interfaceValue,
        ["default_prompt", "display_name", "short_description"],
        "interface",
      )
    ) {
      if (interfaceValue.display_name !== "Vibe Racing Car Proposal") {
        report(metadataPath, "display_name is not canonical");
      }
      if (interfaceValue.short_description !== "Create a bounded private car proposal") {
        report(metadataPath, "short_description is not canonical");
      }
      if (interfaceValue.default_prompt !== expectedDefaultPrompt) {
        report(metadataPath, "default_prompt is not canonical");
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`Agent-skill check failed with ${failures.length} finding(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Agent-skill check passed (1 bounded skill).");
