export class ResourceOverloaded extends Error {
  readonly code = "VIBERACING_OVERLOADED";
  constructor(cause?: unknown) {
    super("temporarily_overloaded", { cause });
    this.name = "ResourceOverloaded";
  }
}

// Next can load separate class constructors in proxy and route bundles. Shared
// process gates must preserve the overload contract across those constructors.
export function isResourceOverloaded(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "VIBERACING_OVERLOADED"
  );
}

// A fixed-size, time-bounded application wait precedes acquisition of a DB slot.
export class ConcurrencyLimit {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(
    readonly maximum: number,
    readonly maximumWaiting = 0,
    readonly waitMilliseconds = 1000,
  ) {}
  get size(): number {
    return this.active;
  }
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.maximum) {
      if (this.waiting.length >= this.maximumWaiting) throw new ResourceOverloaded();
      await new Promise<void>((resolve, reject) => {
        const resume = () => {
          clearTimeout(timer);
          this.active += 1;
          resolve();
        };
        const timer = setTimeout(() => {
          const index = this.waiting.indexOf(resume);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new ResourceOverloaded());
        }, this.waitMilliseconds);
        this.waiting.push(resume);
      });
    } else {
      this.active += 1;
    }
    try {
      return await work();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

// Only canonical client keys from clientAddress() may be used by callers. This
// short negative cache is supplemental; PostgreSQL remains the shared authority.
export class RejectionBackoff {
  private readonly entries = new Map<string, number>();
  constructor(
    readonly maximum = 4096,
    readonly ttlMilliseconds = 1000,
  ) {}
  get size(): number {
    return this.entries.size;
  }
  has(key: string, now = Date.now()): boolean {
    const until = this.entries.get(key);
    if (until === undefined) return false;
    if (until <= now) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }
  add(key: string, now = Date.now(), expiresAt = Number.POSITIVE_INFINITY): void {
    // Fixed TTL and insertion order allow bounded cleanup without a full scan.
    for (const [oldKey, until] of this.entries) {
      if (until > now) break;
      this.entries.delete(oldKey);
    }
    if (this.entries.has(key) || this.entries.size >= this.maximum) return;
    this.entries.set(key, Math.min(now + this.ttlMilliseconds, expiresAt));
  }
}
