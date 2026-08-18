import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { promisify } from "node:util";
import { ensurePrivateStateDirectory } from "../lib/windows-security.mjs";

const execFileAsync = promisify(execFile);

test("Windows state ACL is owner-only and failure is fail-closed", async () => {
  const calls = [];
  await ensurePrivateStateDirectory("C:\\Users\\racer\\.viberacing", {
    platform: "win32",
    environment: { SystemRoot: "C:\\Windows" },
    run: async (...arguments_) => calls.push(arguments_),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.deepEqual(calls[0][1].slice(0, -1), [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
  ]);
  const decoded = Buffer.from(calls[0][1].at(-1), "base64").toString("utf16le");
  assert.match(decoded, /\$env:VIBERACING_WINDOWS_STATE_ACL_TARGET/);
  assert.match(decoded, /SetAccessRuleProtection\(\$true,\$false\)/);
  assert.doesNotMatch(decoded, /C:\\Users\\racer|\.viberacing/);
  assert.equal(
    calls[0][2].env.VIBERACING_WINDOWS_STATE_ACL_TARGET,
    "C:\\Users\\racer\\.viberacing",
  );
  assert.equal(calls[0][2].shell, undefined);

  let accessDeniedCalls = 0;
  await assert.rejects(
    ensurePrivateStateDirectory("C:\\shared\\viberacing", {
      platform: "win32",
      environment: { SystemRoot: "C:\\Windows" },
      run: async () => {
        accessDeniedCalls += 1;
        throw new Error("access denied");
      },
    }),
    /cannot enforce an owner-only Windows ACL/,
  );
  assert.equal(accessDeniedCalls, 1);
  await assert.rejects(
    ensurePrivateStateDirectory("C:\\shared\\viberacing", {
      platform: "win32",
      environment: { SystemRoot: "." },
      run: async () => assert.fail("an ambient PowerShell must never be executed"),
    }),
    /cannot enforce an owner-only Windows ACL/,
  );
});

test("Windows ACL retries one killed timeout and remains fail-closed after a second", async () => {
  const timeoutError = () => {
    const error = new Error("PowerShell timed out");
    error.code = null;
    error.killed = true;
    error.signal = "SIGTERM";
    return error;
  };
  const recoveredCalls = [];
  await ensurePrivateStateDirectory("C:\\Users\\racer\\retry-state", {
    platform: "win32",
    environment: { SystemRoot: "C:\\Windows" },
    run: async (...arguments_) => {
      recoveredCalls.push(arguments_);
      if (recoveredCalls.length === 1) throw timeoutError();
    },
  });
  assert.equal(recoveredCalls.length, 2);
  assert.deepEqual(recoveredCalls[1], recoveredCalls[0]);
  assert.equal(recoveredCalls[0][2].timeout, 15_000);

  let exhaustedCalls = 0;
  await assert.rejects(
    ensurePrivateStateDirectory("C:\\Users\\racer\\failed-state", {
      platform: "win32",
      environment: { SystemRoot: "C:\\Windows" },
      run: async () => {
        exhaustedCalls += 1;
        throw timeoutError();
      },
    }),
    /cannot enforce an owner-only Windows ACL/,
  );
  assert.equal(exhaustedCalls, 2);
});

test(
  "Windows creates an owner-only state directory that remains readable and writable",
  { skip: process.platform !== "win32" },
  async (context) => {
    const root = await mkdtemp(join(tmpdir(), "viberacing-windows-acl-"));
    const directory = join(root, "state & literal ' path");
    context.after(() => rm(root, { force: true, recursive: true }));

    const previousStateDirectory = process.env.VIBERACING_STATE_DIR;
    process.env.VIBERACING_STATE_DIR = directory;
    try {
      const config = await import(
        `../lib/config.mjs?windows-acl-integration=${encodeURIComponent(directory)}`
      );
      const source = {
        clientSourceId: "91919191-9191-4191-8191-919191919191",
        agentId: "codex",
        collectionMethod: "codex_app_server",
        dataPath: join(root, "codex-data"),
        suggestedLabel: "Codex",
        supportedSurface: "desktop",
      };
      await config.writeSources([source]);
      assert.deepEqual(await config.readSources(), [source]);
    } finally {
      if (previousStateDirectory === undefined) delete process.env.VIBERACING_STATE_DIR;
      else process.env.VIBERACING_STATE_DIR = previousStateDirectory;
    }

    const script = [
      "$ErrorActionPreference='Stop'",
      "$path=$env:VIBERACING_WINDOWS_STATE_ACL_TARGET",
      "$identity=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
      "$acl=[IO.Directory]::GetAccessControl($path)",
      "$rules=@($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))",
      "[PSCustomObject]@{ Protected=$acl.AreAccessRulesProtected; Owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value; Current=$identity; RuleCount=$rules.Count; RuleIdentity=$rules[0].IdentityReference.Value; RuleType=$rules[0].AccessControlType.ToString(); Rights=$rules[0].FileSystemRights.ToString() } | ConvertTo-Json -Compress",
    ].join("; ");
    const powershell = win32.join(
      process.env.SystemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const result = await execFileAsync(
      powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      {
        env: { ...process.env, VIBERACING_WINDOWS_STATE_ACL_TARGET: directory },
        windowsHide: true,
        timeout: 15_000,
      },
    );
    const acl = JSON.parse(result.stdout.trim());
    assert.equal(acl.Protected, true);
    assert.equal(acl.Owner, acl.Current);
    assert.equal(acl.RuleCount, 1);
    assert.equal(acl.RuleIdentity, acl.Current);
    assert.equal(acl.RuleType, "Allow");
    assert.match(acl.Rights, /FullControl/);
  },
);
