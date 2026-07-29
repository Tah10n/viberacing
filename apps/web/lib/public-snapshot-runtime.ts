import "server-only";

import { createPublicSnapshotAdmission } from "./public-snapshot-admission";
import { publicSnapshotDatabaseConcurrencyLimit } from "./public-snapshot-database-config";
import {
  createConfiguredPublicSnapshotStore,
  type ConfiguredPublicSnapshotStore,
} from "./public-snapshot-store";

let configuredStore: ConfiguredPublicSnapshotStore | undefined;

export const publicSnapshotAdmission = createPublicSnapshotAdmission(
  publicSnapshotDatabaseConcurrencyLimit,
);

function store(): ConfiguredPublicSnapshotStore {
  configuredStore ??= createConfiguredPublicSnapshotStore();
  return configuredStore;
}

export function readCurrentLeaderboardSnapshot(page: number): Promise<unknown> {
  return store().readCurrentLeaderboard(page);
}

export function readCurrentPublicProfileSnapshot(handle: string): Promise<unknown> {
  return store().readCurrentProfile(handle);
}

export function readSeasonLeaderboardSnapshot(seasonStart: string, page: number): Promise<unknown> {
  return store().readSeasonLeaderboard(seasonStart, page);
}
