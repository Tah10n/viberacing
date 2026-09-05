import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executableCandidates,
  resolvedExecutableInvocation,
  resolveAgentExecutable,
  spawnResolvedExecutable,
} from "../lib/executables.mjs";

test("finds a bundled macOS Codex even when PATH does not contain it", async () => {
  const bundled = "/Applications/ChatGPT.app/Contents/Resources/codex";
  const resolved = await resolveAgentExecutable("codex", {
    platform: "darwin",
    home: "/Users/racer",
    environment: { PATH: "/usr/bin:/bin" },
    accessible: async (candidate) => candidate === bundled,
  });
  assert.equal(resolved, bundled);
});

test("prefers an explicit executable and then the user's PATH", async () => {
  const environment = {
    PATH: "/custom/bin:/usr/bin",
    VIBERACING_CODEX_BIN: "/portable/codex",
  };
  assert.equal(
    await resolveAgentExecutable("codex", {
      platform: "linux",
      home: "/home/racer",
      environment,
      accessible: async () => true,
    }),
    "/portable/codex",
  );
  delete environment.VIBERACING_CODEX_BIN;
  assert.equal(
    await resolveAgentExecutable("codex", {
      platform: "linux",
      home: "/home/racer",
      environment,
      accessible: async () => true,
    }),
    "/custom/bin/codex",
  );
});

test("covers Windows package managers and installed application roots", () => {
  const candidates = executableCandidates("codex", {
    platform: "win32",
    home: "C:\\Users\\racer",
    environment: {
      PATH: "C:\\Tools;C:\\Windows\\System32",
      PATHEXT: ".EXE;.CMD",
      APPDATA: "C:\\Users\\racer\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\racer\\AppData\\Local",
      ProgramData: "C:\\ProgramData",
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
    },
  });
  assert.ok(candidates.includes("C:\\Tools\\codex.exe"));
  assert.ok(
    candidates.includes(
      "C:\\Users\\racer\\AppData\\Local\\Programs\\ChatGPT\\resources\\codex.exe",
    ),
  );
  assert.ok(candidates.includes("C:\\Users\\racer\\scoop\\shims\\codex.exe"));
  assert.ok(candidates.includes("C:\\ProgramData\\chocolatey\\bin\\codex.exe"));
  assert.ok(!candidates.includes("C:\\Tools\\codex"));
});

test("ignores extensionless Windows npm shims and resolves the command shim", async () => {
  const extensionless = "C:\\Users\\racer\\AppData\\Roaming\\npm\\codex";
  const commandShim = `${extensionless}.cmd`;
  const resolved = await resolveAgentExecutable("codex", {
    platform: "win32",
    home: "C:\\Users\\racer",
    environment: {
      PATH: "C:\\Users\\racer\\AppData\\Roaming\\npm",
      PATHEXT: ".EXE;.CMD",
      APPDATA: "C:\\Users\\racer\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\racer\\AppData\\Local",
    },
    accessible: async (candidate) => candidate === extensionless || candidate === commandShim,
  });
  assert.equal(resolved, commandShim);
});

test("uses common standalone locations for every executable-backed agent", () => {
  const antigravity = executableCandidates("antigravity", {
    platform: "linux",
    home: "/home/racer",
    environment: { PATH: "" },
  });
  assert.ok(antigravity.includes("/home/racer/.local/bin/agy"));
  assert.ok(antigravity.includes("/snap/bin/agy"));
});

test("routes Windows command shims through ComSpec with escaped arguments", () => {
  const invocation = resolvedExecutableInvocation(
    "C:\\Users\\Racer Name\\AppData\\Roaming\\npm\\codex.cmd",
    ["app-server", 'quoted "value"', "literal&pipe|redirect<value>"],
    {
      platform: "win32",
      environment: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    },
  );
  assert.equal(invocation.command, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(invocation.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(invocation.windowsVerbatimArguments, true);
  assert.match(invocation.args[3], /codex\.cmd/);
  assert.match(invocation.args[3], /\^&/);
  assert.match(invocation.args[3], /\^\|/);
  assert.match(invocation.args[3], /\^</);
  assert.match(invocation.args[3], /\^>/);
});

test(
  "executes Codex and Antigravity Windows npm shims with literal argv",
  { skip: process.platform !== "win32" },
  async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "viberacing windows shims "));
    context.after(() => rm(directory, { force: true, recursive: true }));
    const target = join(directory, "capture-args.mjs");
    await writeFile(target, "process.stdout.write(JSON.stringify(process.argv.slice(2)))\n");
    const expected = ["app-server", "path with spaces", 'quoted "value"', "a&b", "c|d", "x<y>z"];
    for (const name of ["codex.cmd", "agy.cmd", "agent.bat"]) {
      const shim = join(directory, name);
      await writeFile(shim, `@echo off\r\n"${process.execPath}" "${target}" %*\r\n`);
      const child = spawnResolvedExecutable(shim, expected, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      const code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      assert.equal(code, 0, stderr);
      assert.deepEqual(JSON.parse(stdout), expected);
    }
  },
);
