import "server-only";

import process from "node:process";

const publicSnapshotsEnabledName = "VIBERACING_PUBLIC_SNAPSHOTS_ENABLED";

export interface PublicSnapshotConfig {
  readonly enabled: boolean;
}

function readEnvironmentValue(environment: unknown): string | undefined {
  try {
    if (environment === null || typeof environment !== "object") {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(environment, publicSnapshotsEnabledName);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable ||
      typeof descriptor.value !== "string"
    ) {
      return undefined;
    }
    return descriptor.value;
  } catch {
    return undefined;
  }
}

export function resolvePublicSnapshotConfig(
  environment: unknown = process.env,
): PublicSnapshotConfig {
  return Object.freeze({ enabled: readEnvironmentValue(environment) === "true" });
}
