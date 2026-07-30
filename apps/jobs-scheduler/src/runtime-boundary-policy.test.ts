import { resolve } from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const forbiddenRuntimeImports = [
  "child_process",
  "cluster",
  "dgram",
  "dns",
  "dns/promises",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "module",
  "net",
  "node:child_process",
  "node:cluster",
  "node:dgram",
  "node:dns",
  "node:dns/promises",
  "node:fs",
  "node:fs/promises",
  "node:http",
  "node:http2",
  "node:https",
  "node:module",
  "node:net",
  "node:sqlite",
  "node:tls",
  "node:vm",
  "node:worker_threads",
  "pg",
  "sqlite",
  "tls",
  "vm",
  "worker_threads",
] as const;

const runtimeBoundaryMessage =
  "The scheduler may reach PostgreSQL only through @viberacing/jobs and may not own filesystem, network, subprocess, worker, or durable-state authority.";

describe("Jobs scheduler runtime boundary lint policy", () => {
  it("rejects static, exported, dynamic, and legacy access to every forbidden runtime module", async () => {
    const eslint = new ESLint({ cwd: resolve(import.meta.dirname, "..") });
    const source = forbiddenRuntimeImports.flatMap((name, index) => {
      const suffix = String(index);
      return [
        `import * as direct${suffix} from "${name}";`,
        `const lazy${suffix} = import("${name}");`,
        `export { default as exported${suffix} } from "${name}";`,
        `export * from "${name}";`,
        `const legacy${suffix} = require("${name}");`,
      ];
    });
    source.push(
      `void [${forbiddenRuntimeImports
        .map((_, index) => {
          const suffix = String(index);
          return `direct${suffix}, lazy${suffix}, legacy${suffix}`;
        })
        .join(", ")}];`,
    );
    source.push("const directBuiltinLoader = process.getBuiltinModule;");
    source.push('const computedBuiltinLoader = process["getBuiltinModule"];');
    source.push("void [directBuiltinLoader, computedBuiltinLoader];");

    const [result] = await eslint.lintText(source.join("\n"), {
      filePath: resolve(import.meta.dirname, "scheduler.ts"),
    });

    const restrictions = result?.messages.filter(
      ({ message, ruleId }) =>
        (ruleId === "no-restricted-imports" || ruleId === "no-restricted-syntax") &&
        message.includes(runtimeBoundaryMessage),
    );
    expect(restrictions).toHaveLength(forbiddenRuntimeImports.length * 5 + 2);
  }, 120_000);
});
