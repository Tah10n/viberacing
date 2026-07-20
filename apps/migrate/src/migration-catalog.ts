import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { TextDecoder } from "node:util";

const canonicalMigrationDirectory = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "database",
  "migrations",
);
const manifestFileName = "manifest.json";
const manifestPathPrefix = "database/migrations/";
const maximumManifestBytes = 64 * 1024;
const maximumMigrationBytes = 512 * 1024;
const maximumMigrationCount = 9_999;
const migrationNamePattern = /^[a-z][a-z0-9_]{2,62}$/;
const migrationFilePattern = /^[0-9]{4}_[a-z][a-z0-9_]{2,62}\.sql$/;
const digestPattern = /^[a-f0-9]{64}$/;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export interface ReviewedMigration {
  readonly name: string;
  readonly revision: number;
  readonly sql: string;
}

export type ReviewedMigrationCatalog = readonly ReviewedMigration[];

export class MigrationCatalogError extends Error {
  constructor() {
    super("Migration catalog is invalid.");
    this.name = "MigrationCatalogError";
  }
}

function fail(): never {
  throw new MigrationCatalogError();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === expected.size &&
    actual.every((key) => typeof key === "string" && expected.has(key))
  );
}

function ownValue(value: Record<string, unknown>, key: string): unknown {
  return value[key];
}

function readBoundedFile(path: string, maximumBytes: number): Buffer {
  const metadata = lstatSync(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > maximumBytes
  ) {
    fail();
  }
  const bytes = readFileSync(path);
  if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
    bytes.fill(0);
    fail();
  }
  return bytes;
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    fail();
  } finally {
    bytes.fill(0);
  }
}

function parseManifest(text: string): readonly Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    fail();
  }
  if (!isPlainRecord(parsed) || !hasExactKeys(parsed, ["schemaVersion", "migrations"])) {
    fail();
  }
  if (ownValue(parsed, "schemaVersion") !== 1) {
    fail();
  }
  const migrations = ownValue(parsed, "migrations");
  if (
    !Array.isArray(migrations) ||
    migrations.length < 1 ||
    migrations.length > maximumMigrationCount ||
    !migrations.every((entry) => isPlainRecord(entry))
  ) {
    fail();
  }
  return migrations;
}

function migrationBody(sql: string): string {
  const preamble = /^\\set ON_ERROR_STOP on\r?\n\r?\n/.exec(sql)?.[0];
  if (preamble === undefined || preamble.length >= sql.length) {
    fail();
  }
  return sql.slice(preamble.length);
}

export function loadReviewedMigrationCatalog(
  directory: string = canonicalMigrationDirectory,
): ReviewedMigrationCatalog {
  try {
    const directoryMetadata = lstatSync(directory);
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
      fail();
    }
    const entries = readdirSync(directory, { withFileTypes: true });
    if (
      entries.some(
        (entry) =>
          entry.isSymbolicLink() ||
          !entry.isFile() ||
          (entry.name !== manifestFileName && !migrationFilePattern.test(entry.name)),
      )
    ) {
      fail();
    }
    const manifestBytes = readBoundedFile(
      resolve(directory, manifestFileName),
      maximumManifestBytes,
    );
    const manifest = parseManifest(decodeUtf8(manifestBytes));
    const expectedFiles = new Set<string>([manifestFileName]);
    const migrationNames = new Set<string>();
    const catalog: ReviewedMigration[] = [];

    for (const [index, rawEntry] of manifest.entries()) {
      if (!hasExactKeys(rawEntry, ["revision", "name", "path", "sha256"])) {
        fail();
      }
      const revision = ownValue(rawEntry, "revision");
      const name = ownValue(rawEntry, "name");
      const path = ownValue(rawEntry, "path");
      const sha256 = ownValue(rawEntry, "sha256");
      const expectedRevision = index + 1;
      if (
        revision !== expectedRevision ||
        typeof name !== "string" ||
        !migrationNamePattern.test(name) ||
        typeof path !== "string" ||
        path !== `${manifestPathPrefix}${String(revision).padStart(4, "0")}_${name}.sql` ||
        typeof sha256 !== "string" ||
        !digestPattern.test(sha256)
      ) {
        fail();
      }
      if (migrationNames.has(name)) {
        fail();
      }
      migrationNames.add(name);
      const fileName = basename(path);
      expectedFiles.add(fileName);
      const migrationBytes = readBoundedFile(resolve(directory, fileName), maximumMigrationBytes);
      const observedDigest = createHash("sha256").update(migrationBytes).digest("hex");
      if (observedDigest !== sha256) {
        migrationBytes.fill(0);
        fail();
      }
      const sql = decodeUtf8(migrationBytes);
      catalog.push(Object.freeze({ name, revision, sql: migrationBody(sql) }));
    }

    const actualFiles = new Set(entries.map((entry) => entry.name));
    if (
      actualFiles.size !== expectedFiles.size ||
      [...actualFiles].some((fileName) => !expectedFiles.has(fileName))
    ) {
      fail();
    }
    return Object.freeze(catalog);
  } catch (error) {
    if (error instanceof MigrationCatalogError) {
      throw error;
    }
    fail();
  }
}
