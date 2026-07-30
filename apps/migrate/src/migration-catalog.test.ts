import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MigrationCatalogError, loadReviewedMigrationCatalog } from "./migration-catalog.js";

const temporaryDirectories: string[] = [];
const migrationSql = `\\set ON_ERROR_STOP on

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;
SELECT pg_catalog.pg_advisory_xact_lock(824_762_001);
COMMIT;
`;

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function createCatalog(
  overrides: Readonly<{
    additionalFiles?: readonly Readonly<{
      contents: string | Buffer;
      name: string;
    }>[];
    extraFile?: boolean;
    invalidFile?: boolean;
    manifest?: unknown;
    migration?: string | Buffer;
    rawManifest?: string;
  }> = {},
): string {
  const directory = mkdtempSync(join(tmpdir(), "viberacing-migrate-catalog-"));
  temporaryDirectories.push(directory);
  const migration = overrides.migration ?? migrationSql;
  const manifest = overrides.manifest ?? {
    schemaVersion: 1,
    migrations: [
      {
        name: "identity_foundation",
        path: "database/migrations/0001_identity_foundation.sql",
        revision: 1,
        sha256: digest(migration),
      },
    ],
  };
  writeFileSync(
    join(directory, "manifest.json"),
    overrides.rawManifest ?? `${JSON.stringify(manifest)}\n`,
  );
  writeFileSync(join(directory, "0001_identity_foundation.sql"), migration);
  for (const file of overrides.additionalFiles ?? []) {
    writeFileSync(join(directory, file.name), file.contents);
  }
  if (overrides.extraFile === true) {
    writeFileSync(join(directory, "0002_extra_migration.sql"), migrationSql);
  }
  if (overrides.invalidFile === true) {
    writeFileSync(join(directory, "notes.txt"), "not a migration");
  }
  return directory;
}

function expectCatalogError(directory: string): void {
  expect(() => loadReviewedMigrationCatalog(directory)).toThrow(
    expect.objectContaining({
      message: "Migration catalog is invalid.",
      name: "MigrationCatalogError",
    }),
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("reviewed migration catalog", () => {
  it("loads and freezes the exact repository catalog after removing only the psql preamble", () => {
    const catalog = loadReviewedMigrationCatalog();

    expect(catalog.map(({ name, revision }) => ({ name, revision }))).toEqual([
      { name: "roles_schemas_and_identity", revision: 1 },
      { name: "authentication_passkeys_and_recovery", revision: 2 },
      { name: "agent_accounts_installations_and_pairing", revision: 3 },
      { name: "usage_ingest_replay_and_idempotency", revision: 4 },
      { name: "seasons_ranking_and_snapshots", revision: 5 },
      { name: "retention_deletion_admin_and_audit", revision: 6 },
      { name: "car_recipes", revision: 7 },
    ]);
    expect(catalog.every((entry) => !entry.sql.startsWith("\\set"))).toBe(true);
    expect(catalog.every((entry) => Object.isFrozen(entry))).toBe(true);
    expect(Object.isFrozen(catalog)).toBe(true);
  });

  it("loads one exact bounded synthetic catalog", () => {
    const catalog = loadReviewedMigrationCatalog(createCatalog());
    expect(catalog).toEqual([
      {
        name: "identity_foundation",
        revision: 1,
        sql: migrationSql.replace(/^\\set ON_ERROR_STOP on\n\n/, ""),
      },
    ]);
  });

  it.each([
    { manifest: { migrations: [], schemaVersion: 1 } },
    { rawManifest: "{" },
    { manifest: { migrations: [], schemaVersion: 2 } },
    { manifest: { extra: true, migrations: [], schemaVersion: 1 } },
    { manifest: "invalid" },
    {
      manifest: {
        migrations: [
          {
            name: "identity_foundation",
            path: "database/migrations/0002_identity_foundation.sql",
            revision: 1,
            sha256: digest(migrationSql),
          },
        ],
        schemaVersion: 1,
      },
    },
    {
      manifest: {
        migrations: [
          {
            name: "identity_foundation",
            path: "database/migrations/0001_identity_foundation.sql",
            revision: 1,
            sha256: "0".repeat(64),
          },
        ],
        schemaVersion: 1,
      },
    },
    {
      manifest: {
        migrations: [
          {
            extra: true,
            name: "identity_foundation",
            path: "database/migrations/0001_identity_foundation.sql",
            revision: 1,
            sha256: digest(migrationSql),
          },
        ],
        schemaVersion: 1,
      },
    },
    { extraFile: true },
    { invalidFile: true },
    { migration: "" },
    { migration: "BEGIN;\nCOMMIT;\n" },
    { migration: Buffer.from([0xff, 0xfe, 0xfd]) },
  ])("rejects a drifted or open catalog fixture: %#", (fixture) => {
    expectCatalogError(createCatalog(fixture));
  });

  it("rejects duplicate migration names even when revisions and files are otherwise canonical", () => {
    const manifest = {
      schemaVersion: 1,
      migrations: [
        {
          name: "identity_foundation",
          path: "database/migrations/0001_identity_foundation.sql",
          revision: 1,
          sha256: digest(migrationSql),
        },
        {
          name: "identity_foundation",
          path: "database/migrations/0002_identity_foundation.sql",
          revision: 2,
          sha256: digest(migrationSql),
        },
      ],
    };
    expectCatalogError(
      createCatalog({
        additionalFiles: [{ contents: migrationSql, name: "0002_identity_foundation.sql" }],
        manifest,
      }),
    );
  });

  it("normalizes missing-directory failures without exposing the path", () => {
    const missing = join(tmpdir(), "viberacing-missing-private-catalog");
    try {
      loadReviewedMigrationCatalog(missing);
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationCatalogError);
      expect(String(error)).not.toContain(missing);
      return;
    }
    throw new Error("expected missing catalog to fail");
  });

  it("rejects a non-directory catalog root", () => {
    const directory = createCatalog();
    expectCatalogError(join(directory, "manifest.json"));
  });
});
