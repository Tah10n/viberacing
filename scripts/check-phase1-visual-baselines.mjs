import { resolve } from "node:path";
import process from "node:process";
import { verifyPhase1BaselineDirectory } from "./lib/phase1-visual-baseline-integrity.mjs";
import { phase1BaselineRoot } from "./lib/phase1-visual-baseline-policy.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const rootArgument = process.argv.indexOf("--root");
const baselineRoot =
  rootArgument === -1
    ? resolve(repositoryRoot, phase1BaselineRoot)
    : resolve(process.argv[rootArgument + 1] ?? "");

if (
  process.argv.length !== (rootArgument === -1 ? 2 : 4) ||
  (rootArgument !== -1 && rootArgument !== 2)
) {
  console.error("Usage: node scripts/check-phase1-visual-baselines.mjs [--root <directory>]");
  process.exit(2);
}

try {
  const snapshot = verifyPhase1BaselineDirectory(baselineRoot);
  console.log(
    `Phase 1 visual-baseline check passed (${snapshot.entries.length} page-only PNGs, ` +
      `${snapshot.totalBytes} bytes, ${snapshot.browserProduct}).`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown integrity failure";
  console.error(`Phase 1 visual-baseline check failed: ${message}`);
  process.exit(1);
}
