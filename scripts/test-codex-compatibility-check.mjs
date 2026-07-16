import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const checker = resolve(import.meta.dirname, "check-codex-compatibility.mjs");
const fixtureRoot = mkdtempSync(join(tmpdir(), "viberacing-codex-compatibility-check-"));

function makeFixture(name) {
  const directory = resolve(fixtureRoot, name);
  mkdirSync(resolve(directory, "compat"), { recursive: true });
  mkdirSync(resolve(directory, "docs", "reference"), { recursive: true });
  cpSync(resolve(root, "compat", "codex"), resolve(directory, "compat", "codex"), {
    recursive: true,
  });
  cpSync(
    resolve(root, "docs", "reference", "codex-compatibility.md"),
    resolve(directory, "docs", "reference", "codex-compatibility.md"),
  );
  return directory;
}

function manifestPath(directory) {
  return resolve(directory, "compat", "codex", "0.144.4", "manifest.json");
}

function mutateManifest(directory, transform) {
  const path = manifestPath(directory);
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  transform(manifest);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function run(directory) {
  return spawnSync(process.execPath, [checker, "--root", directory], {
    cwd: root,
    encoding: "utf8",
  });
}

const cases = [
  {
    name: "accepts the checked-in candidate evidence",
    mutate() {},
    expectedStatus: 0,
  },
  {
    name: "rejects a missing manifest",
    mutate(directory) {
      rmSync(manifestPath(directory));
    },
    expectedStatus: 1,
    expectedText: "required compatibility file is missing",
  },
  {
    name: "rejects removal of every exact-version evidence directory",
    mutate(directory) {
      rmSync(resolve(directory, "compat", "codex", "0.144.4"), {
        recursive: true,
      });
    },
    expectedStatus: 1,
    expectedText: "at least one exact-version compatibility manifest is required",
  },
  {
    name: "rejects an unmanifested artifact",
    mutate(directory) {
      writeFileSync(resolve(directory, "compat", "codex", "0.144.4", "full-schema.json"), "{}\n");
    },
    expectedStatus: 1,
    expectedText: "unmanifested compatibility artifact",
  },
  {
    name: "rejects fixture digest drift",
    mutate(directory) {
      writeFileSync(
        resolve(directory, "compat", "codex", "0.144.4", "fixtures", "usage-nullable.jsonl"),
        '{"id":2,"result":{"summary":{},"dailyUsageBuckets":null}}\n',
      );
    },
    expectedStatus: 1,
    expectedText: "fixture digest does not match",
  },
  {
    name: "rejects source extract provenance drift",
    mutate(directory) {
      mutateManifest(directory, (manifest) => {
        manifest.extracts[0].sourceSha256 = "0".repeat(64);
      });
    },
    expectedStatus: 1,
    expectedText: "source digest must match the checked-in extract without its final LF",
  },
  {
    name: "rejects a compatibility path traversal",
    mutate(directory) {
      mutateManifest(directory, (manifest) => {
        manifest.fixtures[0].path = "../account-chatgpt.jsonl";
      });
    },
    expectedStatus: 1,
    expectedText: "fixture path is not a safe relative path",
  },
  {
    name: "rejects a candidate added to the support matrix",
    mutate(directory) {
      const path = resolve(directory, "docs", "reference", "codex-compatibility.md");
      writeFileSync(
        path,
        readFileSync(path, "utf8").replace(
          "| None          | Not available        | Not released         | None             | Unsupported until the full admission process passes |",
          `| 0.144.4 | sha256:${"a".repeat(64)} | >=0.1.0 <0.2.0 | Windows | Supported: [evidence](evidence.md) |`,
        ),
      );
    },
    expectedStatus: 1,
    expectedText: "candidate version must not appear in the support matrix",
  },
  {
    name: "rejects supported status without a matrix row",
    mutate(directory) {
      mutateManifest(directory, (manifest) => {
        manifest.status = "supported";
        manifest.supportBlockers = [];
      });
    },
    expectedStatus: 1,
    expectedText: "supported manifest requires a matching matrix row",
  },
  {
    name: "rejects a missing fixture",
    mutate(directory) {
      rmSync(resolve(directory, "compat", "codex", "0.144.4", "fixtures", "usage-daily.jsonl"));
    },
    expectedStatus: 1,
    expectedText: "required compatibility file is missing",
  },
  {
    name: "rejects stable method drift",
    mutate(directory) {
      mutateManifest(directory, (manifest) => {
        manifest.stableMethods[1].method = "thread/list";
      });
    },
    expectedStatus: 1,
    expectedText: "stable method allowlist or fixed parameters drifted",
  },
  {
    name: "rejects missing generated adversarial coverage",
    mutate(directory) {
      mutateManifest(directory, (manifest) => {
        manifest.generatedAdversarialCases.pop();
      });
    },
    expectedStatus: 1,
    expectedText: "generated adversarial-case inventory is incomplete",
  },
  {
    name: "rejects duplicate JSON keys in a fixture",
    mutate(directory) {
      writeFileSync(
        resolve(directory, "compat", "codex", "0.144.4", "fixtures", "account-chatgpt.jsonl"),
        '{"id":1,"id":1}\n',
      );
    },
    expectedStatus: 1,
    expectedText: "JSON must be canonical and duplicate-key free",
  },
  {
    name: "rejects non-canonical release provenance",
    mutate(directory) {
      mutateManifest(directory, (manifest) => {
        manifest.release.repository = "https://example.invalid/fork";
      });
    },
    expectedStatus: 1,
    expectedText: "release provenance is not exact and immutable",
  },
];

try {
  for (const [index, testCase] of cases.entries()) {
    const directory = makeFixture(`case-${index}`);
    testCase.mutate(directory);
    const result = run(directory);
    const output = `${result.stdout}${result.stderr}`;
    if (result.status !== testCase.expectedStatus) {
      throw new Error(
        `${testCase.name}: expected exit ${testCase.expectedStatus}, got ${result.status}\n${output}`,
      );
    }
    if (testCase.expectedText && !output.includes(testCase.expectedText)) {
      throw new Error(
        `${testCase.name}: missing ${JSON.stringify(testCase.expectedText)}\n${output}`,
      );
    }
  }
  console.log(`Codex compatibility checker tests passed (${cases.length} cases).`);
} finally {
  rmSync(fixtureRoot, { force: true, recursive: true });
}
