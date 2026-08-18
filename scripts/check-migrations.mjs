import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = resolve(root, "apps/web/database");
const manifestPath = resolve(directory, "checksums.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const migrations = (await readdir(directory))
  .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
if (JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(migrations)) {
  throw new Error("Migration checksum manifest must list every migration exactly once");
}
for (const migration of migrations) {
  const sql = await readFile(resolve(directory, migration));
  const checksum = createHash("sha256").update(sql).digest("hex");
  if (manifest[migration] !== checksum) {
    throw new Error(
      `Migration checksum mismatch: ${migration}. Published migrations are append-only.`,
    );
  }
}
process.stdout.write(
  `Migration integrity passed: ${migrations.length} append-only files checked.\n`,
);
