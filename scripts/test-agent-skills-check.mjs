import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const checker = resolve(import.meta.dirname, "check-agent-skills.mjs");
const sourcePaths = [
  ".agents/skills/viberacing-propose-car",
  ".agents/skills/viberacing-verify",
  "contracts/v1/car-recipe.schema.json",
  "crates/connector/src/connect.rs",
  "crates/connector/src/connect/car_proposal_command.rs",
  "package.json",
];
const verifySkillPath = ".agents/skills/viberacing-verify/SKILL.md";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "viberacing-agent-skill-"));
  for (const path of sourcePaths) {
    const destination = resolve(directory, path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(resolve(root, path), destination, { recursive: true });
  }
  return directory;
}

function run(directory) {
  return spawnSync(process.execPath, [checker, "--root", directory], {
    encoding: "utf8",
    windowsHide: true,
  });
}

function mutate(directory, relativePath, from, to) {
  const path = resolve(directory, relativePath);
  const value = readFileSync(path, "utf8");
  if (!value.includes(from)) {
    throw new Error(`fixture mutation source not found: ${from}`);
  }
  writeFileSync(path, value.replace(from, to));
}

function expectFailure(name, mutateFixture, pattern) {
  const directory = fixture();
  try {
    mutateFixture(directory);
    const result = run(directory);
    const output = `${result.stdout}${result.stderr}`;
    if (result.status === 0 || !pattern.test(output)) {
      throw new Error(`${name} did not fail closed as expected:\n${output}`);
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

const baseline = fixture();
try {
  const result = run(baseline);
  if (result.status !== 0) {
    throw new Error(`baseline agent skill failed:\n${result.stdout}${result.stderr}`);
  }
} finally {
  rmSync(baseline, { force: true, recursive: true });
}

expectFailure(
  "enum drift",
  (directory) =>
    mutate(directory, sourcePaths[0] + "/SKILL.md", "`grid`, `none`, `spark`", "`grid`, `none`"),
  /trail inventory differs/,
);

expectFailure(
  "schema widening",
  (directory) =>
    mutate(
      directory,
      "contracts/v1/car-recipe.schema.json",
      '    "seed": {',
      '    "spoiler": { "type": "string" },\n    "seed": {',
    ),
  /exact closed nine-field schema source/,
);

expectFailure(
  "command widening",
  (directory) =>
    mutate(directory, sourcePaths[0] + "/SKILL.md", "--seed <seed>", "--seed <seed> --activate"),
  /executable examples are not the one fixed command/,
);

expectFailure(
  "unsafe origin grammar",
  (directory) =>
    mutate(
      directory,
      sourcePaths[0] + "/SKILL.md",
      "remote: authority = ^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(?::[0-9]{1,5})?$",
      "remote: authority = ^.+$",
    ),
  /required fail-closed instruction is missing/,
);

expectFailure(
  "unsafe label grammar",
  (directory) =>
    mutate(directory, sourcePaths[0] + "/SKILL.md", "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$", ".+"),
  /required fail-closed instruction is missing/,
);

expectFailure(
  "retry permission",
  (directory) =>
    mutate(
      directory,
      sourcePaths[0] + "/SKILL.md",
      "Make one attempt only. Do not retry",
      "Retry once",
    ),
  /required fail-closed instruction is missing/,
);

expectFailure(
  "local credential removal permission",
  (directory) =>
    mutate(
      directory,
      sourcePaths[0] + "/SKILL.md",
      "Do not invoke `connect`, `forget-local`, `sync`, a direct HTTP client",
      "Do not invoke `connect`, `sync`, a direct HTTP client",
    ),
  /required fail-closed instruction is missing/,
);

expectFailure(
  "stale success output",
  (directory) =>
    mutate(
      directory,
      sourcePaths[0] + "/SKILL.md",
      "Car proposal submitted. Review it in your account.",
      "Proposal complete.",
    ),
  /executable examples are not the one fixed command/,
);

expectFailure(
  "ambiguous response overstatement",
  (directory) =>
    mutate(
      directory,
      sourcePaths[0] + "/SKILL.md",
      "proposal may still be pending",
      "existing state is unchanged",
    ),
  /required fail-closed instruction is missing/,
);

expectFailure(
  "frontmatter widening",
  (directory) =>
    mutate(
      directory,
      sourcePaths[0] + "/SKILL.md",
      "name: viberacing-propose-car",
      "name: viberacing-propose-car\nversion: 1",
    ),
  /frontmatter keys must be exactly/,
);

expectFailure(
  "implicit prompt drift",
  (directory) =>
    mutate(
      directory,
      sourcePaths[0] + "/agents/openai.yaml",
      "$viberacing-propose-car",
      "the car skill",
    ),
  /default_prompt is not canonical/,
);

expectFailure(
  "invocation allowlist contradiction",
  (directory) =>
    mutate(
      directory,
      sourcePaths[0] + "/SKILL.md",
      "styling-request text, an arbitrary color, any URL other than the validated origin",
      "user text, an arbitrary color, URL",
    ),
  /required fail-closed instruction is missing/,
);

expectFailure(
  "verification command widening",
  (directory) => mutate(directory, verifySkillPath, "pnpm run verify", "pnpm run verify -- --fix"),
  /executable examples differ from the reviewed verification allowlist/,
);

expectFailure(
  "verification staging permission",
  (directory) =>
    mutate(
      directory,
      verifySkillPath,
      "Do not stage files on the user's behalf.",
      "Stage the files before checking them.",
    ),
  /required fail-closed instruction is missing/,
);

expectFailure(
  "verification network permission",
  (directory) =>
    mutate(
      directory,
      verifySkillPath,
      "Do not run the online external-link check,",
      "Run the online external-link check,",
    ),
  /required fail-closed instruction is missing/,
);

expectFailure(
  "focused verification overstatement",
  (directory) =>
    mutate(
      directory,
      verifySkillPath,
      "A focused gate is\nnot a substitute",
      "A focused gate is\na substitute",
    ),
  /required fail-closed instruction is missing/,
);

expectFailure(
  "verification edit permission",
  (directory) =>
    mutate(
      directory,
      verifySkillPath,
      "but do not edit the project unless the user also asked for",
      "and edit the project immediately without waiting for",
    ),
  /required fail-closed instruction is missing/,
);

expectFailure(
  "verification history rewrite permission",
  (directory) =>
    mutate(
      directory,
      verifySkillPath,
      "Do not rewrite history, amend commits, or infer an author identity.",
      "Rewrite history and infer an author identity when needed.",
    ),
  /required fail-closed instruction is missing/,
);

expectFailure(
  "verification trigger widening",
  (directory) =>
    mutate(
      directory,
      verifySkillPath,
      "Those actions require a separate authorized workflow.",
      "This skill may perform those actions whenever useful.",
    ),
  /description does not close the verification authority scope/,
);

expectFailure(
  "verification implicit prompt drift",
  (directory) =>
    mutate(
      directory,
      ".agents/skills/viberacing-verify/agents/openai.yaml",
      "$viberacing-verify",
      "the verification skill",
    ),
  /default_prompt is not canonical/,
);

expectFailure(
  "verification runtime drift",
  (directory) =>
    mutate(
      directory,
      "package.json",
      '"packageManager": "pnpm@11.7.0"',
      '"packageManager": "pnpm@11.9.0"',
    ),
  /runtime pin differs from the canonical pnpm policy/,
);

expectFailure(
  "missing staged public-data script",
  (directory) =>
    mutate(directory, "package.json", '"check:public:staged":', '"check:public:index":'),
  /required verification script is missing: check:public:staged/,
);

expectFailure(
  "untracked scope omission",
  (directory) =>
    mutate(
      directory,
      verifySkillPath,
      "Inspect each untracked path directly with\nread-only file inspection;",
      "Skip direct review of each untracked path even with\nread-only file inspection;",
    ),
  /required fail-closed instruction is missing/,
);

expectFailure(
  "mutable Git inspection permission",
  (directory) =>
    mutate(
      directory,
      verifySkillPath,
      "Use only read-only Git inspection commands",
      "Use any convenient Git commands",
    ),
  /required fail-closed instruction is missing/,
);

expectFailure(
  "public output leakage permission",
  (directory) =>
    mutate(
      directory,
      verifySkillPath,
      "Never copy secrets, environment values, private logs, or local absolute paths into tracked files or",
      "Copy raw environment values and local paths into tracked files or",
    ),
  /required fail-closed instruction is missing/,
);

console.log("Agent-skill checker regressions passed (25 mutations).");
