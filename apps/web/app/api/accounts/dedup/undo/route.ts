import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/config";
import { transaction } from "@/lib/db";
import { isUuid, problem, readBoundedForm, sameOrigin } from "@/lib/http";
import { withRequestLogging } from "@/lib/request-log";
import { viewer } from "@/lib/session";
import { rebuildAgentDailySummaries } from "@/lib/usage-summary";

interface DedupEventRow {
  source_id: string;
  previous_account_id: string;
  target_account_id: string;
  agent_id: string;
  current_account_id: string;
  merged_into_account_id: string | null;
}

async function post(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const current = await viewer();
  if (current === null) return problem(401, "unauthorized");
  try {
    const form = await readBoundedForm(request);
    const eventId = form.get("eventId");
    if (!isUuid(eventId)) return problem(400, "invalid_request");
    const outcome = await transaction(async (client) => {
      await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [current.id]);
      const events = await client.query<DedupEventRow>(
        `SELECT event.source_id::text,
                event.previous_account_id::text,
                event.target_account_id::text,
                event.agent_id,
                source.agent_account_id::text AS current_account_id,
                previous.merged_into_account_id::text
           FROM account_dedup_events event
           JOIN installation_sources source ON source.id = event.source_id
           JOIN agent_accounts previous ON previous.id = event.previous_account_id
          WHERE event.id = $1 AND event.user_id = $2 AND event.status = 'active'
          FOR UPDATE OF event, source, previous`,
        [eventId, current.id],
      );
      const event = events.rows[0];
      if (event === undefined) return "missing";
      if (
        event.current_account_id !== event.target_account_id ||
        event.merged_into_account_id !== event.target_account_id
      ) {
        await client.query(
          `UPDATE account_dedup_events
              SET status = 'superseded', updated_at = now()
            WHERE id = $1`,
          [eventId],
        );
        return "superseded";
      }
      await client.query(
        `UPDATE installation_sources
            SET agent_account_id = $2, updated_at = now()
          WHERE id = $1`,
        [event.source_id, event.previous_account_id],
      );
      await client.query(
        `UPDATE agent_accounts
            SET merged_into_account_id = NULL, updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [event.previous_account_id, current.id],
      );
      await client.query(
        `UPDATE account_dedup_events
            SET status = 'undone', undone_at = now(), updated_at = now()
          WHERE id = $1`,
        [eventId],
      );
      await rebuildAgentDailySummaries(client, current.id, event.agent_id);
      return "undone";
    });
    if (outcome === "missing") return problem(404, "dedup_event_not_found");
    if (outcome === "superseded") return problem(409, "dedup_event_superseded");
    return NextResponse.redirect(new URL("/dashboard?dedupUndone=1", publicOrigin()), 303);
  } catch (error) {
    if (error instanceof RangeError) return problem(413, "body_too_large");
    return error instanceof SyntaxError
      ? problem(400, "invalid_request")
      : problem(500, "server_error", error);
  }
}

export const POST = withRequestLogging("/api/accounts/dedup/undo", post);
