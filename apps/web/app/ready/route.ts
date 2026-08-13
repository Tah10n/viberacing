import { expectedSchemaVersion, validateRuntimeConfig } from "@/lib/config";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    validateRuntimeConfig();
    const rows = await query<{
      migration_count: number;
      exact_version: boolean;
      required_tables: boolean;
    }>(
      `SELECT count(*)::int AS migration_count,
              coalesce(bool_and(version = $1), false) AS exact_version,
              to_regclass('public.installation_sources') IS NOT NULL
                AND to_regclass('public.daily_usage') IS NOT NULL
                AND to_regclass('public.weekly_agent_usage') IS NOT NULL AS required_tables
         FROM schema_migrations`,
      [expectedSchemaVersion],
    );
    const schema = rows[0];
    if (
      schema === undefined ||
      schema.migration_count !== 1 ||
      !schema.exact_version ||
      !schema.required_tables
    ) {
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
