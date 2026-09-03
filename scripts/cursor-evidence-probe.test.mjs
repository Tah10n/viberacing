import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { link, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildEvidenceReport,
  installProbeHooks,
  quoteCommandArgument,
  removeProbeHooks,
  sanitizeCursorObservation,
} from "./cursor-evidence-probe.mjs";

const hmacKey = "a".repeat(43);

async function privateTemporaryDirectory(context, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("sanitizes Cursor payloads without retaining privacy canaries", () => {
  const canaries = {
    prompt: "CANARY_PROMPT_PRIVATE",
    response: "CANARY_RESPONSE_PRIVATE",
    code: "CANARY_SOURCE_CODE_PRIVATE",
    repository: "CANARY_REPOSITORY_PRIVATE",
    path: "/CANARY/ABSOLUTE/PATH",
    user_email: "canary.private@example.invalid",
    account_id: "CANARY_ACCOUNT_ID_PRIVATE",
    access_token: "CANARY_ACCESS_TOKEN_PRIVATE",
    api_key: "CANARY_API_KEY_PRIVATE",
    model: "CANARY_MODEL_PRIVATE",
    cost: "CANARY_COST_PRIVATE",
  };
  const observation = sanitizeCursorObservation(
    {
      ...canaries,
      cursor_version: "3.18.0",
      conversation_id: "conversation-1",
      generation_id: "generation-1",
      timestamp: "2026-09-03T00:00:01.000Z",
      status: "completed",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheWriteTokens: 40,
        reasoningTokens: 5,
        totalTokens: 100,
      },
      nested: { unknown_additive_field: true },
    },
    {
      surface: "desktop",
      scenario: "desktop-one-turn",
      eventName: "stop",
      hmacKey,
    },
  );
  const serialized = JSON.stringify(observation);
  for (const value of Object.values(canaries)) assert.doesNotMatch(serialized, new RegExp(value));
  assert.match(observation.accountKey, /^acct1_[A-Za-z0-9_-]{43}$/);
  assert.equal(observation.accountIdentitySource, "account_id");
  assert.equal(observation.eventIdentities.length, 2);
  assert.deepEqual(observation.tokenGroups, [
    {
      path: "$.usage",
      counters: {
        inputTokens: "10",
        outputTokens: "20",
        cacheReadTokens: "30",
        cacheWriteTokens: "40",
        reasoningTokens: "5",
        totalTokens: "100",
      },
      formulaEvidence: "matches_four_component_sum",
    },
  ]);
  assert.equal(observation.providerTimestamp, "2026-09-03T00:00:01.000Z");
});

test("rejects estimated, fractional, negative, and unsafe token counters", () => {
  const observation = sanitizeCursorObservation(
    {
      usage: {
        inputTokens: 1.5,
        outputTokens: -1,
        cacheReadTokens: Number.MAX_SAFE_INTEGER + 1,
        cacheWriteTokens: "01",
        totalTokens: "request-count-not-tokens",
      },
      cost: 42,
      requestCount: 999,
    },
    {
      surface: "cli-headless",
      scenario: "aborted-error",
      eventName: "stream-json",
      hmacKey,
    },
  );
  assert.equal(observation.tokenGroups.length, 0);
  assert.equal(observation.invalidCounterPaths.length, 5);
  assert.doesNotMatch(JSON.stringify(observation), /request-count-not-tokens/);
  assert.doesNotMatch(JSON.stringify(observation), /"cost":42/);
  assert.doesNotMatch(JSON.stringify(observation), /999/);
});

test("account and event identities are stable locally without retaining raw values", () => {
  const context = {
    surface: "cli-interactive",
    scenario: "cli-a-b-a",
    eventName: "stop",
    hmacKey,
  };
  const first = sanitizeCursorObservation(
    { user_email: "  USER@Example.Invalid ", request_id: "request-private" },
    context,
  );
  const second = sanitizeCursorObservation(
    { user_email: "user@example.invalid", request_id: "request-private" },
    context,
  );
  const other = sanitizeCursorObservation(
    { user_email: "other@example.invalid", request_id: "request-other" },
    context,
  );
  const camelCaseAliases = sanitizeCursorObservation(
    { userEmail: "user@example.invalid", requestId: "request-private" },
    context,
  );
  assert.equal(first.accountKey, second.accountKey);
  assert.equal(first.accountKey, camelCaseAliases.accountKey);
  assert.notEqual(first.accountKey, other.accountKey);
  assert.equal(first.eventIdentities[0].hash, second.eventIdentities[0].hash);
  assert.equal(first.eventIdentities[0].hash, camelCaseAliases.eventIdentities[0].hash);
  const serialized = JSON.stringify([first, second, other]);
  assert.doesNotMatch(serialized, /user@example\.invalid/i);
  assert.doesNotMatch(serialized, /request-private/);
});

test("hook installation is additive, idempotent, and removes only its own entries", async (context) => {
  const outputDirectory = await privateTemporaryDirectory(context, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(context, "viberacing-cursor-hooks-");
  const hooksFile = join(cursorRoot, "hooks.json");
  const foreign = {
    version: 1,
    vendorExtension: { enabled: true },
    hooks: {
      stop: [{ command: "foreign-stop --keep" }],
      afterFileEdit: [{ command: "foreign-edit --keep" }],
    },
  };
  await writeFile(hooksFile, `${JSON.stringify(foreign, null, 2)}\n`, { mode: 0o600 });

  const first = await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    hooksFile,
  });
  assert.equal(first.changed, true);
  assert.deepEqual(first.hooks, ["afterAgentResponse", "stop", "sessionEnd"]);
  const installed = JSON.parse(await readFile(hooksFile, "utf8"));
  assert.deepEqual(installed.vendorExtension, foreign.vendorExtension);
  assert.deepEqual(installed.hooks.afterFileEdit, foreign.hooks.afterFileEdit);
  assert.deepEqual(installed.hooks.stop[0], foreign.hooks.stop[0]);
  assert.equal(installed.hooks.stop.length, 2);
  assert.match(installed.hooks.stop[1].command, /--viberacing-cursor-evidence-probe/);

  const repeated = await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    hooksFile,
  });
  assert.equal(repeated.changed, false);

  const removed = await removeProbeHooks({ outputDirectory, hooksFile });
  assert.equal(removed.changed, true);
  const final = JSON.parse(await readFile(hooksFile, "utf8"));
  assert.deepEqual(final, foreign);
});

test("an installed POSIX hook executes the bounded sanitizer", async (context) => {
  if (process.platform === "win32") context.skip("the generated Windows command needs cmd.exe");
  const outputDirectory = await privateTemporaryDirectory(context, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(context, "viberacing-cursor-hooks-");
  const hooksFile = join(cursorRoot, "hooks.json");
  await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    hooksFile,
  });
  const installed = JSON.parse(await readFile(hooksFile, "utf8"));
  const stdout = execFileSync("/bin/sh", ["-c", installed.hooks.stop[0].command], {
    encoding: "utf8",
    input: JSON.stringify({
      prompt: "HOOK_PRIVATE_CANARY",
      generation_id: "generation-private",
      usage: {
        input_tokens: 1,
        output_tokens: 2,
        cache_read_tokens: 3,
        cache_write_tokens: 4,
        total_tokens: 10,
      },
    }),
  });
  assert.equal(stdout, "{}\n");
  const report = await buildEvidenceReport(outputDirectory);
  assert.equal(report.observationCount, 1);
  assert.equal(report.usageObservationCount, 1);
  const observationFiles = await import("node:fs/promises").then(({ readdir }) =>
    readdir(join(outputDirectory, "observations")),
  );
  const observation = await readFile(
    join(outputDirectory, "observations", observationFiles[0]),
    "utf8",
  );
  assert.doesNotMatch(observation, /HOOK_PRIVATE_CANARY|generation-private/);
});

test("hook installation fails closed for symlinks and hard links", async (context) => {
  if (process.platform === "win32") context.skip("link semantics differ on Windows");
  const outputDirectory = await privateTemporaryDirectory(context, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(context, "viberacing-cursor-hooks-");
  const target = join(cursorRoot, "target.json");
  const symlinkPath = join(cursorRoot, "symlink.json");
  const hardLinkPath = join(cursorRoot, "hardlink.json");
  await writeFile(target, '{"version":1,"hooks":{}}\n', { mode: 0o600 });
  await symlink(target, symlinkPath);
  await link(target, hardLinkPath);
  for (const hooksFile of [symlinkPath, hardLinkPath])
    await assert.rejects(
      installProbeHooks({
        outputDirectory,
        surface: "desktop",
        scenario: "desktop-one-turn",
        hooksFile,
      }),
      /bounded current-user regular file with one link/,
    );
});

test("Windows and POSIX hook argument quoting preserve literal values", () => {
  assert.equal(quoteCommandArgument("a b", "linux"), "'a b'");
  assert.equal(quoteCommandArgument("a'b", "darwin"), "'a'\"'\"'b'");
  assert.equal(quoteCommandArgument("plain", "win32"), "plain");
  assert.equal(quoteCommandArgument("a b", "win32"), '"a b"');
  assert.equal(quoteCommandArgument('a"b', "win32"), '"a\\"b"');
  assert.throws(() => quoteCommandArgument("unsafe\nvalue"), /control characters/);
});

test("an empty live-evidence directory reports a closed gate", async (context) => {
  const outputDirectory = await privateTemporaryDirectory(context, "viberacing-cursor-output-");
  const cursorRoot = await privateTemporaryDirectory(context, "viberacing-cursor-hooks-");
  await mkdir(cursorRoot, { recursive: true });
  await installProbeHooks({
    outputDirectory,
    surface: "desktop",
    scenario: "desktop-one-turn",
    hooksFile: join(cursorRoot, "hooks.json"),
  });
  const report = await buildEvidenceReport(outputDirectory);
  assert.equal(report.gatePassed, false);
  assert.equal(report.observationCount, 0);
  assert.equal(report.coreSurfaceUsage.desktop, false);
  assert.ok(report.limitations.includes("cursor_exact_source_not_proven"));
});

test("probe refuses an existing output directory with group or world access", async (context) => {
  if (process.platform === "win32") context.skip("POSIX modes do not apply on Windows");
  const outputDirectory = await privateTemporaryDirectory(context, "viberacing-cursor-output-");
  const { chmod } = await import("node:fs/promises");
  await chmod(outputDirectory, 0o755);
  await assert.rejects(
    installProbeHooks({
      outputDirectory,
      surface: "desktop",
      scenario: "desktop-one-turn",
      hooksFile: join(outputDirectory, "hooks.json"),
    }),
    /not owner-only/,
  );
});
