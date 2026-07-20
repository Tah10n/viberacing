import { resolveMigrationDatabaseConfig } from "./database-config.js";
import { createMigrationDatabasePool } from "./database-pool.js";
import { migrationsAreEnabled } from "./enablement.js";
import {
  loadReviewedMigrationCatalog,
  type ReviewedMigrationCatalog,
} from "./migration-catalog.js";
import { runReviewedMigrations } from "./migration-runner.js";

const disabledMessage = "Vibe Racing migrations are disabled.\n";
const failureMessage = "Vibe Racing migrations failed.\n";
const successMessage = "Vibe Racing migrations completed.\n";

type Environment = Readonly<Record<string, string | undefined>>;
type WriteText = (text: string) => void;

export interface MigrationCommandDependencies {
  readonly createPool: typeof createMigrationDatabasePool;
  readonly environment: Environment;
  readonly loadCatalog: () => ReviewedMigrationCatalog;
  readonly resolveConfig: typeof resolveMigrationDatabaseConfig;
  readonly runMigrations: typeof runReviewedMigrations;
  readonly writeError: WriteText;
  readonly writeOutput: WriteText;
}

export function createDefaultMigrationCommandDependencies(): MigrationCommandDependencies {
  return Object.freeze({
    createPool: createMigrationDatabasePool,
    environment: process.env,
    loadCatalog: loadReviewedMigrationCatalog,
    resolveConfig: resolveMigrationDatabaseConfig,
    runMigrations: runReviewedMigrations,
    writeError(text: string): void {
      process.stderr.write(text);
    },
    writeOutput(text: string): void {
      process.stdout.write(text);
    },
  });
}

function writeFailure(writeError: WriteText, message: string): void {
  try {
    writeError(message);
  } catch {
    // The nonzero result remains authoritative if the output stream is unavailable.
  }
}

export async function runMigrationCommand(
  arguments_: readonly string[],
  dependencies: MigrationCommandDependencies = createDefaultMigrationCommandDependencies(),
): Promise<number> {
  if (!migrationsAreEnabled(dependencies.environment)) {
    writeFailure(dependencies.writeError, disabledMessage);
    return 1;
  }
  if (arguments_.length !== 0) {
    writeFailure(dependencies.writeError, failureMessage);
    return 1;
  }

  try {
    const catalog = dependencies.loadCatalog();
    const config = dependencies.resolveConfig(dependencies.environment);
    const pool = dependencies.createPool(config);
    await dependencies.runMigrations(catalog, pool);
    dependencies.writeOutput(successMessage);
    return 0;
  } catch {
    writeFailure(dependencies.writeError, failureMessage);
    return 1;
  }
}
