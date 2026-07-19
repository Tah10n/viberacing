export const jobsSchedulerPollIntervalMs = 60_000;

const enabledEnvironmentName = "VIBERACING_JOBS_SCHEDULER_ENABLED";

export type JobsSchedulerConfigurationErrorCode = "disabled";

export class JobsSchedulerConfigurationError extends Error {
  readonly code: JobsSchedulerConfigurationErrorCode;

  constructor(code: JobsSchedulerConfigurationErrorCode) {
    super("Jobs scheduler configuration failed closed.");
    this.name = "JobsSchedulerConfigurationError";
    this.code = code;
  }
}

export interface JobsSchedulerConfig {
  readonly enabled: true;
  readonly pollIntervalMs: typeof jobsSchedulerPollIntervalMs;
}

export function resolveJobsSchedulerConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): JobsSchedulerConfig {
  try {
    if (environment[enabledEnvironmentName] !== "true") {
      throw new JobsSchedulerConfigurationError("disabled");
    }
  } catch (error) {
    if (error instanceof JobsSchedulerConfigurationError) {
      throw error;
    }
    throw new JobsSchedulerConfigurationError("disabled");
  }

  return Object.freeze({ enabled: true, pollIntervalMs: jobsSchedulerPollIntervalMs });
}
