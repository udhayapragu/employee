export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check: (key: string, now?: number) => RateLimitDecision;
  reset: (key: string) => void;
}

/**
 * Sliding-window limiter kept in process memory. Each serverless instance keeps its own counters,
 * so this is a deterrent against bursts, not a global quota. Use the database-backed quotas in the
 * research service for limits that must hold across instances.
 */
export function createRateLimiter(options: { windowMs: number; max: number; maxKeys?: number }): RateLimiter {
  const maxKeys = options.maxKeys ?? 10_000;
  const hits = new Map<string, number[]>();

  return {
    check(key, now = Date.now()) {
      const windowStart = now - options.windowMs;
      const recent = (hits.get(key) ?? []).filter((time) => time > windowStart);

      if (recent.length >= options.max) {
        const retryAt = recent[0] + options.windowMs;
        hits.set(key, recent);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000)) };
      }

      recent.push(now);
      if (!hits.has(key) && hits.size >= maxKeys) {
        const oldestKey = hits.keys().next().value;
        if (oldestKey !== undefined) hits.delete(oldestKey);
      }
      hits.set(key, recent);
      return { allowed: true, retryAfterSeconds: 0 };
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
