import { digest } from "@/lib/crypto";
import { query } from "@/lib/db";
import { annotateResponse, isRecord, isUuid, problem, readBoundedJson } from "@/lib/http";
import { logInfo, logWarn } from "@/lib/log";
import {
  clientAddress,
  clientAdmissionLimit,
  consumeAdmissionRateLimit,
  consumeRateLimit,
} from "@/lib/rate-limit";
import { withRequestLogging } from "@/lib/request-log";

const maximumEvents = 32;
const maximumBodyBytes = 16_384;
const connectorVersionPattern = /^\d+\.\d+\.\d+$/;
const states = new Set(["opened", "resolved"]);
export const diagnosticCodesByPhase = {
  collect: new Set([
    "collector_failed",
    "agent_executable_missing",
    "agent_api_timeout",
    "agent_api_invalid_response",
    "local_store_unreadable",
    "local_store_scan_limit",
    "local_store_schema_unsupported",
    "codex_rollout_read_failed",
    "codex_rollout_metadata_invalid",
    "codex_lineage_ambiguous",
    "codex_lineage_parent_missing",
    "codex_components_incomplete",
    "provider_account_identity_unavailable",
    "provider_account_changed_during_collection",
    "provider_account_registration_pending",
    "provider_account_limit_reached",
    "opencode_cutover_required",
    "local_event_identity_conflict",
  ]),
  sync: new Set(["automatic_sync_failed"]),
  deliver: new Set(["pending_payload_rejected"]),
} as const;

interface DiagnosticBody {
  schemaVersion?: unknown;
  connectorVersion?: unknown;
  events?: unknown;
}

interface DiagnosticEventInput {
  sourceId?: unknown;
  code?: unknown;
  state?: unknown;
  phase?: unknown;
}

interface ParsedDiagnosticEvent {
  sourceId: string;
  code: string;
  state: "opened" | "resolved";
  phase: keyof typeof diagnosticCodesByPhase;
}

interface InstallationRow {
  id: string;
  user_id: string;
}

interface SourceRow {
  id: string;
  agent_id: string;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

function bearer(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7);
  return token.length >= 32 && token.length <= 128 ? token : null;
}

function rateLimited(): Response {
  return Response.json(
    { error: "rate_limited" },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
  );
}

export function parseDiagnosticBody(value: unknown): {
  connectorVersion: string;
  events: ParsedDiagnosticEvent[];
} | null {
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "connectorVersion", "events"])) {
    return null;
  }
  const body = value as DiagnosticBody;
  if (
    body.schemaVersion !== 1 ||
    typeof body.connectorVersion !== "string" ||
    body.connectorVersion.length > 40 ||
    !connectorVersionPattern.test(body.connectorVersion) ||
    !Array.isArray(body.events) ||
    body.events.length < 1 ||
    body.events.length > maximumEvents
  ) {
    return null;
  }
  const tuples = new Set<string>();
  const events: ParsedDiagnosticEvent[] = [];
  for (const raw of body.events) {
    if (!isRecord(raw) || !exactKeys(raw, ["sourceId", "code", "state", "phase"])) return null;
    const event = raw as DiagnosticEventInput;
    if (
      !isUuid(event.sourceId) ||
      typeof event.code !== "string" ||
      typeof event.state !== "string" ||
      !states.has(event.state) ||
      typeof event.phase !== "string" ||
      !Object.hasOwn(diagnosticCodesByPhase, event.phase) ||
      !diagnosticCodesByPhase[event.phase as keyof typeof diagnosticCodesByPhase].has(event.code)
    ) {
      return null;
    }
    const tuple = `${event.sourceId}\0${event.code}\0${event.state}\0${event.phase}`;
    if (tuples.has(tuple)) return null;
    tuples.add(tuple);
    events.push({
      sourceId: event.sourceId,
      code: event.code,
      state: event.state as ParsedDiagnosticEvent["state"],
      phase: event.phase as ParsedDiagnosticEvent["phase"],
    });
  }
  return { connectorVersion: body.connectorVersion, events };
}

async function post(request: Request): Promise<Response> {
  const token = bearer(request);
  if (token === null) return problem(401, "unauthorized");
  try {
    const address = clientAddress(request);
    if (
      !(
        await consumeAdmissionRateLimit(
          "diagnostics_pre_auth",
          address.key,
          clientAdmissionLimit(address, 120, 10_000, 20),
          10_000,
          60,
        )
      ).allowed
    ) {
      return rateLimited();
    }
    const installations = await query<InstallationRow>(
      `SELECT id::text, user_id::text FROM installations
        WHERE device_token_hash = $1 AND status = 'active' LIMIT 1`,
      [digest(token)],
    );
    const installation = installations[0];
    if (installation === undefined)
      return annotateResponse(problem(401, "unauthorized"), {}, "warn");
    if (!(await consumeRateLimit("diagnostics_installation", installation.id, 30, 60))) {
      return rateLimited();
    }
    if (!(await consumeRateLimit("diagnostics_user", installation.user_id, 120, 60))) {
      return rateLimited();
    }
    if (!(await consumeRateLimit("diagnostics_global", "all", 10_000, 60))) {
      return rateLimited();
    }
    const parsed = parseDiagnosticBody(await readBoundedJson(request, maximumBodyBytes));
    if (parsed === null) return problem(400, "invalid_request");
    const sourceIds = [...new Set(parsed.events.map((event) => event.sourceId))];
    const sources = await query<SourceRow>(
      `SELECT id::text, agent_id
         FROM installation_sources
        WHERE installation_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
      [installation.id, sourceIds],
    );
    if (sources.length !== sourceIds.length) return problem(400, "unsupported_source");
    const agentBySource = new Map(sources.map((source) => [source.id, source.agent_id]));
    if (sourceIds.some((sourceId) => !agentBySource.has(sourceId))) {
      return problem(400, "unsupported_source");
    }
    for (const event of parsed.events) {
      const fields = {
        agentId: agentBySource.get(event.sourceId) ?? "unknown",
        diagnosticCode: event.code,
        diagnosticState: event.state,
        diagnosticPhase: event.phase,
        connectorVersion: parsed.connectorVersion,
      };
      if (event.state === "opened") logWarn("connector_diagnostic", fields);
      else logInfo("connector_diagnostic", fields);
    }
    const opened = parsed.events.filter((event) => event.state === "opened").length;
    return annotateResponse(
      Response.json(
        { acceptedEvents: parsed.events.length },
        { headers: { "Cache-Control": "no-store" } },
      ),
      {
        diagnosticEventsReceived: parsed.events.length,
        diagnosticsOpened: opened,
        diagnosticsResolved: parsed.events.length - opened,
      },
    );
  } catch (error) {
    return error instanceof SyntaxError || error instanceof RangeError
      ? problem(400, "invalid_request")
      : problem(500, "server_error", error);
  }
}

export const POST = withRequestLogging("/api/installations/current/diagnostics", post);
