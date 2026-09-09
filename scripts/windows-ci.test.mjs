import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const preload = fileURLToPath(new URL("./ci/windows-process-profile.cjs", import.meta.url));

test("Windows matrix covers every native shard once and keeps the required aggregate gate", async () => {
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.deepEqual(
    [...workflow.matchAll(/^\s+shard: (\d+\/\d+)$/gm)].map((match) => match[1]),
    ["1/4", "2/4", "3/4", "4/4"],
  );
  assert.match(
    workflow,
    /--test\s+--test-concurrency=1\s+--test-shard=\$\{\{\s+matrix\.shard\s+\}\}/,
  );
  assert.doesNotMatch(workflow, /test\/windows-security.test.mjs|test\/cursor-sync.test.mjs/);
  assert.match(workflow, /needs: \[connector, local-smoke, browser-e2e, production\]/);
  assert.match(workflow, /test "\$CONNECTOR_RESULT" = success/);
  assert.doesNotMatch(workflow, /continue-on-error:/);
  assert.ok(workflow.includes(".Replace('\\', '/')"));
  assert.equal(
    workflow.match(/NODE_OPTIONS: \$\{\{ steps\.windows_profile\.outputs\.node_options \}\}/g)
      ?.length,
    2,
  );
  assert.match(
    workflow,
    /name: Verify Cursor evidence probe on the host OS\n\s+if: runner.os != 'Windows' \|\| matrix.shard == '1\/4'/,
  );
});

test("subprocess timing preserves success, nonzero exit and spawn errors without recording arguments", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "viberacing-process-profile-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const source = `
    const { execFile } = require('node:child_process');
    const run = (file, args) => new Promise(resolve => execFile(file, args, (error, stdout) =>
      resolve({ code: error?.code ?? 0, stdout })));
    (async () => {
      const results = [];
      results.push(await run(process.execPath, ['-e', 'console.log("private-argument-marker")']));
      results.push(await run(process.execPath, ['-e', 'process.exit(7)']));
      results.push(await run('viberacing-nonexistent-profile-fixture', []));
      console.log(JSON.stringify(results));
    })();
  `;
  const baseline = execFileSync(process.execPath, ["-e", source], { encoding: "utf8" });
  const profiled = execFileSync(process.execPath, ["-e", source], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${JSON.stringify(preload)}`,
      VIBERACING_CI_PROCESS_PROFILE: directory,
    },
  });
  assert.equal(profiled, baseline);
  const files = await readdir(directory);
  assert.equal(files.length, 1);
  const raw = await readFile(join(directory, files[0]), "utf8");
  assert.doesNotMatch(raw, /private-argument-marker|nonexistent|node|\.exe|[\\/]/);
  const metrics = JSON.parse(raw);
  assert.deepEqual(metrics.powershell, { calls: 0, completed: 0, elapsedMs: 0 });
  assert.equal(metrics.other.calls, 3);
  assert.equal(metrics.other.completed, 3);
  assert.ok(metrics.other.elapsedMs > 0);
  const summary = execFileSync(
    process.execPath,
    [fileURLToPath(new URL("./ci/summarize-windows-profile.mjs", import.meta.url))],
    { encoding: "utf8", env: { ...process.env, VIBERACING_CI_PROCESS_PROFILE: directory } },
  );
  assert.match(summary, /\| other \| 3 \| 3 \|/);
});
