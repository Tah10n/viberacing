interface Bucket {
  count: number;
  resetAt: number;
}

export function createFixedWindowLimiter(limit: number, windowMs: number, maximumKeys: number) {
  const buckets = new Map<string, Bucket>();
  return (key: string, now = Date.now()): boolean => {
    const current = buckets.get(key);
    if (current !== undefined && now < current.resetAt) {
      current.count += 1;
      return current.count <= limit;
    }
    if (current === undefined && buckets.size >= maximumKeys) {
      for (const [candidate, bucket] of buckets)
        if (now >= bucket.resetAt) buckets.delete(candidate);
      if (buckets.size >= maximumKeys) return false;
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  };
}

export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  const address = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  return address.slice(0, 128);
}

export const allowPairingStart = createFixedWindowLimiter(6, 60_000, 10_000);
