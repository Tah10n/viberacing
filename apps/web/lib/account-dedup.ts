import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { SupportedAgent } from "./agents";

export const accountDedupLookbackDays = 30;
export const minimumAccountDedupMatchedDays = 2;

interface CandidateScore {
  account_id: string;
  source_id: string;
  created_at: Date;
  matched_days: number;
  mismatched_days: number;
}

interface SourceAccount {
  source_id: string;
  agent_id: SupportedAgent;
  account_id: string;
  created_at: Date;
  source_count: number;
}

export interface AccountDedupResult {
  eventId: string;
  agentId: SupportedAgent;
  previousAccountId: string;
  targetAccountId: string;
  matchedDays: number;
}

export function isConfidentAccountMatch(
  score: Pick<CandidateScore, "matched_days" | "mismatched_days">,
): boolean {
  return score.matched_days >= minimumAccountDedupMatchedDays && score.mismatched_days === 0;
}

export function selectAccountDedupCandidate(
  scores: readonly CandidateScore[],
): CandidateScore | null {
  return (
    scores.filter(isConfidentAccountMatch).toSorted((left, right) => {
      if (left.matched_days !== right.matched_days) {
        return right.matched_days - left.matched_days;
      }
      const created = left.created_at.getTime() - right.created_at.getTime();
      return created === 0 ? left.account_id.localeCompare(right.account_id) : created;
    })[0] ?? null
  );
}

export async function autoDeduplicateAccountWideSource(
  client: PoolClient,
  userId: string,
  sourceId: string,
  todayUtc: string,
): Promise<AccountDedupResult | null> {
  const current = await client.query<SourceAccount>(
    `SELECT s.id::text AS source_id,
            s.agent_id,
            a.id::text AS account_id,
            a.created_at,
            (SELECT count(*)::int FROM installation_sources owned
              WHERE owned.user_id = $2 AND owned.agent_account_id = a.id) AS source_count
       FROM installation_sources s
       JOIN agent_accounts a ON a.id = s.agent_account_id
      WHERE s.id = $1 AND s.user_id = $2 AND s.status = 'active'
        AND a.user_id = $2 AND a.agent_id = s.agent_id
        AND a.aggregation_mode = 'account_max'
        AND a.merged_into_account_id IS NULL
        AND s.auto_dedup_decided_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM account_dedup_events event WHERE event.source_id = s.id)
      FOR UPDATE OF s, a`,
    [sourceId, userId],
  );
  const source = current.rows[0];
  if (source === undefined) return null;

  const candidates = await client.query<CandidateScore>(
    `WITH source_days AS (
       SELECT usage_date, total_tokens
         FROM daily_usage
        WHERE source_id = $1
          AND completeness = 'complete'
          AND usage_date < $4::date
          AND usage_date >= $4::date - $5::int
     ), candidate_days AS (
       SELECT account.id AS account_id,
              candidate_source.id AS source_id,
              account.created_at,
              usage.usage_date,
              max(usage.total_tokens) AS total_tokens
         FROM agent_accounts account
         JOIN installation_sources candidate_source
           ON candidate_source.agent_account_id = account.id
          AND candidate_source.user_id = $2
          AND candidate_source.agent_id = $3
         JOIN daily_usage usage ON usage.source_id = candidate_source.id
        WHERE account.user_id = $2
          AND account.agent_id = $3
          AND account.id <> $6
          AND account.aggregation_mode = 'account_max'
          AND account.merged_into_account_id IS NULL
          AND candidate_source.auto_dedup_decided_at IS NULL
          AND (SELECT count(*) FROM installation_sources owned
                WHERE owned.user_id = $2 AND owned.agent_account_id = account.id) = 1
          AND NOT EXISTS (
                SELECT 1 FROM account_dedup_events event
                 WHERE event.source_id = candidate_source.id
              )
          AND usage.usage_date < $4::date
          AND usage.usage_date >= $4::date - $5::int
        GROUP BY account.id, candidate_source.id, account.created_at, usage.usage_date
       HAVING bool_and(usage.completeness = 'complete')
     )
     SELECT candidate.account_id::text,
            candidate.source_id::text,
            candidate.created_at,
            count(*) FILTER (
              WHERE candidate.total_tokens = source.total_tokens AND source.total_tokens > 0
            )::int
              AS matched_days,
            count(*) FILTER (WHERE candidate.total_tokens <> source.total_tokens)::int
              AS mismatched_days
       FROM source_days source
       JOIN candidate_days candidate USING (usage_date)
      GROUP BY candidate.account_id, candidate.source_id, candidate.created_at`,
    [
      source.source_id,
      userId,
      source.agent_id,
      todayUtc,
      accountDedupLookbackDays,
      source.account_id,
    ],
  );
  const target = selectAccountDedupCandidate(candidates.rows);
  if (target === null) return null;
  const currentIsCanonical =
    source.source_count > 1 ||
    source.created_at.getTime() < target.created_at.getTime() ||
    (source.created_at.getTime() === target.created_at.getTime() &&
      source.account_id.localeCompare(target.account_id) < 0);
  const movingSourceId = currentIsCanonical ? target.source_id : source.source_id;
  const previousAccountId = currentIsCanonical ? target.account_id : source.account_id;
  const targetAccountId = currentIsCanonical ? source.account_id : target.account_id;

  const lockedMove = await client.query<{ id: string }>(
    `SELECT moving.id::text
       FROM agent_accounts previous
       JOIN installation_sources moving ON moving.agent_account_id = previous.id
       JOIN agent_accounts target ON target.id = $2
      WHERE previous.id = $1 AND previous.user_id = $3 AND previous.agent_id = $4
        AND previous.aggregation_mode = 'account_max'
        AND previous.merged_into_account_id IS NULL
        AND moving.id = $5
        AND moving.user_id = $3
        AND moving.auto_dedup_decided_at IS NULL
        AND (SELECT count(*) FROM installation_sources owned
              WHERE owned.user_id = $3 AND owned.agent_account_id = previous.id) = 1
        AND target.user_id = $3 AND target.agent_id = $4
        AND target.aggregation_mode = 'account_max'
        AND target.merged_into_account_id IS NULL
        AND NOT EXISTS (
              SELECT 1 FROM account_dedup_events event WHERE event.source_id = moving.id
            )
      FOR UPDATE OF previous, moving, target`,
    [previousAccountId, targetAccountId, userId, source.agent_id, movingSourceId],
  );
  if (lockedMove.rows[0] === undefined) return null;

  const reassigned = await client.query(
    `UPDATE installation_sources
        SET agent_account_id = $2,
            auto_dedup_decided_at = coalesce(auto_dedup_decided_at, now()),
            updated_at = now()
      WHERE id = $1 AND user_id = $3 AND agent_account_id = $4`,
    [movingSourceId, targetAccountId, userId, previousAccountId],
  );
  if (reassigned.rowCount !== 1) throw new Error("Account deduplication lost its source mapping");
  const merged = await client.query(
    `UPDATE agent_accounts
        SET merged_into_account_id = $2, updated_at = now()
      WHERE id = $1 AND user_id = $3 AND merged_into_account_id IS NULL`,
    [previousAccountId, targetAccountId, userId],
  );
  if (merged.rowCount !== 1) throw new Error("Account deduplication lost its source account");

  const eventId = randomUUID();
  await client.query(
    `INSERT INTO account_dedup_events
       (id, user_id, agent_id, source_id, previous_account_id, target_account_id,
        matched_days, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')`,
    [
      eventId,
      userId,
      source.agent_id,
      movingSourceId,
      previousAccountId,
      targetAccountId,
      target.matched_days,
    ],
  );
  return {
    eventId,
    agentId: source.agent_id,
    previousAccountId,
    targetAccountId,
    matchedDays: target.matched_days,
  };
}
