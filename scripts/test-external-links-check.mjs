import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const checker = resolve(import.meta.dirname, "check-external-links.mjs");
const fixtureRoot = mkdtempSync(join(tmpdir(), "viberacing-external-links-"));

function git(directory, ...args) {
  execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function makeFixture(name, markdown, hosts = ["example.com"]) {
  const directory = join(fixtureRoot, name);
  mkdirSync(join(directory, "config"), { recursive: true });
  writeFileSync(join(directory, "README.md"), markdown, "utf8");
  writeFileSync(
    join(directory, "config", "external-links.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        hosts: hosts.map((hostname) => ({
          hostname,
          purpose: `Reviewed documentation source for ${hostname}`,
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  git(directory, "init", "--quiet", "--initial-branch=main", "--template=");
  return directory;
}

function run(directory) {
  return spawnSync(process.execPath, [checker, "--root", directory], {
    cwd: directory,
    encoding: "utf8",
  });
}

const cases = [
  {
    name: "accepts a reviewed HTTPS link",
    markdown: "# Safe\n\n[Documentation](https://example.com/docs).\n",
    expectedStatus: 0,
  },
  {
    name: "rejects cleartext external HTTP",
    markdown: "# Unsafe\n\n[Documentation](http://example.com/docs).\n",
    expectedText: "absolute links must use HTTPS",
  },
  {
    name: "rejects an unreviewed hostname",
    markdown: "# Unsafe\n\n[Documentation](https://unreviewed.invalid/docs).\n",
    expectedText: "external hostname is not reviewed",
  },
  {
    name: "rejects URL credentials",
    markdown: "# Unsafe\n\n[Documentation](https://user:password@example.com/docs).\n",
    expectedText: "must not contain URL credentials",
  },
  {
    name: "rejects a literal local address",
    markdown: "# Unsafe\n\n[Documentation](https://127.0.0.1/docs).\n",
    expectedText: "not a literal/local address",
  },
  {
    name: "rejects a non-web absolute scheme",
    markdown: "# Unsafe\n\n[Documentation](file:///etc/passwd).\n",
    expectedText: "absolute links must use HTTPS",
  },
  {
    name: "rejects a sensitive query parameter",
    markdown: "# Unsafe\n\n[Documentation](https://example.com/docs?token=placeholder).\n",
    expectedText: "sensitive query parameter name is forbidden",
  },
  {
    name: "rejects a dormant allowlist entry",
    markdown: "# Unsafe\n\n[Documentation](https://example.com/docs).\n",
    hosts: ["example.com", "unused.example"],
    expectedText: "unused allowlisted hostname",
  },
];

try {
  for (const [index, testCase] of cases.entries()) {
    const directory = makeFixture(
      `case-${index}`,
      testCase.markdown,
      testCase.hosts ?? ["example.com"],
    );
    const result = run(directory);
    const expectedStatus = testCase.expectedStatus ?? 1;
    const output = `${result.stdout}${result.stderr}`;
    if (result.status !== expectedStatus) {
      throw new Error(
        `${testCase.name}: expected exit ${expectedStatus}, got ${result.status}\n${output}`,
      );
    }
    if (testCase.expectedText && !output.includes(testCase.expectedText)) {
      throw new Error(`${testCase.name}: missing ${testCase.expectedText}\n${output}`);
    }
  }
  console.log(`External-link checker tests passed (${cases.length} cases).`);
} finally {
  rmSync(fixtureRoot, { force: true, recursive: true });
}
