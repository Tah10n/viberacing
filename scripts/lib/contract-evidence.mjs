export const implementedContractEvidence = new Map([
  [
    "getSeasonLeaderboardV1",
    [
      [
        "apps/web/app/v1/leaderboards/[seasonStart]/route.ts",
        ["createSeasonLeaderboardRoute", "resolvePublicSnapshotConfig"],
      ],
      [
        "apps/web/lib/public-snapshot-store.ts",
        ["read_season_leaderboard_page", "validateLeaderboardSnapshotV1"],
      ],
      [
        "database/migrations/0005_seasons_ranking_and_snapshots.sql",
        ["CREATE FUNCTION viberacing_api.read_season_leaderboard_page"],
      ],
      [
        "scripts/test-web-postgres-integration.mjs",
        ["public, max-age=3600, s-maxage=31536000, immutable"],
      ],
    ],
  ],
  [
    "getCurrentLeaderboardV1",
    [
      [
        "apps/web/app/v1/leaderboards/current/route.ts",
        ["createCurrentLeaderboardRoute", "resolvePublicSnapshotConfig"],
      ],
      [
        "apps/web/lib/public-snapshot-store.ts",
        ["read_current_leaderboard_page", "validateLeaderboardSnapshotV1"],
      ],
      [
        "database/migrations/0005_seasons_ranking_and_snapshots.sql",
        ["CREATE FUNCTION viberacing_api.read_current_leaderboard_page"],
      ],
      [
        "scripts/test-web-postgres-integration.mjs",
        ["10,001 profiles", "assertPublicSnapshotPlanEvidence"],
      ],
    ],
  ],
  [
    "getCurrentPublicProfileV1",
    [
      [
        "apps/web/app/v1/profiles/[handle]/route.ts",
        ["createPublicProfileRoute", "resolvePublicSnapshotConfig"],
      ],
      [
        "apps/web/lib/public-snapshot-store.ts",
        ["read_current_public_profile", "validatePublicProfileSummaryV1"],
      ],
      [
        "database/migrations/0005_seasons_ranking_and_snapshots.sql",
        ["CREATE FUNCTION viberacing_api.read_current_public_profile"],
      ],
      [
        "scripts/test-web-postgres-integration.mjs",
        ["outsideTop32Handle", "hiddenProfileSummaryCount"],
      ],
    ],
  ],
  [
    "postUsageSyncV1",
    [
      ["apps/edge/src/worker.mjs", ["/v1/usage", "VIBERACING_USAGE_GLOBAL_BURST"]],
      ["apps/ingest/src/protocol.ts", ["/v1/usage"]],
      ["apps/ingest/src/database-pool.ts", ["viberacing_api.submit_usage_sync"]],
      [
        "database/migrations/0004_usage_ingest_replay_and_idempotency.sql",
        [
          "CREATE FUNCTION viberacing_api.submit_usage_sync",
          "read_usage_device_verification_material",
        ],
      ],
      ["database/tests/usage_accounting.sql", ["viberacing_api.submit_usage_sync"]],
    ],
  ],
]);

export const implementedContractEvidencePaths = Object.freeze([
  ...new Set(
    [...implementedContractEvidence.values()].flatMap((entries) =>
      entries.map(([relativePath]) => relativePath),
    ),
  ),
]);
