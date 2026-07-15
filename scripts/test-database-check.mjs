import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  validateAssertionSql,
  validateBootstrapSql,
  validateManifest,
  validateMigrationSql,
} from "./check-database.mjs";

const goodMigration = String.raw`\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL ROLE viberacing_owner;
SELECT pg_catalog.pg_advisory_xact_lock(1);
INSERT INTO viberacing_private.schema_migrations (revision, name)
VALUES (1, 'identity_foundation');
COMMIT;
`;
const goodPath = "database/migrations/0001_identity_foundation.sql";
const goodDigest = createHash("sha256").update(goodMigration).digest("hex");
const goodEntry = {
  revision: 1,
  name: "identity_foundation",
  path: goodPath,
  sha256: goodDigest,
};

assert.deepEqual(validateMigrationSql(goodPath, goodMigration), []);
assert.match(
  validateMigrationSql(goodPath, goodMigration.replace("BEGIN;", "")).join("\n"),
  /explicit transaction/,
);
assert.match(
  validateMigrationSql(goodPath, goodMigration.replace("SET LOCAL ROLE", "SET ROLE")).join("\n"),
  /non-login schema owner/,
);
assert.match(
  validateMigrationSql(goodPath, `${goodMigration}\nCREATE EXTENSION unsafe;`).join("\n"),
  /separate reviewed dependency/,
);
assert.match(
  validateMigrationSql(goodPath, `${goodMigration}\n\\include private.sql`).join("\n"),
  /file inclusion/,
);
assert.match(
  validateMigrationSql(
    goodPath,
    `${goodMigration}\nGRANT SELECT ON TABLE viberacing_private.profiles TO viberacing_web;`,
  ).join("\n"),
  /direct table/,
);
assert.match(
  validateMigrationSql(goodPath, `${goodMigration}\nGRANT USAGE ON SCHEMA x TO PUBLIC;`).join("\n"),
  /PUBLIC/,
);
assert.match(
  validateMigrationSql(
    goodPath,
    `${goodMigration}\nCREATE FUNCTION x() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';`,
  ).join("\n"),
  /pin search_path/,
);
assert.match(
  validateMigrationSql(goodPath, goodMigration.replace("identity_foundation", "wrong_name")).join(
    "\n",
  ),
  /exact filename revision/,
);

assert.deepEqual(
  validateManifest(
    { schemaVersion: 1, migrations: [goodEntry] },
    new Map([[goodPath, goodMigration]]),
  ),
  [],
);
assert.match(
  validateManifest(
    { schemaVersion: 1, migrations: [{ ...goodEntry, sha256: "0".repeat(64) }] },
    new Map([[goodPath, goodMigration]]),
  ).join("\n"),
  /checksum/,
);
assert.match(
  validateManifest(
    {
      schemaVersion: 1,
      migrations: [{ ...goodEntry, path: "../private.sql" }],
    },
    new Map([[goodPath, goodMigration]]),
  ).join("\n"),
  /path must match/,
);
assert.match(
  validateManifest(
    { schemaVersion: 1, migrations: [{ ...goodEntry, revision: 2 }] },
    new Map([[goodPath, goodMigration]]),
  ).join("\n"),
  /contiguous/,
);
assert.match(
  validateManifest(
    { schemaVersion: 1, migrations: [goodEntry] },
    new Map([
      [goodPath, goodMigration],
      ["database/migrations/0002_unreviewed.sql", goodMigration],
    ]),
  ).join("\n"),
  /unlisted migration/,
);

const roles = [
  "viberacing_owner",
  "viberacing_web",
  "viberacing_ingest",
  "viberacing_jobs",
  "viberacing_admin",
];
const alteration = roles
  .map(
    (role) =>
      `ALTER ROLE ${role} WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD NULL;`,
  )
  .join("\n");
const declarations = roles.map((role) => `'${role}'::name`).join(", ");
const goodBootstrap = String.raw`\set ON_ERROR_STOP on
BEGIN;
SELECT ${declarations};
${alteration}
GRANT viberacing_owner TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
SELECT 'ALTER ROLE %I IN DATABASE %I SET search_path TO pg_catalog, pg_temp';
REVOKE ALL ON DATABASE example FROM PUBLIC;
GRANT CONNECT ON DATABASE example TO CURRENT_USER;
SELECT 'ALTER DATABASE %I SET search_path TO pg_catalog, pg_temp';
REVOKE ALL ON SCHEMA public FROM PUBLIC;
COMMIT;
`;

assert.deepEqual(validateBootstrapSql(goodBootstrap), []);
assert.match(validateBootstrapSql(goodBootstrap.replace("NOLOGIN", "LOGIN")).join("\n"), /NOLOGIN/);
assert.match(
  validateBootstrapSql(`${goodBootstrap}\nALTER ROLE viberacing_web PASSWORD 'unsafe';`).join("\n"),
  /role password/,
);
assert.match(
  validateBootstrapSql(`${goodBootstrap}\nGRANT viberacing_owner TO viberacing_ingest;`).join("\n"),
  /runtime role/,
);

const goodAssertion = String.raw`DO $assertion$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM viberacing_private.sessions
    WHERE session_id = '00000000-0000-4000-8000-000000000001'
      AND state = 'active'
  ) THEN
    RAISE EXCEPTION 'expected active session is missing';
  END IF;
END
$assertion$;
`;
const assertionPath = "database/tests/example_concurrency_assertions.sql";

assert.deepEqual(validateAssertionSql(assertionPath, goodAssertion), []);
assert.match(
  validateAssertionSql(
    assertionPath,
    goodAssertion.replace("IF NOT EXISTS (\n    SELECT 1", "IF NOT (\n    SELECT state = 'active'"),
  ).join("\n"),
  /missing-row unsafe/,
);
assert.match(
  validateAssertionSql(
    assertionPath,
    goodAssertion.replace(
      "IF NOT EXISTS (\n    SELECT 1",
      "IF /* misleading guard */ NOT (\n    SELECT state = 'active'",
    ),
  ).join("\n"),
  /missing-row unsafe/,
);
assert.match(
  validateAssertionSql(
    assertionPath,
    goodAssertion.replace(
      "IF NOT EXISTS (\n    SELECT 1",
      "IF NOT (\n    -- the row must exist\n    SELECT state = 'active'",
    ),
  ).join("\n"),
  /missing-row unsafe/,
);
assert.deepEqual(
  validateAssertionSql(
    assertionPath,
    goodAssertion.replace(
      "BEGIN",
      "BEGIN\n  -- Example of forbidden text only: IF NOT (SELECT state = 'active')",
    ),
  ),
  [],
);
assert.deepEqual(
  validateAssertionSql(
    assertionPath,
    goodAssertion.replace("BEGIN", "BEGIN\n  RAISE NOTICE 'IF NOT (SELECT is quoted text';"),
  ),
  [],
);
assert.match(
  validateAssertionSql(assertionPath, `${goodAssertion}${"x".repeat(512 * 1024)}`).join("\n"),
  /512 KiB/,
);

console.log("Database checker tests passed (23 cases).");
