import {
  createConfiguredJobsMaintenanceRunner,
  maximumCleanupBatchSize,
  maximumProfileDeletionPurgeBatchSize,
  type ConfiguredJobsMaintenanceRunner,
  type JobsMaintenanceJob,
} from "./maintenance.js";

const completedMessage = "Vibe Racing Jobs command completed.\n";
const failedMessage = "Vibe Racing Jobs command failed.\n";

export type JobsCommandErrorCode = "invalid_arguments";

export class JobsCommandError extends Error {
  readonly code: JobsCommandErrorCode;

  constructor(code: JobsCommandErrorCode) {
    super("Jobs command arguments are invalid.");
    this.name = "JobsCommandError";
    this.code = code;
  }
}

type Environment = Readonly<Record<string, string | undefined>>;
type OutputWriter = (message: string) => void;
type RunnerFactory = (environment: Environment) => ConfiguredJobsMaintenanceRunner;

export interface JobsCliDependencies {
  readonly environment?: Environment;
  readonly runnerFactory?: RunnerFactory;
  readonly stderr?: OutputWriter;
  readonly stdout?: OutputWriter;
}

function fail(): never {
  throw new JobsCommandError("invalid_arguments");
}

function readSingleArgument(value: unknown): string {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length !== 1 ||
      Reflect.ownKeys(value).length !== 2
    ) {
      fail();
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, "0");
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable ||
      typeof descriptor.value !== "string"
    ) {
      fail();
    }
    return descriptor.value;
  } catch (error) {
    if (error instanceof JobsCommandError) {
      throw error;
    }
    fail();
  }
}

export function parseJobsCommand(value: unknown): JobsMaintenanceJob {
  const command = readSingleArgument(value);
  switch (command) {
    case "ensure-current-season":
      return Object.freeze({ kind: "ensure_current_season" });
    case "refresh-dirty-leaderboard":
      return Object.freeze({ kind: "refresh_dirty_leaderboard" });
    case "finalize-due-season":
      return Object.freeze({ kind: "finalize_due_season" });
    case "reset-expired-pairing-request-windows":
      return Object.freeze({ kind: "reset_expired_pairing_request_windows" });
    case "cleanup-expired-pairing-state":
      return Object.freeze({
        batchSize: maximumCleanupBatchSize,
        kind: "cleanup_expired_pairing_state",
      });
    case "cleanup-expired-usage-nonces":
      return Object.freeze({
        batchSize: maximumCleanupBatchSize,
        kind: "cleanup_expired_usage_nonces",
      });
    case "cleanup-expired-usage-history":
      return Object.freeze({
        batchSize: maximumCleanupBatchSize,
        kind: "cleanup_expired_usage_history",
      });
    case "cleanup-expired-auth-state":
      return Object.freeze({
        batchSize: maximumCleanupBatchSize,
        kind: "cleanup_expired_auth_state",
      });
    case "cleanup-aged-revoked-authority":
      return Object.freeze({
        batchSize: maximumCleanupBatchSize,
        kind: "cleanup_aged_revoked_authority",
      });
    case "cleanup-snapshot-history":
      return Object.freeze({
        batchSize: maximumCleanupBatchSize,
        kind: "cleanup_snapshot_history",
      });
    case "cleanup-expired-audit-events":
      return Object.freeze({
        batchSize: maximumCleanupBatchSize,
        kind: "cleanup_expired_audit_events",
      });
    case "purge-profile-deletions":
      return Object.freeze({
        batchSize: maximumProfileDeletionPurgeBatchSize,
        kind: "purge_profile_deletions",
      });
    case "cleanup-terminal-deletion-jobs":
      return Object.freeze({
        batchSize: maximumCleanupBatchSize,
        kind: "cleanup_terminal_deletion_jobs",
      });
    default:
      fail();
  }
}

function writeSafely(writer: OutputWriter, message: string): boolean {
  try {
    writer(message);
    return true;
  } catch {
    return false;
  }
}

function defaultStdout(message: string): void {
  process.stdout.write(message);
}

function defaultStderr(message: string): void {
  process.stderr.write(message);
}

export async function runJobsCli(
  argumentsValue: unknown,
  dependencies: JobsCliDependencies = {},
): Promise<0 | 1> {
  const stderr = dependencies.stderr ?? defaultStderr;
  let job: JobsMaintenanceJob;
  try {
    job = parseJobsCommand(argumentsValue);
  } catch {
    writeSafely(stderr, failedMessage);
    return 1;
  }

  let runner: ConfiguredJobsMaintenanceRunner;
  try {
    const runnerFactory = dependencies.runnerFactory ?? createConfiguredJobsMaintenanceRunner;
    runner = runnerFactory(dependencies.environment ?? process.env);
  } catch {
    writeSafely(stderr, failedMessage);
    return 1;
  }

  let succeeded = true;
  try {
    await runner.execute(job);
  } catch {
    succeeded = false;
  }
  try {
    await runner.close();
  } catch {
    succeeded = false;
  }

  if (!succeeded) {
    writeSafely(stderr, failedMessage);
    return 1;
  }
  const stdout = dependencies.stdout ?? defaultStdout;
  if (!writeSafely(stdout, completedMessage)) {
    writeSafely(stderr, failedMessage);
    return 1;
  }
  return 0;
}
