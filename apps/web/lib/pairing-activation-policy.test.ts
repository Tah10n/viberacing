import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const webRoot = join(import.meta.dirname, "..");
const ignoredDirectories = new Set([".next", "coverage", "node_modules"]);

function productionModulesReferencing(fragment: string): string[] {
  const matches: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          visit(path);
        }
      } else if (
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".test.tsx") &&
        readFileSync(path, "utf8").includes(fragment)
      ) {
        matches.push(relative(webRoot, path).replaceAll("\\", "/"));
      }
    }
  };
  visit(webRoot);
  return matches.sort((left, right) => left.localeCompare(right));
}

describe("pairing activation module policy", () => {
  it("confines the low-level pairing pool and high-level database adapters", () => {
    expect(productionModulesReferencing("pairing-database-pool")).toEqual([
      "lib/pairing-activation-database.ts",
      "lib/pairing-start-database.ts",
    ]);
    expect(productionModulesReferencing("pairing-activation-database")).toEqual([
      "lib/pairing-activation-application.ts",
    ]);
    expect(productionModulesReferencing("pairing-start-database")).toEqual([
      "lib/pairing-start-application.ts",
    ]);
  });
});
