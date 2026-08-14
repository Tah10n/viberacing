import test from "node:test";
import assert from "node:assert/strict";
import { executableCandidates, resolveAgentExecutable } from "../lib/executables.mjs";

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
});

test("uses common standalone locations for every executable-backed agent", () => {
  const cursor = executableCandidates("cursor", {
    platform: "darwin",
    home: "/Users/racer",
    environment: { PATH: "" },
  });
  const antigravity = executableCandidates("antigravity", {
    platform: "linux",
    home: "/home/racer",
    environment: { PATH: "" },
  });
  assert.ok(cursor.includes("/Users/racer/.local/bin/cursor-agent"));
  assert.ok(cursor.includes("/Applications/Cursor.app/Contents/Resources/cursor-agent"));
  assert.ok(antigravity.includes("/home/racer/.local/bin/agy"));
  assert.ok(antigravity.includes("/snap/bin/agy"));
});
