import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { sanitizePublicPng } from "./lib/png-content-policy.mjs";

const root = resolve(import.meta.dirname, "..");
const requestedPath = process.argv[2];

if (!requestedPath) {
  console.error("Usage: node scripts/sanitize-png-metadata.mjs <repository-relative.png>");
  process.exit(2);
}

const target = resolve(root, requestedPath);
const relativePath = relative(root, target);
if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
  console.error("Refusing to sanitize a path outside the repository.");
  process.exit(2);
}
if (extname(target).toLowerCase() !== ".png") {
  console.error("The sanitizer accepts PNG files only.");
  process.exit(2);
}

const stats = lstatSync(target);
if (!stats.isFile() || stats.isSymbolicLink()) {
  console.error("The target must be a regular, non-symbolic-link file.");
  process.exit(2);
}

const original = readFileSync(target);
const { buffer, removedTypes } = sanitizePublicPng(original);
if (removedTypes.length === 0) {
  console.log(`${relativePath} already satisfies the public PNG metadata policy.`);
  process.exit(0);
}

const temporaryPath = `${target}.sanitize-${process.pid}.tmp`;
try {
  writeFileSync(temporaryPath, buffer, { flag: "wx", mode: stats.mode });
  renameSync(temporaryPath, target);
} finally {
  rmSync(temporaryPath, { force: true });
}

console.log(
  `${relativePath}: removed ${removedTypes.map((type) => JSON.stringify(type)).join(", ")}; pixel data chunks were retained byte-for-byte.`,
);
