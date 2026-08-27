import { expectedSchemaVersion, validateRuntimeConfig } from "@/lib/config";
import { query } from "@/lib/db";
import { markResponse } from "@/lib/http";
import { withRequestLogging } from "@/lib/request-log";

export const dynamic = "force-dynamic";

async function get(): Promise<Response> {
  try {
    validateRuntimeConfig();
    const rows = await query<{
      expected_version: boolean;
      required_tables: boolean;
    }>(
      `SELECT EXISTS (
                SELECT 1
                  FROM schema_migrations
                 WHERE version = $1
              ) AS expected_version,
              to_regclass('public.installation_sources') IS NOT NULL
                AND to_regclass('public.daily_usage') IS NOT NULL
                AND to_regclass('public.weekly_agent_usage') IS NOT NULL
                AND to_regclass('public.account_dedup_events') IS NOT NULL
                AND to_regclass('public.browser_sync_runs') IS NOT NULL
                AND to_regclass('public.browser_sync_grants') IS NOT NULL
                AND EXISTS (
                  SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public'
                     AND table_name = 'installations'
                     AND column_name = 'browser_sync_protocol'
                )
                AND EXISTS (
                  SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public'
                     AND table_name = 'account_dedup_events'
                     AND column_name = 'dismissed_at'
                ) AS required_tables`,
      [expectedSchemaVersion],
    );
    const schema = rows[0];
    if (schema === undefined || !schema.expected_version || !schema.required_tables) {
      return markResponse(
        Response.json(
          { status: "not_ready", reason: "schema_version" },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        ),
        "schema_version",
      );
    }
    return Response.json(
      { status: "ready", schemaVersion: expectedSchemaVersion },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return markResponse(
      Response.json(
        { status: "not_ready" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      ),
      "readiness_check_failed",
      error,
    );
  }
}

export const GET = withRequestLogging("/ready", get, { successLevel: "debug" });
