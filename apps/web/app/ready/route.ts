import { expectedSchemaVersion, validateRuntimeConfig } from "@/lib/config";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
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
                AND to_regclass('public.weekly_agent_usage') IS NOT NULL AS required_tables`,
      [expectedSchemaVersion],
    );
    const schema = rows[0];
    if (schema === undefined || !schema.expected_version || !schema.required_tables) {
      return Response.json(
        { status: "not_ready", reason: "schema_version" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      { status: "ready", schemaVersion: expectedSchemaVersion },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "not_ready" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
