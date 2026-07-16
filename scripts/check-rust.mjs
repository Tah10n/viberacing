import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (capture && result.stderr) {
      console.error(result.stderr.trim());
    }
    process.exit(result.status ?? 1);
  }
  return result.stdout?.trim() ?? "";
}

const rustVersion = run("rustc", ["--version"], true);
if (!rustVersion.startsWith("rustc 1.94.0 ")) {
  console.error(`Expected Rust 1.94.0, received ${rustVersion || "no version"}.`);
  process.exit(1);
}

const metadataText = run(
  "cargo",
  ["metadata", "--format-version", "1", "--locked", "--no-deps"],
  true,
);
const metadata = JSON.parse(metadataText);

if (metadata.packages.length > 0) {
  run("cargo", ["fmt", "--all", "--check"]);
  run("cargo", ["check", "--workspace", "--all-targets", "--all-features", "--locked"]);
  run("cargo", ["test", "--workspace", "--all-targets", "--all-features", "--locked"]);
  run("cargo", [
    "clippy",
    "--workspace",
    "--all-targets",
    "--all-features",
    "--",
    "-D",
    "warnings",
  ]);
}

console.log(
  metadata.packages.length > 0
    ? "Rust workspace check passed (toolchain, metadata, formatting, check, tests, clippy)."
    : "Rust workspace check passed (toolchain and empty-workspace metadata).",
);
