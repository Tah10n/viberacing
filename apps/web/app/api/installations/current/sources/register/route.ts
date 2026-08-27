import { randomUUID } from "node:crypto";
import { agentRegistry } from "@/lib/agents";
import { digest } from "@/lib/crypto";
import {
  maximumActiveSourcesPerUser,
  maximumAgentAccountsPerUser,
  maximumSourcesPerInstallation,
} from "@/lib/config";
import { query, transaction } from "@/lib/db";
import { isRecord, isUuid, problem, readBoundedJson } from "@/lib/http";
import {
  clientAddress,
  clientAdmissionLimit,
  consumeAdmissionRateLimit,
  consumeRateLimit,
} from "@/lib/rate-limit";
import { withRequestLogging } from "@/lib/request-log";

const maximumCodexAccountsPerProfile = 8;

function bearer(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  return token.length >= 32 && token.length <= 128 ? token : null;
}

function rateLimited(): Response {
  return Response.json(
    { error: "rate_limited" },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
  );
}

interface RegistrationBody {
  agentId: "codex";
  clientSourceId: string;
  collectionMethod: "codex_app_server";
  profileClientSourceId: string;
  supportedSurface: "desktop";
}

export function parseSourceRegistrationBody(value: unknown): RegistrationBody | null {
  if (
    !isRecord(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([
        "agentId",
        "clientSourceId",
        "collectionMethod",
        "profileClientSourceId",
        "supportedSurface",
      ]) ||
    value.agentId !== "codex" ||
    value.collectionMethod !== "codex_app_server" ||
    value.supportedSurface !== "desktop" ||
    !isUuid(value.clientSourceId) ||
    !isUuid(value.profileClientSourceId) ||
    value.clientSourceId === value.profileClientSourceId
  ) {
    return null;
  }
  return {
    agentId: "codex",
    clientSourceId: value.clientSourceId,
    collectionMethod: "codex_app_server",
    profileClientSourceId: value.profileClientSourceId,
    supportedSurface: "desktop",
  };
}

type SourceMapping = {
  account_label: string;
  agent_account_id: string;
  agent_id: string;
  client_source_id: string;
  collection_method: string;
  last_accepted_sync_sequence: string;
  source_id: string;
  profile_source_id: string;
};

function response(mapping: SourceMapping): Response {
  return Response.json(
    {
      source: {
        clientSourceId: mapping.client_source_id,
        sourceId: mapping.source_id,
        agentAccountId: mapping.agent_account_id,
        agentId: mapping.agent_id,
        accountLabel: mapping.account_label,
        collectionMethod: mapping.collection_method,
        lastAcceptedSyncSequence: mapping.last_accepted_sync_sequence,
        profileSourceId: mapping.profile_source_id,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function post(request: Request): Promise<Response> {
  const token = bearer(request);
  if (!token) return problem(401, "unauthorized");
  try {
    const address = clientAddress(request);
    if (
      !(
        await consumeAdmissionRateLimit(
          "source_register_pre_auth",
          address.key,
          clientAdmissionLimit(address, 30, 2_000, 10),
          2_000,
          60,
        )
      ).allowed
    ) {
      return rateLimited();
    }
    const installations = await query<{ id: string; user_id: string }>(
      `SELECT id::text, user_id::text
         FROM installations
        WHERE device_token_hash = $1 AND status = 'active' AND user_id IS NOT NULL
        LIMIT 1`,
      [digest(token)],
    );
    const installation = installations[0];
    if (!installation) return problem(401, "unauthorized");
    if (!(await consumeRateLimit("source_register_installation", installation.id, 16, 60)))
      return rateLimited();
    if (!(await consumeRateLimit("source_register_global", "all", 2_000, 60))) return rateLimited();
    const body = parseSourceRegistrationBody(await readBoundedJson(request, 1_024));
    if (body === null) return problem(400, "invalid_request");

    const outcome = await transaction(async (client) => {
      const lockedUser = await client.query<{ id: string }>(
        "SELECT id::text FROM users WHERE id = $1 FOR UPDATE",
        [installation.user_id],
      );
      if (!lockedUser.rows[0]) return { kind: "unauthorized" as const };
      const lockedInstallation = await client.query<{ id: string; user_id: string }>(
        `SELECT id::text, user_id::text
           FROM installations
          WHERE id = $1 AND device_token_hash = $2 AND user_id = $3 AND status = 'active'
          FOR UPDATE`,
        [installation.id, digest(token), installation.user_id],
      );
      const owner = lockedInstallation.rows[0];
      if (!owner) return { kind: "unauthorized" as const };

      const existing = await client.query<SourceMapping & { status: string }>(
        `SELECT source.id::text AS source_id,
                source.client_source_id,
                source.agent_account_id::text,
                source.agent_id,
                account.label AS account_label,
                source.collection_method,
                source.last_accepted_sync_sequence::text,
                source.profile_source_id::text,
                source.status
           FROM installation_sources source
           JOIN agent_accounts account ON account.id = source.agent_account_id
          WHERE source.installation_id = $1 AND source.client_source_id = $2
          FOR UPDATE OF source`,
        [owner.id, body.clientSourceId],
      );
      const profile = await client.query<{ id: string }>(
        `SELECT id::text
           FROM installation_sources
          WHERE client_source_id = $1
            AND installation_id = $2
            AND user_id = $3
            AND agent_id = $4
            AND collection_method = $5
            AND supported_surface = $6
            AND status = 'active'
            AND profile_source_id IS NULL
          FOR UPDATE`,
        [
          body.profileClientSourceId,
          owner.id,
          owner.user_id,
          body.agentId,
          body.collectionMethod,
          body.supportedSurface,
        ],
      );
      const physical = profile.rows[0];
      if (!physical)
        return existing.rows[0]
          ? { kind: "conflict" as const }
          : { kind: "unsupported_profile" as const };
      if (existing.rows[0]) {
        return existing.rows[0].profile_source_id === physical.id &&
          existing.rows[0].agent_id === "codex" &&
          existing.rows[0].status === "active"
          ? { kind: "ok" as const, mapping: existing.rows[0] }
          : { kind: "conflict" as const };
      }

      const reusableAccounts = await client.query<{ account_id: string; account_label: string }>(
        `SELECT coalesce(canonical.id, account.id)::text AS account_id,
                coalesce(canonical.label, account.label) AS account_label
           FROM installation_sources previous_source
           JOIN agent_accounts account
             ON account.id = previous_source.agent_account_id
            AND account.user_id = previous_source.user_id
            AND account.agent_id = previous_source.agent_id
           LEFT JOIN agent_accounts canonical
             ON canonical.id = account.merged_into_account_id
            AND canonical.user_id = account.user_id
            AND canonical.agent_id = account.agent_id
            AND canonical.merged_into_account_id IS NULL
          WHERE previous_source.user_id = $1
            AND previous_source.agent_id = $2
            AND previous_source.client_source_id = $3
            AND previous_source.status IN ('active', 'disconnected')
            AND (account.merged_into_account_id IS NULL OR canonical.id IS NOT NULL)
          ORDER BY previous_source.updated_at DESC, previous_source.id`,
        [owner.user_id, body.agentId, body.clientSourceId],
      );
      const reusableById = new Map(
        reusableAccounts.rows.map((account) => [account.account_id, account.account_label]),
      );
      if (reusableById.size > 1) return { kind: "conflict" as const };
      const reusableAccount = reusableById.entries().next().value;

      const counts = await client.query<{
        account_count: number;
        installation_count: number;
        profile_count: number;
        user_source_count: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM installation_sources
             WHERE installation_id = $1 AND status = 'active') AS installation_count,
           (SELECT count(*)::int FROM installation_sources
             WHERE installation_id = $1
               AND status = 'active'
               AND (id = $2 OR profile_source_id = $2)) AS profile_count,
           (SELECT count(*)::int FROM installation_sources
             WHERE user_id = $3 AND status = 'active') AS user_source_count,
           (SELECT count(*)::int FROM agent_accounts
             WHERE user_id = $3 AND merged_into_account_id IS NULL) AS account_count`,
        [owner.id, physical.id, owner.user_id],
      );
      const currentCounts = counts.rows[0];
      if (!currentCounts) return { kind: "source_limit" as const };
      if (
        currentCounts.installation_count >= maximumSourcesPerInstallation ||
        currentCounts.user_source_count >= maximumActiveSourcesPerUser
      )
        return { kind: "source_limit" as const };
      if (
        currentCounts.profile_count >= maximumCodexAccountsPerProfile ||
        (reusableAccount === undefined &&
          currentCounts.account_count >= maximumAgentAccountsPerUser)
      )
        return { kind: "account_limit" as const };

      const accountId = reusableAccount?.[0] ?? randomUUID();
      const sourceId = randomUUID();
      const accountLabel =
        reusableAccount?.[1] ?? `Codex account ${String(currentCounts.profile_count + 1)}`;
      if (reusableAccount === undefined)
        await client.query(
          `INSERT INTO agent_accounts
             (id, user_id, agent_id, label, aggregation_mode, new_account_notice_pending)
           VALUES ($1, $2, $3, $4, $5, true)`,
          [
            accountId,
            owner.user_id,
            body.agentId,
            accountLabel,
            agentRegistry.codex.aggregationMode,
          ],
        );
      const inserted = await client.query<SourceMapping>(
        `INSERT INTO installation_sources
           (id, installation_id, user_id, agent_account_id, agent_id, client_source_id,
            collection_method, supported_surface, suggested_label, status, profile_source_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10)
         RETURNING id::text AS source_id, client_source_id, agent_account_id::text, agent_id,
                   $9::text AS account_label, collection_method,
                   last_accepted_sync_sequence::text, profile_source_id::text`,
        [
          sourceId,
          owner.id,
          owner.user_id,
          accountId,
          body.agentId,
          body.clientSourceId,
          body.collectionMethod,
          body.supportedSurface,
          accountLabel,
          physical.id,
        ],
      );
      const mapping = inserted.rows[0];
      if (!mapping) throw new Error("Dynamic source insert returned no row");
      return { kind: "ok" as const, mapping };
    });

    if (outcome.kind === "unauthorized") return problem(401, "unauthorized");
    if (outcome.kind === "conflict") return problem(409, "source_registration_conflict");
    if (outcome.kind === "unsupported_profile") return problem(400, "unsupported_profile");
    if (outcome.kind === "source_limit") return problem(409, "source_limit_reached");
    if (outcome.kind === "account_limit") return problem(409, "profile_account_limit_reached");
    return response(outcome.mapping);
  } catch (error) {
    return error instanceof SyntaxError || error instanceof RangeError
      ? problem(400, "invalid_request")
      : problem(500, "server_error", error);
  }
}

export const POST = withRequestLogging("/api/installations/current/sources/register", post);
