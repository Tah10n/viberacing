import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectClaude } from "../lib/adapters/claude.mjs";
import { collectCaptureJsonl, collectJsonl, jsonLinesChunk } from "../lib/adapters/shared.mjs";

const range = { rangeStart: "2026-08-01", rangeEnd: "2026-08-31" };
const restore = (state) => JSON.parse(JSON.stringify(state));
const record = (id, tokens) =>
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-19T12:00:00.000Z",
    message: { id, role: "assistant", usage: { input_tokens: tokens, output_tokens: 0 } },
  });
const eventKey = (line) => {
  const { message } = JSON.parse(line);
  const date = "2026-08-19";
  return {
    id: message.id,
    date,
    entry: { date, totalTokens: String(message.usage.input_tokens) },
  };
};
const collectors = {
  Claude: (path, state) => collectClaude({ dataPath: path }, range, state),
  JSONL: (path, state) =>
    collectJsonl(
      { dataPath: path },
      () => [],
      () => true,
      state,
      range,
      eventKey,
    ),
  capture: (path, state) =>
    collectCaptureJsonl({ dataPath: path }, () => [], state, range, eventKey),
};

for (const [name, collect] of Object.entries(collectors)) {
  for (const checkpointed of [false, true]) {
    test(`${name} retries unresolved identity conflicts across restarts (${checkpointed ? "append" : "first read"})`, async (context) => {
      const directory = await mkdtemp(join(tmpdir(), "viberacing-conflict-retry-"));
      context.after(() => rm(directory, { recursive: true, force: true }));
      const path = join(directory, "session.jsonl");
      const accepted = `${record("message", 15)}\n`;
      await writeFile(path, accepted);
      const initial = checkpointed ? restore((await collect(path, {})).nextState) : {};
      await appendFile(path, `${record("message", 22)}\n${record("other", 7)}\n`);
      let state = initial;
      for (let restart = 0; restart < 3; restart += 1) {
        const result = await collect(path, restore(state));
        assert.equal(result.entries[0].totalTokens, "22");
        assert.equal(result.completeness, "partial");
        assert.ok(result.warnings.includes("local_event_identity_conflict"));
        assert.ok(result.diagnostics.some(({ code }) => code === "local_event_identity_conflict"));
        state = result.nextState;
      }
      // Removing the conflicting copy permits a complete checkpoint without losing other usage.
      await writeFile(path, `${accepted}${record("other", 7)}\n`);
      for (let restart = 0; restart < 2; restart += 1) {
        const result = await collect(path, restore(state));
        assert.equal(result.entries[0].totalTokens, "22");
        assert.equal(result.completeness, "complete");
        assert.deepEqual(result.warnings, []);
        state = result.nextState;
      }
    });
  }

  test(`${name} identical duplicates remain complete and count once across restarts`, async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "viberacing-duplicate-retry-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "session.jsonl");
    const row = `${record("message", 15)}\n`;
    await writeFile(path, row);
    let state = restore((await collect(path, {})).nextState);
    await appendFile(path, row);
    for (let restart = 0; restart < 2; restart += 1) {
      const result = await collect(path, restore(state));
      assert.equal(result.entries[0].totalTokens, "15");
      assert.equal(result.completeness, "complete");
      assert.deepEqual(result.warnings, []);
      state = result.nextState;
    }
  });
}

const checkpointFixture = JSON.parse(
  await readFile(
    new URL("./fixtures/jsonl-checkpoints-before-conflict-fix.json", import.meta.url),
    "utf8",
  ),
);

for (const name of ["Claude", "JSONL"]) {
  const collect = (path, state, reads = []) =>
    name === "Claude"
      ? collectClaude({ dataPath: path }, range, state, {
          readChunk: (...args) => {
            reads.push(args[1]);
            return jsonLinesChunk(...args);
          },
        })
      : collectJsonl(
          { dataPath: path },
          () => [],
          () => true,
          state,
          range,
          (line) => {
            reads.push(line);
            return eventKey(line);
          },
        );
  for (const appendBeforeUpgrade of [false, true]) {
    test(`${name} rechecks a pre-fix conflicting checkpoint on upgrade (${appendBeforeUpgrade ? "appended" : "unchanged"})`, async (context) => {
      const directory = await mkdtemp(join(tmpdir(), "viberacing-checkpoint-upgrade-"));
      context.after(() => rm(directory, { recursive: true, force: true }));
      const path = join(directory, "session.jsonl");
      const fixture = checkpointFixture.collectors[name].conflict;
      assert.equal(fixture.completeness, "partial");
      await writeFile(path, `${fixture.records.join("\n")}\n`);
      const metadata = await stat(path);
      let state = restore(fixture.state);
      state.files[path] = {
        ...state.files.$SOURCE_FILE,
        modifiedAt: metadata.mtimeMs,
        ino: metadata.ino,
      };
      delete state.files.$SOURCE_FILE;
      if (appendBeforeUpgrade) await appendFile(path, `${record("other", 7)}\n`);
      for (let restart = 0; restart < 3; restart += 1) {
        const result = await collect(path, restore(state));
        assert.equal(result.completeness, "partial");
        assert.equal(result.entries[0].totalTokens, appendBeforeUpgrade ? "22" : "15");
        assert.ok(result.warnings.includes("local_event_identity_conflict"));
        for (const [key, value] of Object.entries(fixture.state.ledger))
          assert.deepEqual(result.nextState.ledger[key], value);
        state = result.nextState;
      }
    });
  }

  test(`${name} preserves provisional tail usage while rechecking an old checkpoint`, async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "viberacing-checkpoint-tail-upgrade-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "session.jsonl");
    const fixture = checkpointFixture.collectors[name].clean;
    await writeFile(path, `${fixture.records.join("\n")}\n`);
    const metadata = await stat(path);
    const state = restore(fixture.state);
    state.files[path] = {
      ...state.files.$SOURCE_FILE,
      modifiedAt: metadata.mtimeMs,
      ino: metadata.ino,
    };
    delete state.files.$SOURCE_FILE;
    await appendFile(path, record("other", 7));
    const partial = await collect(path, state);
    assert.equal(partial.completeness, "partial");
    assert.equal(partial.entries[0].totalTokens, "22");
    assert.deepEqual(partial.nextState.ledger, fixture.state.ledger);
    assert.deepEqual(partial.nextState.files[path], state.files[path]);
    await appendFile(path, "\n");
    const complete = await collect(path, restore(partial.nextState));
    assert.equal(complete.completeness, "complete");
    assert.equal(complete.entries[0].totalTokens, "22");
  });

  test(`${name} validates a clean pre-fix checkpoint once and resumes incremental reads`, async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "viberacing-checkpoint-clean-upgrade-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "session.jsonl");
    const fixture = checkpointFixture.collectors[name].clean;
    await writeFile(path, `${fixture.records.join("\n")}\n`);
    const metadata = await stat(path);
    const state = restore(fixture.state);
    state.files[path] = {
      ...state.files.$SOURCE_FILE,
      modifiedAt: metadata.mtimeMs,
      ino: metadata.ino,
    };
    delete state.files.$SOURCE_FILE;
    const reads = [];
    const upgraded = await collect(path, state, reads);
    assert.ok(reads.length > 0, "upgrade must validate the old checkpoint");
    assert.equal(upgraded.completeness, "complete");
    assert.deepEqual(upgraded.nextState.ledger, fixture.state.ledger);
    reads.length = 0;
    const repeated = await collect(path, restore(upgraded.nextState), reads);
    assert.equal(repeated.completeness, "complete");
    assert.equal(repeated.entries[0].totalTokens, "15");
    assert.equal(reads.length, 0, "validated unchanged files should be skipped");
    await appendFile(path, `${record("other", 7)}\n`);
    const appended = await collect(path, restore(repeated.nextState), reads);
    assert.equal(appended.completeness, "complete");
    assert.equal(appended.entries[0].totalTokens, "22");
    assert.equal(reads.length, 1, "only the appended record/chunk should be read");
    if (name === "Claude") assert.equal(reads[0], metadata.size);
  });
}
