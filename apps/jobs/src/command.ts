import {
  createConfiguredCommunityMaintenanceRunner,
  maximumCleanupBatchSize,
  maximumProfileDeletionPurgeBatchSize,
  type CommunityMaintenanceJob,
  type ConfiguredCommunityMaintenanceRunner,
} from "./community-maintenance.js";

const completedMessage = "Vibe Racing Jobs command completed.\n";
const failedMessage = "Vibe Racing Jobs command failed.\n";
const minimumSeasonStart = "1999-12-27";
const maximumSeasonStart = "2099-12-28";

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
type RunnerFactory = (environment: Environment) => ConfiguredCommunityMaintenanceRunner;

export interface JobsCliDependencies {
  readonly environment?: Environment;
  readonly runnerFactory?: RunnerFactory;
  readonly stderr?: OutputWriter;
  readonly stdout?: OutputWriter;
}

function fail(): never {
  throw new JobsCommandError("invalid_arguments");
}

function readArgumentArray(value: unknown): readonly string[] {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > 2
    ) {
      fail();
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== value.length + 1 ||
      keys.some(
        (key) =>
          key !== "length" &&
          (typeof key !== "string" ||
            !/^(?:0|[1-9][0-9]*)$/.test(key) ||
            Number(key) >= value.length),
      )
    ) {
      fail();
    }
    const result: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        typeof descriptor.value !== "string"
      ) {
        fail();
      }
      result.push(descriptor.value);
    }
    return Object.freeze(result);
  } catch (error) {
    if (error instanceof JobsCommandError) {
      throw error;
    }
    fail();
  }
}

function validSeasonStart(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < minimumSeasonStart ||
    value > maximumSeasonStart
  ) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCDay() === 1
  );
}

export function parseJobsCommand(value: unknown): CommunityMaintenanceJob {
  const argumentsValue = readArgumentArray(value);
  if (
    argumentsValue.length === 1 &&
    argumentsValue[0] === "reset-expired-pairing-request-windows"
  ) {
    return Object.freeze({ kind: "reset_expired_pairing_request_windows" });
  }
  if (argumentsValue.length === 1 && argumentsValue[0] === "finalize-community-backlog") {
    return Object.freeze({ kind: "finalize_community_season_backlog" });
  }
  if (argumentsValue.length === 1 && argumentsValue[0] === "cleanup-abandoned-enrollments") {
    return Object.freeze({
      batchSize: maximumCleanupBatchSize,
      kind: "cleanup_abandoned_enrollments",
    });
  }
  if (argumentsValue.length === 1 && argumentsValue[0] === "cleanup-expired-ingest-state") {
    return Object.freeze({
      batchSize: maximumCleanupBatchSize,
      kind: "cleanup_expired_ingest_state",
    });
  }
  if (argumentsValue.length === 1 && argumentsValue[0] === "cleanup-finalized-source-day-values") {
    return Object.freeze({
      batchSize: maximumCleanupBatchSize,
      kind: "cleanup_finalized_source_day_values",
    });
  }
  if (argumentsValue.length === 1 && argumentsValue[0] === "cleanup-expired-auth-state") {
    return Object.freeze({
      batchSize: maximumCleanupBatchSize,
      kind: "cleanup_expired_auth_state",
    });
  }
  if (argumentsValue.length === 1 && argumentsValue[0] === "cleanup-expired-audit-events") {
    return Object.freeze({
      batchSize: maximumCleanupBatchSize,
      kind: "cleanup_expired_audit_events",
    });
  }
  if (argumentsValue.length === 1 && argumentsValue[0] === "cleanup-expired-car-recipe-proposals") {
    return Object.freeze({
      batchSize: maximumCleanupBatchSize,
      kind: "cleanup_expired_car_recipe_proposals",
    });
  }
  if (argumentsValue.length === 1 && argumentsValue[0] === "cleanup-expired-invites") {
    return Object.freeze({
      batchSize: maximumCleanupBatchSize,
      kind: "cleanup_expired_invites",
    });
  }
  if (argumentsValue.length === 1 && argumentsValue[0] === "cleanup-aged-revoked-passkeys") {
    return Object.freeze({
      batchSize: maximumCleanupBatchSize,
      kind: "cleanup_aged_revoked_passkeys",
    });
  }
  if (argumentsValue.length === 1 && argumentsValue[0] === "cleanup-aged-revoked-devices") {
    return Object.freeze({
      batchSize: maximumCleanupBatchSize,
      kind: "cleanup_aged_revoked_devices",
    });
  }
  if (argumentsValue.length === 1 && argumentsValue[0] === "cleanup-expired-pairing-state") {
    return Object.freeze({
      batchSize: maximumCleanupBatchSize,
      kind: "cleanup_expired_pairing_state",
    });
  }
  if (argumentsValue.length === 1 && argumentsValue[0] === "cleanup-expired-sessions") {
    return Object.freeze({
      batchSize: maximumCleanupBatchSize,
      kind: "cleanup_expired_sessions",
    });
  }
  if (argumentsValue.length === 1 && argumentsValue[0] === "cleanup-terminal-deletion-jobs") {
    return Object.freeze({
      batchSize: maximumCleanupBatchSize,
      kind: "cleanup_terminal_deletion_jobs",
    });
  }
  if (argumentsValue.length === 1 && argumentsValue[0] === "purge-profile-deletions") {
    return Object.freeze({
      batchSize: maximumProfileDeletionPurgeBatchSize,
      kind: "purge_profile_deletions",
    });
  }
  if (
    argumentsValue.length === 1 &&
    argumentsValue[0] === "redact-aged-pairing-approval-provenance"
  ) {
    return Object.freeze({
      batchSize: maximumCleanupBatchSize,
      kind: "redact_aged_pairing_approval_provenance",
    });
  }
  if (argumentsValue.length !== 2) {
    fail();
  }
  const seasonStart = argumentsValue[1];
  if (!validSeasonStart(seasonStart)) {
    fail();
  }
  if (argumentsValue[0] === "refresh-community-season") {
    return Object.freeze({ kind: "refresh_community_season", seasonStart });
  }
  if (argumentsValue[0] === "finalize-community-season") {
    return Object.freeze({ kind: "finalize_community_season", seasonStart });
  }
  fail();
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
  let job: CommunityMaintenanceJob;
  try {
    job = parseJobsCommand(argumentsValue);
  } catch {
    writeSafely(stderr, failedMessage);
    return 1;
  }

  let runner: ConfiguredCommunityMaintenanceRunner;
  try {
    const runnerFactory = dependencies.runnerFactory ?? createConfiguredCommunityMaintenanceRunner;
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
