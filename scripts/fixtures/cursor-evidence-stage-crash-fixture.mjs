#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { chmod, link, writeFile } from "node:fs/promises";

const hooksFile = process.argv[2];
if (typeof hooksFile !== "string" || hooksFile.length === 0) process.exit(2);

const stage = `${hooksFile}.viberacing-cursor-evidence.stage-${process.pid}-${randomUUID()}`;
const document = {
  version: 1,
  hooks: { stop: [{ command: "foreign-stage-crash" }] },
};
await writeFile(stage, `${JSON.stringify(document, null, 2)}\n`, { flag: "wx", mode: 0o600 });
if (process.platform !== "win32") await chmod(stage, 0o600);
await link(stage, hooksFile);
process.kill(process.pid, "SIGKILL");
