import "server-only";

import {
  validateLeaderboardSnapshotV1,
  validatePublicProfileSummaryV1,
  type LeaderboardSnapshotV1,
  type PublicProfileSummaryV1,
} from "@viberacing/contracts";

import type { PublicSnapshotAdmission } from "./public-snapshot-admission";
import { resolvePublicSnapshotConfig } from "./public-snapshot-config";
import {
  publicSnapshotAdmission,
  readCurrentLeaderboardSnapshot,
  readCurrentPublicProfileSnapshot,
} from "./public-snapshot-runtime";
import { PublicSnapshotStoreError } from "./public-snapshot-store";
import type { PublicHomePayload, PublicProfileState } from "./race-types";

interface PublicHomeSnapshotDependencies {
  readonly admission: PublicSnapshotAdmission;
  readonly enabled: unknown;
  readonly readCurrentLeaderboard: (page: number) => Promise<unknown>;
  readonly readCurrentProfile: (handle: string) => Promise<unknown>;
}

const publicHomeConfig = resolvePublicSnapshotConfig();

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function canonicalPayload(value: unknown): string | undefined {
  try {
    if (!isPlainRecord(value)) {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, "canonicalPayload");
    return descriptor !== undefined &&
      "value" in descriptor &&
      descriptor.enumerable &&
      typeof descriptor.value === "string"
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function parseLeaderboard(
  record: unknown,
  expectedSeasonStart: string,
): LeaderboardSnapshotV1 | undefined {
  try {
    const payload = canonicalPayload(record);
    if (payload === undefined) {
      return undefined;
    }
    const validation = validateLeaderboardSnapshotV1(JSON.parse(payload) as unknown);
    return validation.ok &&
      validation.value.page === 1 &&
      validation.value.seasonStart === expectedSeasonStart
      ? validation.value
      : undefined;
  } catch {
    return undefined;
  }
}

function parseProfile(
  record: unknown,
  expectedHandle: string,
  leaderboard: LeaderboardSnapshotV1,
): PublicProfileSummaryV1 | undefined {
  try {
    const payload = canonicalPayload(record);
    if (payload === undefined) {
      return undefined;
    }
    const validation = validatePublicProfileSummaryV1(JSON.parse(payload) as unknown);
    return validation.ok &&
      validation.value.handle === expectedHandle &&
      validation.value.season.seasonStart === leaderboard.seasonStart &&
      validation.value.season.seasonEnd === leaderboard.seasonEnd &&
      validation.value.season.seasonState === leaderboard.seasonState
      ? validation.value
      : undefined;
  } catch {
    return undefined;
  }
}

function profileFailureState(error: unknown): PublicProfileState {
  return error instanceof PublicSnapshotStoreError && error.code === "not_found"
    ? "not-found"
    : "unavailable";
}

export async function loadPublicHomeSnapshot(
  expectedSeasonStart: string,
  requestedProfileHandle: string | undefined,
  dependencies: PublicHomeSnapshotDependencies,
): Promise<PublicHomePayload | undefined> {
  if (dependencies.enabled !== true) {
    return undefined;
  }
  const lease = dependencies.admission.tryAcquire();
  if (lease === undefined) {
    return undefined;
  }
  try {
    const leaderboard = parseLeaderboard(
      await dependencies.readCurrentLeaderboard(1),
      expectedSeasonStart,
    );
    if (leaderboard === undefined) {
      return undefined;
    }
    if (requestedProfileHandle === undefined) {
      return Object.freeze({
        leaderboard,
        profile: null,
        profileState: "none",
        source: "community",
      });
    }
    let profile: PublicProfileSummaryV1 | null = null;
    let profileState: PublicProfileState = "unavailable";
    try {
      profile =
        parseProfile(
          await dependencies.readCurrentProfile(requestedProfileHandle),
          requestedProfileHandle,
          leaderboard,
        ) ?? null;
      profileState = profile === null ? "unavailable" : "ready";
    } catch (error) {
      profileState = profileFailureState(error);
    }
    return Object.freeze({
      leaderboard,
      profile,
      profileState,
      source: "community",
    });
  } catch {
    return undefined;
  } finally {
    lease.release();
  }
}

export function loadConfiguredPublicHomeSnapshot(
  expectedSeasonStart: string,
  requestedProfileHandle?: string,
): Promise<PublicHomePayload | undefined> {
  return loadPublicHomeSnapshot(
    expectedSeasonStart,
    requestedProfileHandle,
    Object.freeze({
      admission: publicSnapshotAdmission,
      enabled: publicHomeConfig.enabled,
      readCurrentLeaderboard: readCurrentLeaderboardSnapshot,
      readCurrentProfile: readCurrentPublicProfileSnapshot,
    }),
  );
}
