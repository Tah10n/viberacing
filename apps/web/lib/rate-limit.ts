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

export type ClientAddress =
  | { trusted: true; key: string }
  | {
      trusted: false;
      key: string;
      reason: "proxy_disabled" | "missing_header" | "invalid_header";
    };

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
  return isIP(value) !== 0
    ? { trusted: true, key: value }
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
