#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const delayedPayloadEnvironmentVariable = "VIBERACING_CURSOR_EVIDENCE_DELAYED_PAYLOAD";

if (process.argv.includes("--version")) {
  process.stdout.write("1.2.3\n");
  process.exit(0);
}

if (process.argv.includes("--delayed-child")) {
  const payload = process.env[delayedPayloadEnvironmentVariable];
  if (typeof payload !== "string") process.exit(2);
  setTimeout(() => process.stdout.write(payload), 60);
} else {
  const first = Buffer.from(
    `${JSON.stringify({
      account_id: "account-first",
      user_email: "first@example.invalid",
      request_id: "request-first-2026-09-03T00:00:01.000Z",
      timestamp: "2026-09-03T00:00:01.000Z",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheWriteTokens: 40,
        totalTokens: 100,
      },
      note: "split-€-utf8",
    })}\n`,
  );
  const euro = first.indexOf(Buffer.from("€"));
  process.stdout.write(first.subarray(0, euro + 1));
  process.stdout.write(first.subarray(euro + 1));
  process.stdout.write("{malformed}\n");
  const late = `${JSON.stringify({
    account_id: "account-late",
    user_email: "late@example.invalid",
    request_id: "request-late-2026-09-03T00:00:01.000Z",
    timestamp: "2026-09-03T00:00:01.000Z",
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 40,
      totalTokens: 100,
    },
    status: "completed",
  })}\n`;
  spawn(process.execPath, [fileURLToPath(import.meta.url), "--delayed-child"], {
    env: { ...process.env, [delayedPayloadEnvironmentVariable]: late },
    stdio: ["ignore", "inherit", "inherit"],
  }).unref();
}
