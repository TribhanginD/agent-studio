// ─── Agent Studio: Chaos Testing Suite ────────────────────────────────────
// Injectors for artificial failures to test resilience, circuit breakers,
// and self-healing. Enable/disable via the chaos controller.

/**
 * Chaos mode — each injector can be independently enabled.
 */
export interface ChaosConfig {
    providerOutage: { enabled: boolean; provider?: string; failureRate: number };
    toolTimeout: { enabled: boolean; toolId?: string; delayMs: number };
    malformedResponse: { enabled: boolean; model?: string; rate: number };
}

/**
 * ChaosController: Manages chaos testing modes.
 */
export class ChaosController {
    private config: ChaosConfig;
    private metrics = {
        injectedFailures: 0,
        recoveries: 0,
        fallbacks: 0,
        totalCostImpact: 0,
    };

    constructor(config?: Partial<ChaosConfig>) {
        this.config = {
            providerOutage: { enabled: false, failureRate: 0.5, ...config?.providerOutage },
            toolTimeout: { enabled: false, delayMs: 30000, ...config?.toolTimeout },
            malformedResponse: { enabled: false, rate: 0.3, ...config?.malformedResponse },
        };
    }

    // ─── Injectors ────────────────────────────────────────────────────────

    /**
     * Provider Outage: Simulates a provider going down.
     * Returns true if the request should be failed.
     */
    shouldFailProvider(provider: string): boolean {
        const chaos = this.config.providerOutage;
        if (!chaos.enabled) return false;
        if (chaos.provider && chaos.provider !== provider) return false;

        if (Math.random() < chaos.failureRate) {
            this.metrics.injectedFailures++;
            return true;
        }
        return false;
    }

    /**
     * Tool Timeout: Returns artificial delay to inject before tool execution.
     * Returns 0 if no delay should be injected.
     */
    getToolDelay(toolId: string): number {
        const chaos = this.config.toolTimeout;
        if (!chaos.enabled) return 0;
        if (chaos.toolId && chaos.toolId !== toolId) return 0;

        this.metrics.injectedFailures++;
        return chaos.delayMs;
    }

    /**
     * Malformed Response: Returns true if the LLM response should be corrupted.
     */
    shouldCorruptResponse(model: string): boolean {
        const chaos = this.config.malformedResponse;
        if (!chaos.enabled) return false;
        if (chaos.model && chaos.model !== model) return false;

        if (Math.random() < chaos.rate) {
            this.metrics.injectedFailures++;
            return true;
        }
        return false;
    }

    /**
     * Generate a malformed response payload.
     */
    generateMalformedResponse(): string {
        const corruptions = [
            '{"partial": "json", broken',
            '```json\n{"this":"is","wrapped":"in","markdown":true}\n```',
            'I cannot assist with that request.',
            '{"result": undefined, "error": NaN}',
            '',
        ];
        return corruptions[Math.floor(Math.random() * corruptions.length)];
    }

    // ─── Control ──────────────────────────────────────────────────────────

    /**
     * Enable a specific chaos mode.
     */
    enable(mode: keyof ChaosConfig, overrides?: Record<string, unknown>): void {
        (this.config[mode] as any).enabled = true;
        if (overrides) {
            Object.assign(this.config[mode], overrides);
        }
    }

    /**
     * Disable a specific chaos mode.
     */
    disable(mode: keyof ChaosConfig): void {
        (this.config[mode] as any).enabled = false;
    }

    /**
     * Disable all chaos modes.
     */
    disableAll(): void {
        this.config.providerOutage.enabled = false;
        this.config.toolTimeout.enabled = false;
        this.config.malformedResponse.enabled = false;
    }

    /**
     * Record a successful recovery from an injected failure.
     */
    recordRecovery(): void {
        this.metrics.recoveries++;
    }

    /**
     * Record a successful fallback to another provider/tool.
     */
    recordFallback(costImpact: number = 0): void {
        this.metrics.fallbacks++;
        this.metrics.totalCostImpact += costImpact;
    }

    /**
     * Get chaos testing metrics.
     */
    getMetrics() {
        return {
            ...this.metrics,
            recoveryRate: this.metrics.injectedFailures > 0
                ? (this.metrics.recoveries + this.metrics.fallbacks) / this.metrics.injectedFailures
                : 0,
        };
    }

    /**
     * Get current chaos configuration.
     */
    getConfig(): Readonly<ChaosConfig> {
        return this.config;
    }
}
