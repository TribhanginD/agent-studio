// ─── Agent Studio: Rate Limiter ───────────────────────────────────────────
// Redis-backed sliding window rate limiter for tool call frequency control.

import type Redis from 'ioredis';

/**
 * RateLimiter: Implements a sliding window rate limit using Redis.
 *
 * Each tool+user combination gets a Redis sorted set that tracks call timestamps.
 * Old entries are automatically pruned on each check.
 */
export class RateLimiter {
    constructor(private redis: Redis) { }

    /**
     * Check if a call is within rate limits and increment the counter.
     * Uses a Redis sorted set with timestamps as scores.
     *
     * @param key - Unique key (e.g., "tool:web-search:user:123")
     * @param maxCalls - Maximum allowed calls in the window
     * @param windowSeconds - Time window in seconds
     * @returns true if the call is allowed, false if rate limited
     */
    async checkAndIncrement(
        key: string,
        maxCalls: number,
        windowSeconds: number,
    ): Promise<boolean> {
        const now = Date.now();
        const windowStart = now - windowSeconds * 1000;

        // Atomic pipeline: prune old entries, count current, add new
        const pipeline = this.redis.pipeline();

        // Remove entries outside the window
        pipeline.zremrangebyscore(key, 0, windowStart);

        // Count entries in current window
        pipeline.zcard(key);

        // Add current call
        pipeline.zadd(key, now.toString(), `${now}:${Math.random()}`);

        // Set TTL to auto-cleanup
        pipeline.expire(key, windowSeconds + 1);

        const results = await pipeline.exec();
        if (!results) return true;

        // zcard result is at index 1
        const currentCount = (results[1]?.[1] as number) ?? 0;

        if (currentCount >= maxCalls) {
            // Over limit — remove the entry we just added
            await this.redis.zremrangebyscore(key, now, now);
            return false;
        }

        return true;
    }

    /**
     * Get the current call count for a key.
     */
    async getCurrentCount(key: string, windowSeconds: number): Promise<number> {
        const windowStart = Date.now() - windowSeconds * 1000;
        await this.redis.zremrangebyscore(key, 0, windowStart);
        return this.redis.zcard(key);
    }

    /**
     * Reset the rate limit for a key.
     */
    async reset(key: string): Promise<void> {
        await this.redis.del(key);
    }
}

/**
 * In-memory rate limiter for development/testing (no Redis required).
 */
export class InMemoryRateLimiter {
    private windows = new Map<string, number[]>();

    async checkAndIncrement(
        key: string,
        maxCalls: number,
        windowSeconds: number,
    ): Promise<boolean> {
        const now = Date.now();
        const windowStart = now - windowSeconds * 1000;

        // Get or create window for this key
        let timestamps = this.windows.get(key) ?? [];

        // Prune old entries
        timestamps = timestamps.filter((t) => t > windowStart);

        if (timestamps.length >= maxCalls) {
            this.windows.set(key, timestamps);
            return false;
        }

        timestamps.push(now);
        this.windows.set(key, timestamps);
        return true;
    }

    async getCurrentCount(key: string, windowSeconds: number): Promise<number> {
        const windowStart = Date.now() - windowSeconds * 1000;
        const timestamps = this.windows.get(key) ?? [];
        return timestamps.filter((t) => t > windowStart).length;
    }

    async reset(key: string): Promise<void> {
        this.windows.delete(key);
    }
}
