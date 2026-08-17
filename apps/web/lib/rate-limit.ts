import { isIP } from "node:net";
import { trustedProxyMode } from "./config";
import { digest } from "./crypto";
import { transaction } from "./db";

export async function consumeRateLimit(
  scope: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(scope)) throw new RangeError("Invalid rate-limit scope");
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Invalid rate-limit limit");
  if (!Number.isSafeInteger(windowSeconds) || windowSeconds < 1)
    throw new RangeError("Invalid rate-limit window");
  return transaction(async (client) => {
    await client.query(
      `DELETE FROM rate_limit_buckets
        WHERE ctid IN (
          SELECT ctid FROM rate_limit_buckets WHERE expires_at <= now() LIMIT 100
        )`,
    );
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
    return (result.rows[0]?.request_count ?? limit + 1) <= limit;
  });
}

export function clientAddress(request: Request): string {
  if (trustedProxyMode() !== "railway") return "untrusted-forwarding-headers";
  // Railway's edge overwrites X-Real-IP with the address it observed.
  const value = request.headers.get("x-real-ip")?.trim() ?? "";
  return isIP(value) !== 0 ? value : "missing-trusted-client-address";
}
