import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { agentRegistry, type SupportedAgent } from "@/lib/agents";
import { publicOrigin } from "@/lib/config";
import { digest, normalizePairingCode } from "@/lib/crypto";
import { transaction } from "@/lib/db";
import {
  isSafeDisplayText,
  isUuid,
  markResponse,
  problem,
  readBoundedForm,
  sameOrigin,
} from "@/lib/http";
import { viewer } from "@/lib/session";
import { rebuildAgentSummaries } from "@/lib/usage-summary";
import { withRequestLogging } from "@/lib/request-log";
import { clientAddress, clientAdmissionLimit, consumeRateLimit } from "@/lib/rate-limit";

interface InstallationRow {
  id: string;
  user_id: string | null;
  name: string | null;
  status: string;
}

interface SourceRow {
  id: string;
  agent_id: SupportedAgent;
  agent_account_id: string | null;
  suggested_label: string | null;
}

interface SupersededSourceRow {
  id: string;
  agent_id: SupportedAgent;
}

class ApprovalError extends Error {
  constructor(readonly code: "expired" | "ownership" | "sources" | "selection" | "limit") {
    super(code);
  }
}

const maximumActiveInstallationsPerUser = 20;
const maximumActiveSourcesPerUser = 100;
const maximumAgentAccountsPerUser = 100;

export function exceedsPairingLimits(
  counts: { installations: number; sources: number; accounts: number },
  incomingSources: number,
  newAccounts: number,
): boolean {
  return (
    counts.installations >= maximumActiveInstallationsPerUser ||
    counts.sources + incomingSources > maximumActiveSourcesPerUser ||
    counts.accounts + newAccounts > maximumAgentAccountsPerUser
  );
}

function validLabel(value: string | null): string | null {
  const label = value?.trim() ?? "";
  return isSafeDisplayText(label, 40) ? label : null;
}

async function post(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const address = clientAddress(request);
  if (
    !(await consumeRateLimit(
      "pairing_approve_pre_auth",
      address.key,
      clientAdmissionLimit(address, 60, 2_000, 10),
      60,
    ))
  ) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  }
  const current = await viewer();
  if (current === null) return problem(401, "unauthorized");
  if (!(await consumeRateLimit("pairing_approve_user", current.id, 20, 60))) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  }
  if (!(await consumeRateLimit("pairing_approve_global", "all", 2_000, 60))) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  }
  let form: URLSearchParams;
  try {
    form = await readBoundedForm(request, 16_384);
  } catch (error) {
    return error instanceof RangeError
      ? problem(413, "body_too_large")
      : problem(400, "invalid_request");
  }
  const codeValue = form.get("code");
  const code = normalizePairingCode(typeof codeValue === "string" ? codeValue : "");
  try {
    await transaction(async (client) => {
      await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [current.id]);
      const pending = await client.query<InstallationRow>(
        `SELECT id::text, user_id::text, name, status
           FROM installations
          WHERE pairing_code_hash = $1
            AND pairing_expires_at > now()
            AND status IN ('pending', 'active')
          FOR UPDATE`,
        [digest(code)],
      );
      const installation = pending.rows[0];
      if (installation === undefined) throw new ApprovalError("expired");
      if (installation.user_id !== null && installation.user_id !== current.id) {
        throw new ApprovalError("ownership");
      }
      const sources = await client.query<SourceRow>(
        `SELECT id::text, agent_id, agent_account_id::text, suggested_label
           FROM installation_sources
          WHERE installation_id = $1 AND pending_pairing_code_hash = $2
            AND NOT pending_disconnect
          ORDER BY created_at, id
          FOR UPDATE`,
        [installation.id, digest(code)],
      );
      if (sources.rows.length === 0) throw new ApprovalError("sources");
      const supersededSources = await client.query<SupersededSourceRow>(
        `SELECT id::text, agent_id
           FROM installation_sources
          WHERE installation_id = $1 AND pending_pairing_code_hash = $2
            AND pending_disconnect
          ORDER BY created_at, id
          FOR UPDATE`,
        [installation.id, digest(code)],
      );

      const sourceIds = sources.rows.map((source) => source.id);
      const supersededSourceIds = supersededSources.rows.map((source) => source.id);
      const pairingSourceIds = [...sourceIds, ...supersededSourceIds];
      const usage = await client.query<{
        installations: number;
        sources: number;
        accounts: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM installations
             WHERE user_id = $1 AND status = 'active' AND id <> $2) AS installations,
           (SELECT count(*)::int FROM installation_sources
             WHERE user_id = $1 AND status = 'active'
               AND NOT (id = ANY($3::uuid[]))) AS sources,
           (SELECT count(*)::int FROM agent_accounts WHERE user_id = $1) AS accounts`,
        [current.id, installation.id, pairingSourceIds],
      );
      const counts = usage.rows[0];
      const newAccounts = sources.rows.filter(
        (source) => form.get(`account_${source.id}`) === "new",
      ).length;
      if (counts === undefined || exceedsPairingLimits(counts, sources.rows.length, newAccounts)) {
        throw new ApprovalError("limit");
      }

      const assignments = new Map<string, string>();
      const summariesToRebuild = new Set<SupportedAgent>();
      for (const source of supersededSources.rows) summariesToRebuild.add(source.agent_id);
      for (const source of sources.rows) {
        const selection = form.get(`account_${source.id}`);
        if (selection === null && source.agent_account_id !== null) {
          assignments.set(source.id, source.agent_account_id);
          continue;
        }
        if (selection === "new") {
          const label =
            validLabel(form.get(`label_${source.id}`)) ??
            validLabel(source.suggested_label) ??
            agentRegistry[source.agent_id].displayName;
          const accountId = randomUUID();
          await client.query(
            `INSERT INTO agent_accounts (id, user_id, agent_id, label, aggregation_mode)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              accountId,
              current.id,
              source.agent_id,
              label,
              agentRegistry[source.agent_id].aggregationMode,
            ],
          );
          assignments.set(source.id, accountId);
          continue;
        }
        if (!isUuid(selection)) throw new ApprovalError("selection");
        const account = await client.query<{ id: string }>(
          `SELECT id::text FROM agent_accounts
            WHERE id = $1 AND user_id = $2 AND agent_id = $3
            FOR UPDATE`,
          [selection, current.id, source.agent_id],
        );
        if (account.rows[0] === undefined) throw new ApprovalError("selection");
        assignments.set(source.id, selection);
      }

      for (const source of sources.rows) {
        const nextAccountId = assignments.get(source.id);
        if (
          source.agent_account_id !== null &&
          nextAccountId !== undefined &&
          source.agent_account_id !== nextAccountId
        ) {
          summariesToRebuild.add(source.agent_id);
        }
      }

      let name = installation.name;
      if (name === null) {
        const result = await client.query<{ position: number }>(
          "SELECT count(*)::int + 1 AS position FROM installations WHERE user_id = $1 AND id <> $2",
          [current.id, installation.id],
        );
        name = `Computer ${String(result.rows[0]?.position ?? 1)}`;
      }
      await client.query(
        `UPDATE installations
            SET user_id = $2,
                name = $3,
                status = 'active',
                device_token_hash = pending_device_token_hash,
                pending_device_token_hash = NULL,
                pairing_code_hash = NULL,
                revoked_at = NULL,
                updated_at = now()
          WHERE id = $1`,
        [installation.id, current.id, name],
      );
      for (const source of sources.rows) {
        await client.query(
          `UPDATE installation_sources
              SET user_id = $2,
                  agent_account_id = $3,
                  status = 'active',
                  pending_pairing_code_hash = NULL,
                  updated_at = now()
            WHERE id = $1`,
          [source.id, current.id, assignments.get(source.id)],
        );
      }
      if (supersededSourceIds.length > 0) {
        await client.query("DELETE FROM daily_usage WHERE source_id = ANY($1::uuid[])", [
          supersededSourceIds,
        ]);
        await client.query(
          `UPDATE installation_sources
              SET status = 'disconnected',
                  pending_pairing_code_hash = NULL,
                  pending_disconnect = false,
                  updated_at = now()
            WHERE id = ANY($1::uuid[])`,
          [supersededSourceIds],
        );
      }
      for (const agentId of summariesToRebuild) {
        await rebuildAgentSummaries(client, current.id, agentId);
      }
    });
  } catch (error) {
    if (!(error instanceof ApprovalError)) throw error;
    return markResponse(
      NextResponse.redirect(
        new URL(
          `/connect?code=${encodeURIComponent(code)}&error=${error.code === "limit" ? "limit" : "expired"}`,
          publicOrigin(),
        ),
        303,
      ),
      error.code === "limit" ? "pairing_limit_reached" : "pairing_expired",
    );
  }
  return NextResponse.redirect(new URL("/dashboard?connected=1", publicOrigin()), 303);
}

export const POST = withRequestLogging("/api/pairing/approve", post);
