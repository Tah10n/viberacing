import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { promisify } from "node:util";
import {
  cursorHookCommand,
  cursorHookMarker,
  inspectCursorHooks,
  observeCursorHooks,
  reconcileCursorHooks,
} from "../lib/cursor-hooks.mjs";
import {
  ensureOwnerOnlyWindowsFile,
  ensurePrivateStateDirectory,
} from "../lib/windows-security.mjs";

const owner = {
  installationId: "11111111-1111-4111-8111-111111111111",
  profileId: "22222222-2222-4222-8222-222222222222",
  launcher: "/synthetic/viberacing-hook.mjs",
};
const current = { stop: "current", sessionEnd: "current" };
const missing = { stop: "missing", sessionEnd: "missing" };
const foreign = { command: "echo private-foreign-command", timeout: 3 };
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "viberacing-cursor-hooks-"));
  await ensurePrivateStateDirectory(root);
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function put(root, document, path = join(root, "hooks.json")) {
  await writeFile(path, typeof document === "string" ? document : JSON.stringify(document), {
    mode: 0o600,
  });
  await ensureOwnerOnlyWindowsFile(path);
}
const get = async (root) => JSON.parse(await readFile(join(root, "hooks.json"), "utf8"));
const safeError = (error) =>
  error.diagnosticCode === "cursor_hook_stale" && !/private-|hooks\.json/.test(error.message);

test("Cursor clean install and repair preserve foreign entries and top-level fields", async (t) => {
  const root = await setup(t);
  assert.deepEqual(await inspectCursorHooks(root, owner), missing);
  const unknown = { future: ["private-value"], hooks: { custom: "preserve-this" } };
  await put(root, {
    version: 1,
    unknown,
    hooks: { stop: [foreign], futureHook: [foreign], custom: { unexpected: true } },
  });
  assert.equal(await reconcileCursorHooks(root, owner), true);
  assert.deepEqual(await inspectCursorHooks(root, owner), current);
  const installed = await get(root);
  assert.deepEqual(installed.unknown, unknown);
  assert.deepEqual(installed.hooks.stop[0], foreign);
  assert.deepEqual(installed.hooks.custom, { unexpected: true });
  const bytes = await readFile(join(root, "hooks.json"));
  assert.equal(await reconcileCursorHooks(root, owner), false);
  assert.deepEqual(await readFile(join(root, "hooks.json")), bytes);
  assert.equal(await reconcileCursorHooks(root, owner, { remove: true }), true);
  assert.deepEqual((await get(root)).hooks, {
    stop: [foreign],
    futureHook: [foreign],
    custom: { unexpected: true },
  });
  assert.equal(await reconcileCursorHooks(root, owner, { remove: true }), false);
  assert.deepEqual(await inspectCursorHooks(root, owner), missing);
});

test("Cursor installations and profile ownership are independent under parallel installs", async (t) => {
  const root = await setup(t);
  const other = { ...owner, installationId: randomUUID() };
  await Promise.all([reconcileCursorHooks(root, owner), reconcileCursorHooks(root, other)]);
  assert.deepEqual(await inspectCursorHooks(root, owner), current);
  assert.deepEqual(await inspectCursorHooks(root, other), current);
  assert.equal((await get(root)).hooks.stop.length, 2);
  await reconcileCursorHooks(root, owner, { remove: true });
  assert.deepEqual(await inspectCursorHooks(root, other), current);
  assert.equal((await get(root)).hooks.stop.length, 1);
});

test("Cursor modified and duplicate owned entries are repaired without touching another installation", async (t) => {
  const root = await setup(t);
  await reconcileCursorHooks(root, owner);
  const doc = await get(root);
  doc.hooks.stop[0].timeout = 1;
  doc.hooks.sessionEnd.push({ ...doc.hooks.sessionEnd[0] });
  doc.hooks.stop.push(foreign);
  await put(root, doc);
  assert.deepEqual(await inspectCursorHooks(root, owner), {
    stop: "modified",
    sessionEnd: "modified",
  });
  await reconcileCursorHooks(root, owner);
  assert.deepEqual(await inspectCursorHooks(root, owner), current);
  assert.deepEqual((await get(root)).hooks.stop[0], foreign);
});

test("Cursor malformed, oversized and unsupported config fails closed with safe diagnostics", async (t) => {
  const root = await setup(t);
  for (const value of [
    '{"private-secret":',
    '"private-secret"',
    '{"version":2}',
    '{"hooks":[]}',
    '{"hooks":{"stop":{}}}',
    "x".repeat(1024 * 1024 + 1),
    Buffer.from([0xff]).toString("latin1"),
  ]) {
    await put(root, value);
    const before = await readFile(join(root, "hooks.json"));
    await assert.rejects(reconcileCursorHooks(root, owner), safeError);
    assert.deepEqual(await readFile(join(root, "hooks.json")), before);
  }
});

test("Cursor rejects symlinks, hard links and unsafe directories without mutating targets", async (t) => {
  const root = await setup(t);
  const outside = join(root, "private-target.json");
  await put(root, { hooks: { stop: [foreign] } }, outside);
  await link(outside, join(root, "hooks.json"));
  await assert.rejects(reconcileCursorHooks(root, owner), safeError);
  assert.equal((await lstat(outside)).nlink, 2);
  await rm(join(root, "hooks.json"));
  if (process.platform !== "win32") {
    await symlink(outside, join(root, "hooks.json"));
    await assert.rejects(reconcileCursorHooks(root, owner), safeError);
    await rm(join(root, "hooks.json"));
    await chmod(root, 0o777);
    await assert.rejects(reconcileCursorHooks(root, owner), safeError);
    await chmod(root, 0o700);
  }
  assert.deepEqual(JSON.parse(await readFile(outside, "utf8")), { hooks: { stop: [foreign] } });
});

test("Cursor compare-and-swap rereads concurrent foreign edits", async (t) => {
  const root = await setup(t);
  await put(root, { version: 1, hooks: { stop: [foreign] } });
  let races = 0;
  await reconcileCursorHooks(root, owner, {
    beforeCompareAndSwap: async ({ attempt }) => {
      if (attempt === 0) {
        races++;
        await put(root, {
          version: 1,
          feature: true,
          hooks: { stop: [foreign], sessionEnd: [foreign] },
        });
      }
    },
  });
  assert.equal(races, 1);
  const doc = await get(root);
  assert.equal(doc.feature, true);
  assert.deepEqual(doc.hooks.stop[0], foreign);
  assert.deepEqual(doc.hooks.sessionEnd[0], foreign);
  assert.deepEqual(await inspectCursorHooks(root, owner), current);
});

test("Cursor interrupted displacement restores the old config before repair", async (t) => {
  const root = await setup(t);
  await put(root, { version: 1, privateField: "kept", hooks: { stop: [foreign] } });
  await assert.rejects(
    reconcileCursorHooks(root, owner, {
      afterDisplace: () => {
        throw new Error("private-failure");
      },
    }),
    safeError,
  );
  assert.deepEqual(await inspectCursorHooks(root, owner), { stop: "stale", sessionEnd: "stale" });
  await reconcileCursorHooks(root, owner);
  const doc = await get(root);
  assert.equal(doc.privateField, "kept");
  assert.deepEqual(doc.hooks.stop[0], foreign);
  assert.deepEqual(await inspectCursorHooks(root, owner), current);
  assert.deepEqual(
    (await readdir(root)).filter((name) => name.includes("viberacing-cursor-hooks")),
    [],
  );
});

test("Cursor concurrent creation after displacement preserves both foreign versions", async (t) => {
  const root = await setup(t);
  const second = { command: "echo private-second" };
  await put(root, { version: 1, hooks: { stop: [foreign] } });
  await reconcileCursorHooks(root, owner, {
    afterDisplace: async ({ attempt }) => {
      if (attempt === 0) await put(root, { version: 1, hooks: { stop: [second] } });
    },
  });
  const doc = await get(root);
  assert.deepEqual(doc.hooks.stop.slice(0, 2), [foreign, second]);
  assert.deepEqual(await inspectCursorHooks(root, owner), current);
});

test("Cursor ambiguous concurrent top-level changes preserve both copies and redact errors", async (t) => {
  const root = await setup(t);
  await put(root, { secret: "private-first", hooks: { stop: [foreign] } });
  await assert.rejects(
    reconcileCursorHooks(root, owner, {
      afterDisplace: async () => {
        await put(root, { secret: "private-second", hooks: {} });
      },
    }),
    safeError,
  );
  assert.equal((await get(root)).secret, "private-second");
  const backup = JSON.parse(
    await readFile(join(root, "hooks.json.viberacing-cursor-hooks.recovery"), "utf8"),
  );
  assert.equal(backup.secret, "private-first");
  await assert.rejects(reconcileCursorHooks(root, owner), safeError);
});

test("Cursor recovery can resume after reconciliation displacement or publication", async (t) => {
  for (const faultName of ["afterReconcileRename", "afterMergedPublish", "afterReconcileCleanup"]) {
    const root = await setup(t);
    await put(root, { version: 1, hooks: { stop: [foreign] } });
    await assert.rejects(
      reconcileCursorHooks(root, owner, {
        afterDisplace: async () => {
          await put(root, { version: 1, hooks: { sessionEnd: [foreign] } });
          throw new Error("interrupt");
        },
      }),
      safeError,
    );
    await assert.rejects(
      reconcileCursorHooks(root, owner, {
        recoveryFaults: {
          [faultName]: () => {
            throw new Error("interrupt");
          },
        },
      }),
      safeError,
    );
    await reconcileCursorHooks(root, owner);
    const doc = await get(root);
    assert.deepEqual(doc.hooks.stop[0], foreign);
    assert.deepEqual(doc.hooks.sessionEnd[0], foreign);
    assert.deepEqual(await inspectCursorHooks(root, owner), current);
  }
});

test("Cursor hooks quote literal paths and ownership markers on the native platform", async (t) => {
  const root = await setup(t);
  const directory = join(
    root,
    process.platform === "win32"
      ? "state %INJECT% ! ^ & (literal)"
      : "state ' ; touch injected ; echo '",
  );
  await mkdir(directory);
  const launcher = join(directory, "hook.mjs");
  const output = join(root, "args.json");
  await writeFile(
    launcher,
    'import { writeFile } from "node:fs/promises"; await writeFile(process.env.CURSOR_TEST_ARGV, JSON.stringify(process.argv.slice(2)));',
  );
  const options = { ...owner, launcher };
  const command = cursorHookCommand(options, "sessionEnd");
  const shell =
    process.platform === "win32"
      ? (process.env.ComSpec ?? win32.join(process.env.SystemRoot, "System32", "cmd.exe"))
      : "/bin/sh";
  await promisify(execFile)(
    shell,
    process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command],
    {
      cwd: root,
      windowsVerbatimArguments: process.platform === "win32",
      env: { ...process.env, CURSOR_TEST_ARGV: output, INJECT: "& echo injected &" },
    },
  );
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), [
    "cursor-hook",
    "--event",
    "sessionEnd",
    cursorHookMarker(owner),
  ]);
  assert.equal((await readdir(root)).includes("injected"), false);
  assert.throws(() => cursorHookCommand({ ...owner, launcher: "bad\npath" }, "stop"));
  assert.throws(() => cursorHookMarker({ ...owner, installationId: "private-secret" }));
});

test(
  "Cursor refuses a Windows hooks file whose ACL grants another principal access",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = await setup(t);
    await reconcileCursorHooks(root, owner);
    const path = join(root, "hooks.json");
    const before = await readFile(path);
    const script = [
      "$ErrorActionPreference='Stop'",
      "$path=$env:CURSOR_TEST_ACL_PATH",
      "$acl=[IO.File]::GetAccessControl($path)",
      "$everyone=New-Object Security.Principal.SecurityIdentifier('S-1-1-0')",
      "$rule=New-Object Security.AccessControl.FileSystemAccessRule($everyone,'Read','None','None','Allow')",
      "[void]$acl.AddAccessRule($rule)",
      "[IO.File]::SetAccessControl($path,$acl)",
    ].join("; ");
    await promisify(execFile)(
      win32.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { env: { ...process.env, CURSOR_TEST_ACL_PATH: path }, windowsHide: true, timeout: 15_000 },
    );
    assert.deepEqual(await inspectCursorHooks(root, owner), { stop: "stale", sessionEnd: "stale" });
    await assert.rejects(reconcileCursorHooks(root, owner), safeError);
    assert.deepEqual(await readFile(path), before);
  },
);

test("Cursor recovers an orphan stage after process death during hard-link publication", async (t) => {
  const root = await setup(t);
  await reconcileCursorHooks(root, owner);
  const stage = join(root, `hooks.json.viberacing-cursor-hooks.stage-999999-${randomUUID()}`);
  await link(join(root, "hooks.json"), stage);
  assert.equal((await lstat(stage)).nlink, 2);
  assert.deepEqual(await inspectCursorHooks(root, owner), { stop: "stale", sessionEnd: "stale" });
  await reconcileCursorHooks(root, owner);
  assert.equal((await lstat(join(root, "hooks.json"))).nlink, 1);
  assert.deepEqual(await inspectCursorHooks(root, owner), current);
  assert.equal(
    (await readdir(root)).some((name) => name.includes("stage-")),
    false,
  );
});

test("Cursor continuity observation exposes only file metadata and detects a changed current hooks file", async (t) => {
  const root = await setup(t);
  assert.deepEqual(await observeCursorHooks(root, owner), { hooks: missing, fingerprint: null });
  await reconcileCursorHooks(root, owner);
  const before = await observeCursorHooks(root, owner);
  assert.deepEqual(before.hooks, current);
  assert.deepEqual(Object.keys(before.fingerprint).sort(), [
    "ctimeMs",
    "dev",
    "ino",
    "mtimeMs",
    "size",
  ]);
  assert.equal(await reconcileCursorHooks(root, owner), false);
  assert.deepEqual(await observeCursorHooks(root, owner), before);
  await put(root, { ...(await get(root)), future: "private-observation-canary" });
  const after = await observeCursorHooks(root, owner);
  assert.deepEqual(after.hooks, current);
  assert.notDeepEqual(after.fingerprint, before.fingerprint);
  assert.ok(!JSON.stringify(after).includes("private-observation-canary"));
});
