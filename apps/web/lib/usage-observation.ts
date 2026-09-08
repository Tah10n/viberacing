import { createHmac, timingSafeEqual } from "node:crypto";

export function issueUsageObservation(key: Buffer, startedAt: Date): string {
  const timestamp = startedAt.toISOString();
  const signature = createHmac("sha256", key)
    .update(`viberacing-usage-observation-v1\0${timestamp}`)
    .digest("hex");
  return `${timestamp}.${signature}`;
}

export function readUsageObservation(
  key: Buffer,
  ticket: string,
  latestIssuedAt: Date,
): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\.[0-9a-f]{64}$/.test(ticket)) return null;
  const timestamp = new Date(ticket.slice(0, 24));
  if (
    !Number.isFinite(timestamp.getTime()) ||
    timestamp > latestIssuedAt ||
    timestamp.toISOString() !== ticket.slice(0, 24)
  )
    return null;
  const expected = issueUsageObservation(key, timestamp);
  return timingSafeEqual(Buffer.from(ticket), Buffer.from(expected)) ? timestamp : null;
}
