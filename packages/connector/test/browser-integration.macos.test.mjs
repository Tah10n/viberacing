import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { registerBrowserSync, unregisterBrowserSync } from "../lib/browser-integration.mjs";

const execute = promisify(execFile);
const enabled =
  process.platform === "darwin" && process.env.VIBERACING_TEST_MAC_URL_HANDLER === "1";

async function waitForFile(path, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the macOS URL handler sentinel");
}

test(
  "macOS LaunchServices delivers a custom-scheme URL to the compiled handler",
  { skip: !enabled, timeout: 30_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "viberacing-real-mac-handler-"));
    const suffix = `t${randomUUID().replaceAll("-", "")}`;
    const appName = `Vibe Racing Test ${suffix}`;
    const bundleIdentifier = `com.viberacing.test.${suffix}`;
    const urlScheme = `viberacingtest${suffix}`;
    const sentinel = join(root, "received-url.txt");
    const runtime = join(root, "handler-runtime.mjs");
    const url = `${urlScheme}://sync?sentinel=${suffix}`;
    const commandErrors = [];
    const options = {
      allowCustomState: true,
      execute: async (file, arguments_) => {
        try {
          return await execute(file, arguments_);
        } catch (error) {
          commandErrors.push(
            `${file}: ${error?.stderr?.trim() || error?.message || "command failed"}`,
          );
          throw error;
        }
      },
      homeDirectory: homedir(),
      macAppName: appName,
      macBundleIdentifier: bundleIdentifier,
      platform: "darwin",
      runtimeExecutable: process.execPath,
      stateDirectory: root,
      urlScheme,
    };
    try {
      await writeFile(
        runtime,
        `import { writeFile } from "node:fs/promises";\nif (process.argv[2] !== "handle-url" || typeof process.argv[3] !== "string") process.exit(2);\nawait writeFile(${JSON.stringify(sentinel)}, process.argv[3] + "\\n", { mode: 0o600 });\n`,
        { mode: 0o700 },
      );
      assert.equal(await registerBrowserSync(runtime, options), true, commandErrors.join("\n"));
      assert.equal(
        await registerBrowserSync(runtime, options),
        true,
        `owned handler replacement failed\n${commandErrors.join("\n")}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      await execute("/usr/bin/open", [url]);
      await waitForFile(sentinel);
      assert.equal(await readFile(sentinel, "utf8"), `${url}\n`);
    } finally {
      await unregisterBrowserSync(options).catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  },
);
