import { connectorProtocolVersion, maximumDailyTokens } from "@/lib/config";
import { agentRegistry, isSupportedAgent } from "@/lib/agents";
import { digest } from "@/lib/crypto";
import { query, transaction } from "@/lib/db";
import { currentWeekStart } from "@/lib/leaderboard";
import { annotateResponse, isRecord, isUuid, problem, readBoundedJson } from "@/lib/http";
import { clientAddress, consumeRateLimit } from "@/lib/rate-limit";
import { refreshAgentWeek } from "@/lib/usage-summary";
import { withRequestLogging } from "@/lib/request-log";

interface UsageBody {
  protocolVersion?: unknown;
  snapshots?: unknown;
  sourceErrors?: unknown;
}

interface SnapshotInput {
  sourceId?: unknown;
  syncSequence?: unknown;
  rangeStart?: unknown;
  rangeEnd?: unknown;
  completeness?: unknown;
  entries?: unknown;
}

interface EntryInput {
  date?: unknown;
  totalTokens?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  cacheReadTokens?: unknown;
  cacheWriteTokens?: unknown;
  reasoningTokens?: unknown;
}

interface SourceErrorInput {
  sourceId?: unknown;
  code?: unknown;
}

interface InstallationRow {
  id: string;
  user_id: string;
}

interface SourceRow {
  id: string;
  user_id: string;
  agent_id: string;
  last_accepted_sync_sequence: string;
}

interface ParsedEntry {
  date: string;
  totalTokens: string;
  inputTokens: string | null;
  outputTokens: string | null;
  cacheReadTokens: string | null;
  cacheWriteTokens: string | null;
  reasoningTokens: string | null;
}

interface ParsedSnapshot {
  sourceId: string;
  syncSequence: string;
  rangeStart: string;
  rangeEnd: string;
  completeness: "complete" | "partial";
  entries: ParsedEntry[];
}

interface ParsedSourceError {
  sourceId: string;
  code: "collector_failed";
}

class UsageError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const tokenPattern = /^(?:0|[1-9]\d{0,29})$/;
const sequencePattern = /^[1-9]\d{0,29}$/;
const bodyKeys = new Set(["protocolVersion", "snapshots", "sourceErrors"]);
const snapshotKeys = new Set([
  "sourceId",
  "syncSequence",
  "rangeStart",
  "rangeEnd",
  "completeness",
  "entries",
]);
const entryKeys = new Set([
  "date",
  "totalTokens",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
]);
const sourceErrorKeys = new Set(["sourceId", "code"]);

function onlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function utcDate(value: unknown): Date | null {
  if (typeof value !== "string" || !datePattern.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function optionalToken(value: unknown): string | null | undefined {
  if (value === undefined) return null;
  return typeof value === "string" && tokenPattern.test(value) ? value : undefined;
}

export function parseSnapshots(value: unknown): ParsedSnapshot[] {
  if (!Array.isArray(value) || value.length > 32) {
    throw new UsageError(400, "invalid_snapshots");
  }
  const maximum = maximumDailyTokens();
  const today = new Date();
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const earliest = new Date(todayUtc);
  earliest.setUTCDate(earliest.getUTCDate() - 30);
  const sourceIds = new Set<string>();
  let totalEntries = 0;
  return value.map((raw): ParsedSnapshot => {
    if (!isRecord(raw) || !onlyKeys(raw, snapshotKeys)) {
      throw new UsageError(400, "invalid_snapshot");
    }
    const snapshot = raw as SnapshotInput;
    const start = utcDate(snapshot.rangeStart);
    const end = utcDate(snapshot.rangeEnd);
    if (
      !isUuid(snapshot.sourceId) ||
      sourceIds.has(snapshot.sourceId) ||
      typeof snapshot.syncSequence !== "string" ||
      !sequencePattern.test(snapshot.syncSequence) ||
      start === null ||
      end === null ||
      start > end ||
      start < earliest ||
      end > todayUtc ||
      (end.valueOf() - start.valueOf()) / 86_400_000 > 30 ||
      (snapshot.completeness !== "complete" && snapshot.completeness !== "partial") ||
      !Array.isArray(snapshot.entries)
    ) {
      throw new UsageError(400, "invalid_snapshot");
    }
    sourceIds.add(snapshot.sourceId);
    totalEntries += snapshot.entries.length;
    if (totalEntries > 1_024) throw new UsageError(400, "too_many_entries");
    const dates = new Set<string>();
    const entries = snapshot.entries.map((rawEntry): ParsedEntry => {
      if (!isRecord(rawEntry) || !onlyKeys(rawEntry, entryKeys)) {
        throw new UsageError(400, "invalid_entry");
      }
      const entry = rawEntry as EntryInput;
      const date = utcDate(entry.date);
      const total = typeof entry.totalTokens === "string" ? entry.totalTokens : "";
      const components = [
        optionalToken(entry.inputTokens),
        optionalToken(entry.outputTokens),
        optionalToken(entry.cacheReadTokens),
        optionalToken(entry.cacheWriteTokens),
        optionalToken(entry.reasoningTokens),
      ];
      const totalIsValid = tokenPattern.test(total);
      if (
        date === null ||
        date < start ||
        date > end ||
        dates.has(entry.date as string) ||
        !totalIsValid ||
        BigInt(total) > maximum ||
        components.includes(undefined)
      ) {
        throw new UsageError(
          400,
          totalIsValid && BigInt(total) > maximum ? "tokens_too_large" : "invalid_entry",
        );
      }
      const reported = components.filter((item): item is string => item !== null);
      if (
        (reported.length !== 0 && reported.length !== components.length) ||
        (reported.length > 0 &&
          reported.reduce((sum, item) => sum + BigInt(item), 0n) !== BigInt(total))
      ) {
        throw new UsageError(400, "token_components_mismatch");
      }
      dates.add(entry.date as string);
      return {
        date: entry.date as string,
        totalTokens: total,
        inputTokens: components[0] as string | null,
        outputTokens: components[1] as string | null,
        cacheReadTokens: components[2] as string | null,
        cacheWriteTokens: components[3] as string | null,
        reasoningTokens: components[4] as string | null,
      };
    });
    return {
      sourceId: snapshot.sourceId,
      syncSequence: snapshot.syncSequence,
      rangeStart: snapshot.rangeStart as string,
      rangeEnd: snapshot.rangeEnd as string,
      completeness: snapshot.completeness,
      entries,
    };
  });
}

export function parseSourceErrors(value: unknown): ParsedSourceError[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) {
    throw new UsageError(400, "invalid_source_errors");
  }
  const sourceIds = new Set<string>();
  return value.map((raw): ParsedSourceError => {
    if (!isRecord(raw) || !onlyKeys(raw, sourceErrorKeys)) {
      throw new UsageError(400, "invalid_source_error");
    }
    const sourceError = raw as SourceErrorInput;
    if (
      !isUuid(sourceError.sourceId) ||
      sourceIds.has(sourceError.sourceId) ||
      sourceError.code !== "collector_failed"
    ) {
      throw new UsageError(400, "invalid_source_error");
    }
    sourceIds.add(sourceError.sourceId);
    return { sourceId: sourceError.sourceId, code: sourceError.code };
  });
}

function affectedWeeks(snapshot: ParsedSnapshot): Set<string> {
  const result = new Set<string>();
  if (snapshot.completeness === "partial") {
    for (const entry of snapshot.entries)
      result.add(currentWeekStart(new Date(`${entry.date}T00:00:00Z`)));
    return result;
  }
  const cursor = new Date(`${snapshot.rangeStart}T00:00:00Z`);
  const end = new Date(`${snapshot.rangeEnd}T00:00:00Z`);
  while (cursor <= end) {
    result.add(currentWeekStart(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  result.add(currentWeekStart(end));
  return result;
}

async function post(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.startsWith("Bearer ")) {
    return problem(401, "unauthorized");
  }
  const token = authorization.slice(7);
  if (token.length < 32 || token.length > 128) return problem(401, "unauthorized");
  try {
    if (!(await consumeRateLimit("usage_pre_auth", clientAddress(request), 120, 60))) {
      return Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
      );
    }
    const installations = await query<InstallationRow>(
      `SELECT id::text, user_id::text FROM installations
        WHERE device_token_hash = $1 AND status = 'active' LIMIT 1`,
      [digest(token)],
    );
    const installation = installations[0];
    if (installation === undefined) return problem(401, "unauthorized");
    if (!(await consumeRateLimit("usage_sync", installation.id, 30, 60))) {
      return Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
      );
    }
    if (!(await consumeRateLimit("usage_sync_user", installation.user_id, 120, 60))) {
      return Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
      );
    }
    const rawBody = await readBoundedJson(request, 131_072);
    if (!isRecord(rawBody) || !onlyKeys(rawBody, bodyKeys)) return problem(400, "invalid_request");
    const body = rawBody as UsageBody;
    if (body.protocolVersion !== connectorProtocolVersion) {
      return problem(426, "unsupported_protocol_version");
    }
    const snapshots = parseSnapshots(body.snapshots);
    const sourceErrors = parseSourceErrors(body.sourceErrors);
    const sourceIds = [
      ...snapshots.map((snapshot) => snapshot.sourceId),
      ...sourceErrors.map((sourceError) => sourceError.sourceId),
    ];
    if (
      sourceIds.length < 1 ||
      sourceIds.length > 32 ||
      new Set(sourceIds).size !== sourceIds.length
    ) {
      return problem(400, "invalid_request");
    }
    const result = await transaction(async (client) => {
      const active = await client.query<InstallationRow>(
        `SELECT id::text, user_id::text FROM installations
          WHERE id = $1 AND device_token_hash = $2 AND status = 'active'
          FOR UPDATE`,
        [installation.id, digest(token)],
      );
      const lockedInstallation = active.rows[0];
      if (lockedInstallation === undefined) throw new UsageError(401, "unauthorized");
      const sources = await client.query<SourceRow>(
        `SELECT id::text, user_id::text, agent_id, last_accepted_sync_sequence::text
           FROM installation_sources
          WHERE installation_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'
          FOR UPDATE`,
        [lockedInstallation.id, sourceIds],
      );
      const sourceById = new Map(sources.rows.map((source) => [source.id, source]));
      if (sources.rows.length !== sourceIds.length) throw new UsageError(400, "unsupported_source");

      let acceptedEntries = 0;
      let acceptedSnapshots = 0;
      const acceptedSequences = new Map(
        sources.rows.map((source) => [source.id, source.last_accepted_sync_sequence]),
      );
      const acceptedSourceIds = new Set<string>();
      const summaries = new Set<string>();
      for (const snapshot of snapshots) {
        const source = sourceById.get(snapshot.sourceId);
        if (source === undefined || source.user_id !== lockedInstallation.user_id) {
          throw new UsageError(400, "unsupported_source");
        }
        if (BigInt(snapshot.syncSequence) <= BigInt(source.last_accepted_sync_sequence)) continue;
        if (
          !isSupportedAgent(source.agent_id) ||
          !agentRegistry[source.agent_id].countsExactTokens
        ) {
          await client.query("DELETE FROM daily_usage WHERE source_id = $1", [snapshot.sourceId]);
          await client.query(
            "DELETE FROM weekly_agent_usage WHERE user_id = $1 AND agent_id = $2",
            [source.user_id, source.agent_id],
          );
          await client.query(
            `UPDATE installation_sources
                SET last_accepted_sync_sequence = $2::numeric,
                    last_successful_sync_at = now(),
                    last_completeness = $3,
                    last_error_summary = NULL,
                    last_warning_summary = 'This agent does not expose exact countable tokens',
                    updated_at = now()
              WHERE id = $1`,
            [snapshot.sourceId, snapshot.syncSequence, snapshot.completeness],
          );
          acceptedSnapshots += 1;
          acceptedSequences.set(snapshot.sourceId, snapshot.syncSequence);
          acceptedSourceIds.add(snapshot.sourceId);
          continue;
        }
        const dates = snapshot.entries.map((entry) => entry.date);
        if (snapshot.completeness === "complete") {
          await client.query(
            `DELETE FROM daily_usage
              WHERE source_id = $1
                AND usage_date BETWEEN $2::date AND $3::date
                AND NOT (usage_date::text = ANY($4::text[]))`,
            [snapshot.sourceId, snapshot.rangeStart, snapshot.rangeEnd, dates],
          );
        }
        if (snapshot.entries.length > 0) {
          await client.query(
            `INSERT INTO daily_usage
               (source_id, usage_date, total_tokens, input_tokens, output_tokens,
                cache_read_tokens, cache_write_tokens, reasoning_tokens, completeness)
             SELECT $1,
                    e.date::date,
                    e."totalTokens"::numeric,
                    e."inputTokens"::numeric,
                    e."outputTokens"::numeric,
                    e."cacheReadTokens"::numeric,
                    e."cacheWriteTokens"::numeric,
                    e."reasoningTokens"::numeric,
                    $3
               FROM jsonb_to_recordset($2::jsonb) AS e(
                 date text,
                 "totalTokens" text,
                 "inputTokens" text,
                 "outputTokens" text,
                 "cacheReadTokens" text,
                 "cacheWriteTokens" text,
                 "reasoningTokens" text
               )
             ON CONFLICT (source_id, usage_date) DO UPDATE
               SET total_tokens = CASE
                     WHEN EXCLUDED.completeness = 'partial'
                      AND EXCLUDED.total_tokens < daily_usage.total_tokens
                     THEN daily_usage.total_tokens ELSE EXCLUDED.total_tokens END,
                   input_tokens = CASE
                     WHEN EXCLUDED.completeness = 'partial'
                      AND EXCLUDED.total_tokens < daily_usage.total_tokens
                     THEN daily_usage.input_tokens ELSE EXCLUDED.input_tokens END,
                   output_tokens = CASE
                     WHEN EXCLUDED.completeness = 'partial'
                      AND EXCLUDED.total_tokens < daily_usage.total_tokens
                     THEN daily_usage.output_tokens ELSE EXCLUDED.output_tokens END,
                   cache_read_tokens = CASE
                     WHEN EXCLUDED.completeness = 'partial'
                      AND EXCLUDED.total_tokens < daily_usage.total_tokens
                     THEN daily_usage.cache_read_tokens ELSE EXCLUDED.cache_read_tokens END,
                   cache_write_tokens = CASE
                     WHEN EXCLUDED.completeness = 'partial'
                      AND EXCLUDED.total_tokens < daily_usage.total_tokens
                     THEN daily_usage.cache_write_tokens ELSE EXCLUDED.cache_write_tokens END,
                   reasoning_tokens = CASE
                     WHEN EXCLUDED.completeness = 'partial'
                      AND EXCLUDED.total_tokens < daily_usage.total_tokens
                     THEN daily_usage.reasoning_tokens ELSE EXCLUDED.reasoning_tokens END,
                   completeness = CASE
                     WHEN EXCLUDED.completeness = 'partial'
                      AND EXCLUDED.total_tokens < daily_usage.total_tokens
                     THEN daily_usage.completeness ELSE EXCLUDED.completeness END,
                   updated_at = now()`,
            [snapshot.sourceId, JSON.stringify(snapshot.entries), snapshot.completeness],
          );
        }
        await client.query(
          `UPDATE installation_sources
              SET last_accepted_sync_sequence = $2::numeric,
                  last_successful_sync_at = now(),
                  last_completeness = $3,
                  last_error_summary = NULL,
                  last_warning_summary = $4,
                  updated_at = now()
            WHERE id = $1`,
          [
            snapshot.sourceId,
            snapshot.syncSequence,
            snapshot.completeness,
            snapshot.completeness === "partial" ? "Collector reported a partial snapshot" : null,
          ],
        );
        acceptedEntries += snapshot.entries.length;
        acceptedSnapshots += 1;
        acceptedSequences.set(snapshot.sourceId, snapshot.syncSequence);
        acceptedSourceIds.add(snapshot.sourceId);
        for (const week of affectedWeeks(snapshot)) {
          summaries.add(`${source.user_id}\0${source.agent_id}\0${week}`);
        }
      }
      for (const sourceError of sourceErrors) {
        const source = sourceById.get(sourceError.sourceId);
        if (source === undefined || source.user_id !== lockedInstallation.user_id) {
          throw new UsageError(400, "unsupported_source");
        }
        await client.query(
          `UPDATE installation_sources
              SET last_error_summary = 'Collector failed', updated_at = now()
            WHERE id = $1`,
          [sourceError.sourceId],
        );
      }
      for (const summary of summaries) {
        const [userId, agentId, week] = summary.split("\0");
        if (userId === undefined || agentId === undefined || week === undefined) {
          throw new Error("Invalid internal summary key");
        }
        await refreshAgentWeek(client, userId, agentId, week);
      }
      if (acceptedSnapshots > 0) {
        await client.query(
          "UPDATE installations SET last_sync_at = now(), updated_at = now() WHERE id = $1",
          [lockedInstallation.id],
        );
      }
      return {
        acceptedEntries,
        acceptedSnapshots,
        acceptedSourceErrors: sourceErrors.length,
        staleSnapshots: snapshots.length - acceptedSnapshots,
        sourceSequences: sourceIds.map((sourceId) => ({
          sourceId,
          lastAcceptedSyncSequence: acceptedSequences.get(sourceId) ?? "0",
          accepted: acceptedSourceIds.has(sourceId),
        })),
      };
    });
    return annotateResponse(Response.json(result, { headers: { "Cache-Control": "no-store" } }), {
      snapshotsReceived: snapshots.length,
      snapshotsAccepted: result.acceptedSnapshots,
      snapshotsStale: result.staleSnapshots,
      entriesAccepted: result.acceptedEntries,
      sourceErrorsReceived: sourceErrors.length,
    });
  } catch (error) {
    if (error instanceof UsageError) return problem(error.status, error.code);
    return error instanceof SyntaxError || error instanceof RangeError
      ? problem(400, "invalid_request")
      : problem(500, "server_error", error);
  }
}

export const POST = withRequestLogging("/api/usage", post);
