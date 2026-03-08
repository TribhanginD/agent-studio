// ─── Agent Studio: Circuit Breaker Management ────────────────────────────
// Per-provider circuit breakers using the opossum library.
// Prevents cascading failures when LLM providers go down.

import CircuitBreaker from 'opossum';

/**
 * Options for configuring a circuit breaker.
 */
export interface CircuitBreakerOptions {
    /** Time in ms after which a request is considered timed out */
    timeout: number;
    /** Error percentage at which to open the circuit */
    errorThresholdPercentage: number;
    /** Time in ms to wait before attempting to close the circuit */
    resetTimeout: number;
    /** Volume threshold — minimum number of requests before tripping */
    volumeThreshold: number;
    /** Rolling window for counting errors (ms) */
    rollingCountTimeout: number;
}

const DEFAULT_CB_OPTIONS: CircuitBreakerOptions = {
    timeout: 30_000,          // 30s per request max
    errorThresholdPercentage: 50,  // Open after 50% failure rate
    resetTimeout: 30_000,     // Try closing after 30s
    volumeThreshold: 5,       // Need at least 5 requests before judging
    rollingCountTimeout: 10_000,   // 10s rolling window
};

/**
 * CircuitBreakerManager: Creates and manages per-provider circuit breakers.
 *
 * When a provider's failure rate exceeds the threshold, its circuit opens
 * and the router automatically falls back to the next-best provider.
 */
export class CircuitBreakerManager {
    private breakers = new Map<string, CircuitBreaker>();
    private options: CircuitBreakerOptions;

    constructor(options?: Partial<CircuitBreakerOptions>) {
        this.options = { ...DEFAULT_CB_OPTIONS, ...options };
    }

    /**
     * Get or create a circuit breaker for a provider.
     */
    getBreaker<T>(
        providerId: string,
        fn: (...args: unknown[]) => Promise<T>,
    ): CircuitBreaker<unknown[], T> {
        let breaker = this.breakers.get(providerId);

        if (!breaker) {
            breaker = new CircuitBreaker(fn, {
                timeout: this.options.timeout,
                errorThresholdPercentage: this.options.errorThresholdPercentage,
                resetTimeout: this.options.resetTimeout,
                volumeThreshold: this.options.volumeThreshold,
                rollingCountTimeout: this.options.rollingCountTimeout,
                name: `provider:${providerId}`,
            });

            // Log state changes
            breaker.on('open', () => {
                console.warn(`[CircuitBreaker] Provider "${providerId}" circuit OPENED — too many failures`);
            });
            breaker.on('halfOpen', () => {
                console.info(`[CircuitBreaker] Provider "${providerId}" circuit HALF-OPEN — testing recovery`);
            });
            breaker.on('close', () => {
                console.info(`[CircuitBreaker] Provider "${providerId}" circuit CLOSED — provider recovered`);
            });
            breaker.on('fallback', () => {
                console.warn(`[CircuitBreaker] Provider "${providerId}" — using fallback`);
            });

            this.breakers.set(providerId, breaker);
        }

        return breaker as CircuitBreaker<unknown[], T>;
    }

    /**
     * Execute a function through the circuit breaker for a given provider.
     */
    async execute<T>(
        providerId: string,
        fn: () => Promise<T>,
    ): Promise<T> {
        const breaker = this.getBreaker(providerId, fn);
        return breaker.fire() as Promise<T>;
    }

    /**
     * Get the current state of a provider's circuit breaker.
     */
    getState(providerId: string): 'closed' | 'open' | 'half-open' | 'unknown' {
        const breaker = this.breakers.get(providerId);
        if (!breaker) return 'unknown';

        if (breaker.opened) return 'open';
        if (breaker.halfOpen) return 'half-open';
        return 'closed';
    }

    /**
     * Get statistics for a provider's circuit breaker.
     */
    getStats(providerId: string): Record<string, unknown> | undefined {
        const breaker = this.breakers.get(providerId);
        if (!breaker) return undefined;
        return breaker.stats as unknown as Record<string, unknown>;
    }

    /**
     * Reset a provider's circuit breaker.
     */
    reset(providerId: string): void {
        const breaker = this.breakers.get(providerId);
        if (breaker) {
            breaker.close();
        }
    }

    /**
     * Reset all circuit breakers.
     */
    resetAll(): void {
        for (const breaker of this.breakers.values()) {
            breaker.close();
        }
    }

    /**
     * Shutdown all circuit breakers.
     */
    shutdown(): void {
        for (const breaker of this.breakers.values()) {
            breaker.shutdown();
        }
        this.breakers.clear();
    }
}
