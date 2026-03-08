// ─── Agent Studio: Model Provider Registry ───────────────────────────────
// Tracks available models, their pricing, capabilities, and live metrics.

/**
 * Model metadata for cost and capability analysis.
 */
export interface ModelInfo {
    /** Model identifier (e.g., "gpt-4o", "claude-4-sonnet") */
    id: string;
    /** Provider identifier */
    provider: string;
    /** Human-readable name */
    name: string;
    /** Cost per 1K input tokens (USD) */
    costPer1kInput: number;
    /** Cost per 1K output tokens (USD) */
    costPer1kOutput: number;
    /** Maximum context window size (tokens) */
    contextWindow: number;
    /** Maximum output tokens */
    maxOutputTokens: number;
    /** Whether this model supports tool/function calling */
    supportsToolCalling: boolean;
    /** Whether this model supports streaming */
    supportsStreaming: boolean;
    /** Task complexity tier: 'simple' | 'moderate' | 'complex' | 'reasoning' */
    complexityTier: 'simple' | 'moderate' | 'complex' | 'reasoning';
}

/**
 * Live metrics for a model, updated during runtime.
 */
export interface ModelMetrics {
    /** Rolling P50 latency (ms) */
    latencyP50: number;
    /** Rolling P95 latency (ms) */
    latencyP95: number;
    /** Total requests sent */
    totalRequests: number;
    /** Total failures */
    totalFailures: number;
    /** Current failure rate (0.0 - 1.0) */
    failureRate: number;
    /** Circuit breaker state */
    circuitState: 'closed' | 'open' | 'half-open';
    /** Last updated timestamp */
    lastUpdated: number;
}

/**
 * ModelProviderRegistry: Central catalog of all available models.
 */
export class ModelProviderRegistry {
    private models = new Map<string, ModelInfo>();
    private metrics = new Map<string, ModelMetrics>();

    constructor() {
        this.registerDefaults();
    }

    /**
     * Register a model with its metadata.
     */
    registerModel(info: ModelInfo): void {
        this.models.set(info.id, info);
        if (!this.metrics.has(info.id)) {
            this.metrics.set(info.id, this.createDefaultMetrics());
        }
    }

    /**
     * Get model info by ID.
     */
    getModel(modelId: string): ModelInfo | undefined {
        return this.models.get(modelId);
    }

    /**
     * Get all models for a provider.
     */
    getModelsByProvider(provider: string): ModelInfo[] {
        return [...this.models.values()].filter((m) => m.provider === provider);
    }

    /**
     * Get all available models.
     */
    getAllModels(): ModelInfo[] {
        return [...this.models.values()];
    }

    /**
     * Get models that fit a given context window requirement.
     */
    getModelsForContext(requiredTokens: number): ModelInfo[] {
        return [...this.models.values()].filter(
            (m) => m.contextWindow >= requiredTokens,
        );
    }

    /**
     * Get or initialize metrics for a model.
     */
    getMetrics(modelId: string): ModelMetrics {
        let metrics = this.metrics.get(modelId);
        if (!metrics) {
            metrics = this.createDefaultMetrics();
            this.metrics.set(modelId, metrics);
        }
        return metrics;
    }

    /**
     * Record a completed request for metrics tracking.
     */
    recordRequest(modelId: string, latencyMs: number, success: boolean): void {
        const metrics = this.getMetrics(modelId);
        metrics.totalRequests++;
        if (!success) metrics.totalFailures++;

        // Simple exponential moving average for latency
        const alpha = 0.1;
        metrics.latencyP50 = metrics.latencyP50 * (1 - alpha) + latencyMs * alpha;
        metrics.latencyP95 = Math.max(metrics.latencyP95 * (1 - alpha) + latencyMs * alpha, latencyMs);

        // Update failure rate (rolling window approximation)
        metrics.failureRate = metrics.totalRequests > 0
            ? metrics.totalFailures / metrics.totalRequests
            : 0;

        metrics.lastUpdated = Date.now();
    }

    private createDefaultMetrics(): ModelMetrics {
        return {
            latencyP50: 1000,
            latencyP95: 3000,
            totalRequests: 0,
            totalFailures: 0,
            failureRate: 0,
            circuitState: 'closed',
            lastUpdated: Date.now(),
        };
    }

    /**
     * Register default model catalog with current pricing.
     */
    private registerDefaults(): void {
        // ── OpenAI ──
        this.registerModel({
            id: 'gpt-4o', provider: 'openai', name: 'GPT-4o',
            costPer1kInput: 0.0025, costPer1kOutput: 0.01,
            contextWindow: 128000, maxOutputTokens: 16384,
            supportsToolCalling: true, supportsStreaming: true,
            complexityTier: 'complex',
        });
        this.registerModel({
            id: 'gpt-4o-mini', provider: 'openai', name: 'GPT-4o Mini',
            costPer1kInput: 0.000150, costPer1kOutput: 0.000600,
            contextWindow: 128000, maxOutputTokens: 16384,
            supportsToolCalling: true, supportsStreaming: true,
            complexityTier: 'simple',
        });
        this.registerModel({
            id: 'o3-mini', provider: 'openai', name: 'o3 Mini',
            costPer1kInput: 0.0011, costPer1kOutput: 0.0044,
            contextWindow: 200000, maxOutputTokens: 100000,
            supportsToolCalling: true, supportsStreaming: true,
            complexityTier: 'reasoning',
        });

        // ── Anthropic ──
        this.registerModel({
            id: 'claude-4-sonnet', provider: 'anthropic', name: 'Claude 4 Sonnet',
            costPer1kInput: 0.003, costPer1kOutput: 0.015,
            contextWindow: 200000, maxOutputTokens: 8192,
            supportsToolCalling: true, supportsStreaming: true,
            complexityTier: 'complex',
        });
        this.registerModel({
            id: 'claude-4-haiku', provider: 'anthropic', name: 'Claude 4 Haiku',
            costPer1kInput: 0.0008, costPer1kOutput: 0.004,
            contextWindow: 200000, maxOutputTokens: 8192,
            supportsToolCalling: true, supportsStreaming: true,
            complexityTier: 'simple',
        });

        // ── Google ──
        this.registerModel({
            id: 'gemini-2.5-pro', provider: 'google', name: 'Gemini 2.5 Pro',
            costPer1kInput: 0.00125, costPer1kOutput: 0.005,
            contextWindow: 1000000, maxOutputTokens: 65536,
            supportsToolCalling: true, supportsStreaming: true,
            complexityTier: 'complex',
        });
        this.registerModel({
            id: 'gemini-2.5-flash', provider: 'google', name: 'Gemini 2.5 Flash',
            costPer1kInput: 0.000075, costPer1kOutput: 0.0003,
            contextWindow: 1000000, maxOutputTokens: 65536,
            supportsToolCalling: true, supportsStreaming: true,
            complexityTier: 'simple',
        });

        // ── Groq ──
        this.registerModel({
            id: 'llama-3.3-70b-versatile', provider: 'groq', name: 'LLaMA 3.3 70B Versatile',
            costPer1kInput: 0.00059, costPer1kOutput: 0.00079,
            contextWindow: 131072, maxOutputTokens: 32768,
            supportsToolCalling: true, supportsStreaming: true,
            complexityTier: 'complex',
        });
        this.registerModel({
            id: 'llama-3.1-8b-instant', provider: 'groq', name: 'LLaMA 3.1 8B Instant',
            costPer1kInput: 0.00005, costPer1kOutput: 0.00008,
            contextWindow: 131072, maxOutputTokens: 8192, // Although max completion is 131072, capping at 8192 as standard max output
            supportsToolCalling: true, supportsStreaming: true,
            complexityTier: 'simple',
        });
        this.registerModel({
            id: 'openai/gpt-oss-120b', provider: 'groq', name: 'OpenAI GPT OSS 120B',
            costPer1kInput: 0.00015, costPer1kOutput: 0.00060,
            contextWindow: 131072, maxOutputTokens: 65536,
            supportsToolCalling: true, supportsStreaming: true,
            complexityTier: 'reasoning',
        });
        this.registerModel({
            id: 'openai/gpt-oss-20b', provider: 'groq', name: 'OpenAI GPT OSS 20B',
            costPer1kInput: 0.000075, costPer1kOutput: 0.00030,
            contextWindow: 131072, maxOutputTokens: 65536,
            supportsToolCalling: true, supportsStreaming: true,
            complexityTier: 'moderate',
        });
    }
}
