import test from "node:test";
import assert from "node:assert/strict";
import { ensurePrivateStateDirectory } from "../lib/windows-security.mjs";

test("Windows state ACL is owner-only and failure is fail-closed", async () => {
  const calls = [];
  await ensurePrivateStateDirectory("C:\\Users\\racer\\.viberacing", {
    platform: "win32",
    environment: { SystemRoot: "C:\\Windows" },
    run: async (...arguments_) => calls.push(arguments_),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.ok(calls[0][1].includes("-NonInteractive"));
  assert.match(calls[0][1].at(-2), /SetAccessRuleProtection\(\$true,\$false\)/);
  assert.equal(calls[0][1].at(-1), "C:\\Users\\racer\\.viberacing");

  await assert.rejects(
    ensurePrivateStateDirectory("C:\\shared\\viberacing", {
      platform: "win32",
      environment: { SystemRoot: "C:\\Windows" },
      run: async () => {
        throw new Error("access denied");
      },
    }),
    /cannot enforce an owner-only Windows ACL/,
  );
  await assert.rejects(
    ensurePrivateStateDirectory("C:\\shared\\viberacing", {
      platform: "win32",
      environment: { SystemRoot: "." },
      run: async () => assert.fail("an ambient PowerShell must never be executed"),
    }),
    /cannot enforce an owner-only Windows ACL/,
  );
});
