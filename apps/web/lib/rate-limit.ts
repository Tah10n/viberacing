import ipaddr from "ipaddr.js";
import type { PoolClient } from "pg";
import { trustedProxyMode } from "./config";
import { digest } from "./crypto";
import { transaction } from "./db";

const cleanupIntervalMilliseconds = 60_000;
let lastCleanupStartedAt = 0;
let cleanupInFlight: Promise<void> | null = null;

export function rateLimitCleanupDue(lastStartedAt: number, now: number): boolean {
  return lastStartedAt === 0 || now - lastStartedAt >= cleanupIntervalMilliseconds;
}

function validateRateLimit(scope: string, limit: number, windowSeconds: number): void {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(scope)) throw new RangeError("Invalid rate-limit scope");
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Invalid rate-limit limit");
  if (!Number.isSafeInteger(windowSeconds) || windowSeconds < 1)
    throw new RangeError("Invalid rate-limit window");
}

function scheduleExpiredRateLimitBucketCleanup(): void {
  const startedAt = Date.now();
  if (cleanupInFlight !== null || !rateLimitCleanupDue(lastCleanupStartedAt, startedAt)) return;
  lastCleanupStartedAt = startedAt;
  cleanupInFlight = transaction(async (client) => {
    await client.query(
      `DELETE FROM rate_limit_buckets
        WHERE ctid IN (
          SELECT ctid
            FROM rate_limit_buckets
           WHERE expires_at <= now()
           ORDER BY expires_at
           LIMIT 100
        )`,
    );
  })
    .catch(() => {})
    .finally(() => {
      cleanupInFlight = null;
    });
}

async function incrementRateLimitBucket(
  client: PoolClient,
  scope: string,
  key: string,
  windowSeconds: number,
): Promise<number> {
  const result = await client.query<{ request_count: number }>(
    `INSERT INTO rate_limit_buckets
       (scope, key_hash, window_started_at, request_count, expires_at)
     VALUES (
       $1, $2,
       to_timestamp(floor(extract(epoch FROM now()) / $3) * $3),
       1,
       to_timestamp((floor(extract(epoch FROM now()) / $3) + 1) * $3)
     )
     ON CONFLICT (scope, key_hash, window_started_at) DO UPDATE
       SET request_count = rate_limit_buckets.request_count + 1
     RETURNING request_count`,
    [scope, digest(key), windowSeconds],
  );
  return result.rows[0]?.request_count ?? Number.MAX_SAFE_INTEGER;
}

export async function consumeRateLimit(
  scope: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  validateRateLimit(scope, limit, windowSeconds);
  scheduleExpiredRateLimitBucketCleanup();
  return transaction(async (client) => {
    return (await incrementRateLimitBucket(client, scope, key, windowSeconds)) <= limit;
  });
}

export type AdmissionResult =
  { allowed: true; reason: null } | { allowed: false; reason: "global" | "client" };

export async function consumeAdmissionRateLimit(
  scope: string,
  clientKey: string,
  clientLimit: number,
  globalLimit: number,
  windowSeconds: number,
): Promise<AdmissionResult> {
  const globalScope = `admit_${scope}`;
  validateRateLimit(scope, clientLimit, windowSeconds);
  validateRateLimit(globalScope, globalLimit, windowSeconds);
  scheduleExpiredRateLimitBucketCleanup();
  return transaction(async (client) => {
    const globalCount = await incrementRateLimitBucket(client, globalScope, "all", windowSeconds);
    if (globalCount > globalLimit) return { allowed: false, reason: "global" };
    const clientCount = await incrementRateLimitBucket(client, scope, clientKey, windowSeconds);
    return clientCount <= clientLimit
      ? { allowed: true, reason: null }
      : { allowed: false, reason: "client" };
  });
}

export type ClientAddress =
  | { trusted: true; key: string }
  | {
      trusted: false;
      key: string;
      reason: "proxy_disabled" | "missing_header" | "invalid_header";
    };

export function canonicalClientAddress(value: string): string | null {
  if (!ipaddr.isValid(value)) return null;
  const parsed = ipaddr.parse(value);
  if (parsed instanceof ipaddr.IPv4) return parsed.toString();
  if (parsed.isIPv4MappedAddress()) return parsed.toIPv4Address().toString();
  const bytes = parsed.toByteArray();
  bytes.fill(0, 8);
  return `${ipaddr.fromByteArray(bytes).toString()}/64`;
}

export function clientAddress(request: Request): ClientAddress {
  const mode = trustedProxyMode();
  if (mode === "none") {
    return { trusted: false, key: "untrusted:proxy_disabled", reason: "proxy_disabled" };
  }
  // Both supported proxy modes require the edge proxy to overwrite X-Real-IP.
  const raw = request.headers.get("x-real-ip");
  if (raw === null || raw.trim() === "") {
    return { trusted: false, key: "untrusted:missing_header", reason: "missing_header" };
  }
  const value = raw.trim();
  const canonical = canonicalClientAddress(value);
  return canonical !== null
    ? { trusted: true, key: canonical }
    : { trusted: false, key: "untrusted:invalid_header", reason: "invalid_header" };
}

export function clientAdmissionLimit(
  address: ClientAddress,
  trustedLimit: number,
  localPreviewLimit: number,
  invalidHeaderLimit: number,
): number {
  if (address.trusted) return trustedLimit;
  return address.reason === "proxy_disabled" ? localPreviewLimit : invalidHeaderLimit;
}
