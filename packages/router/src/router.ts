// ─── Agent Studio: Cost-Aware Model Router ────────────────────────────────
// Selects the optimal model for each request based on a weighted scoring
// function across cost, latency, context fit, and reliability.

import { encode } from 'gpt-tokenizer';
import type { ModelConfig, ChatMessage, ModelResponse, ToolDefinition } from '@agent-studio/shared';
import { ModelProviderRegistry, type ModelInfo, type ModelMetrics } from './provider-registry.js';
import { CircuitBreakerManager } from './circuit-breaker.js';

/**
 * Routing request — what the caller wants.
 */
export interface RoutingRequest {
    /** Messages to send to the model */
    messages: ChatMessage[];
    /** Preferred model (if specified, used directly without routing) */
    preferredModel?: string;
    /** Lock routing to a specific provider (e.g., 'groq', 'openai'). Still selects cheapest model within. */
    providerLock?: string;
    /** Required capability: tool calling */
    requiresToolCalling?: boolean;
    /** Required capability: streaming */
    requiresStreaming?: boolean;
    /** Task complexity hint from the planner agent */
    complexityHint?: 'simple' | 'moderate' | 'complex' | 'reasoning';
    /** Maximum cost allowed for this single call (USD) */
    maxCostUsd?: number;
    /** Expected output tokens (if known) */
    expectedOutputTokens?: number;
    /** Available tools (affects context size) */
    tools?: ToolDefinition[];
}

/**
 * Routing decision — which model was selected and why.
 */
export interface RoutingDecision {
    /** Selected model ID */
    modelId: string;
    /** Provider for the selected model */
    provider: string;
    /** Full model info */
    model: ModelInfo;
    /** Config to use for the call */
    config: ModelConfig;
    /** Estimated input tokens */
    estimatedInputTokens: number;
    /** Estimated cost for this call (USD) */
    estimatedCostUsd: number;
    /** Score breakdown */
    scores: ModelScore[];
    /** Reason for selection */
    reason: string;
}

interface ModelScore {
    modelId: string;
    totalScore: number;
    costScore: number;
    latencyScore: number;
    contextFitScore: number;
    reliabilityScore: number;
    complexityMatchScore: number;
}

/**
 * Weight configuration for the scoring function.
 */
export interface RouterWeights {
    cost: number;
    latency: number;
    contextFit: number;
    reliability: number;
    complexityMatch: number;
}

const DEFAULT_WEIGHTS: RouterWeights = {
    cost: 0.30,
    latency: 0.20,
    contextFit: 0.15,
    reliability: 0.20,
    complexityMatch: 0.15,
};

/**
 * ModelRouter: Cost-aware intelligent model selector.
 *
 * Scoring function:
 *   score = w1 * costScore + w2 * latencyScore + w3 * contextFitScore
 *         + w4 * reliabilityScore + w5 * complexityMatchScore
 *
 * Each score is normalized to [0, 1] where 1 is best.
 */
export class ModelRouter {
    private registry: ModelProviderRegistry;
    private circuitBreakers: CircuitBreakerManager;
    private weights: RouterWeights;

    constructor(
        registry?: ModelProviderRegistry,
        weights?: Partial<RouterWeights>,
    ) {
        this.registry = registry ?? new ModelProviderRegistry();
        this.circuitBreakers = new CircuitBreakerManager();
        this.weights = { ...DEFAULT_WEIGHTS, ...weights };
    }

    /**
     * Select the optimal model for a routing request.
     */
    route(request: RoutingRequest): RoutingDecision {
        // ── Handle explicit model preference ───────────────────────────────
        if (request.preferredModel) {
            const model = this.registry.getModel(request.preferredModel);
            if (model) {
                const inputTokens = this.estimateInputTokens(request);
                return this.buildDecision(model, inputTokens, request, [], 'Explicit model preference');
            }
        }

        // ── Estimate input tokens ──────────────────────────────────────────
        const estimatedInputTokens = this.estimateInputTokens(request);
        const estimatedOutputTokens = request.expectedOutputTokens ?? Math.min(estimatedInputTokens, 4096);

        // ── Filter eligible models ─────────────────────────────────────────
        let candidates = this.registry.getAllModels();

        // Filter by provider lock (if specified)
        if (request.providerLock) {
            const locked = candidates.filter((m) => m.provider === request.providerLock);
            if (locked.length === 0) {
                throw new RouterError(
                    `No models found for locked provider "${request.providerLock}". ` +
                    `Available providers: ${[...new Set(candidates.map((m) => m.provider))].join(', ')}`,
                );
            }
            candidates = locked;
        }

        // Filter by context window
        candidates = candidates.filter(
            (m) => m.contextWindow >= estimatedInputTokens + estimatedOutputTokens,
        );

        // Filter by capabilities
        if (request.requiresToolCalling) {
            candidates = candidates.filter((m) => m.supportsToolCalling);
        }
        if (request.requiresStreaming) {
            candidates = candidates.filter((m) => m.supportsStreaming);
        }

        // Filter out models with open circuit breakers
        candidates = candidates.filter((m) => {
            const metrics = this.registry.getMetrics(m.id);
            return metrics.circuitState !== 'open';
        });

        if (candidates.length === 0) {
            throw new RouterError(
                'No eligible models found matching the request requirements' +
                (request.providerLock ? ` within provider "${request.providerLock}"` : ''),
            );
        }

        // Filter by cost cap (if specified)
        if (request.maxCostUsd) {
            const withinBudget = candidates.filter((m) => {
                const cost = this.estimateCost(m, estimatedInputTokens, estimatedOutputTokens);
                return cost <= request.maxCostUsd!;
            });
            if (withinBudget.length > 0) {
                candidates = withinBudget;
            }
            // If nothing is within budget, keep all and let the scoring function handle it
        }

        // ── Score all candidates ───────────────────────────────────────────
        const scores = candidates.map((model) =>
            this.scoreModel(model, estimatedInputTokens, estimatedOutputTokens, request),
        );

        // Sort by total score descending
        scores.sort((a, b) => b.totalScore - a.totalScore);

        const winner = scores[0];
        const winnerModel = this.registry.getModel(winner.modelId)!;

        return this.buildDecision(
            winnerModel,
            estimatedInputTokens,
            request,
            scores,
            `Highest scoring model (${winner.totalScore.toFixed(3)})`,
        );
    }

    /**
     * Score a single model on all dimensions.
     */
    private scoreModel(
        model: ModelInfo,
        inputTokens: number,
        outputTokens: number,
        request: RoutingRequest,
    ): ModelScore {
        const metrics = this.registry.getMetrics(model.id);

        // ── Cost score: cheaper = better (normalized inverse) ──────────────
        const estimatedCost = this.estimateCost(model, inputTokens, outputTokens);
        const maxCost = 0.10; // $0.10 as reference max
        const costScore = Math.max(0, 1 - estimatedCost / maxCost);

        // ── Latency score: faster = better (normalized inverse) ────────────
        const maxLatency = 10_000; // 10s reference
        const latencyScore = Math.max(0, 1 - metrics.latencyP50 / maxLatency);

        // ── Context fit: how well the model's context window fits ──────────
        const totalRequired = inputTokens + outputTokens;
        const utilizationRatio = totalRequired / model.contextWindow;
        // Sweet spot: 10-70% utilization. Penalize both too small and too large.
        const contextFitScore = utilizationRatio < 0.01
            ? 0.5  // Model is way oversized
            : utilizationRatio > 0.9
                ? 0.2  // Cutting it too close
                : 1.0 - Math.abs(utilizationRatio - 0.3) * 0.5; // Peak around 30% utilization

        // ── Reliability: lower failure rate = better ───────────────────────
        const reliabilityScore = 1 - metrics.failureRate;

        // ── Complexity match: does the model's tier match the task? ────────
        const requestedTier = request.complexityHint ?? 'moderate';
        const tierOrder = { simple: 0, moderate: 1, complex: 2, reasoning: 3 };
        const tierDiff = Math.abs(tierOrder[model.complexityTier] - tierOrder[requestedTier]);
        const complexityMatchScore = 1 - tierDiff * 0.33;

        const totalScore =
            this.weights.cost * costScore +
            this.weights.latency * latencyScore +
            this.weights.contextFit * contextFitScore +
            this.weights.reliability * reliabilityScore +
            this.weights.complexityMatch * complexityMatchScore;

        return {
            modelId: model.id,
            totalScore,
            costScore,
            latencyScore,
            contextFitScore,
            reliabilityScore,
            complexityMatchScore,
        };
    }

    /**
     * Estimate cost for a model given token counts.
     */
    estimateCost(
        model: ModelInfo,
        inputTokens: number,
        outputTokens: number,
    ): number {
        return (
            (inputTokens / 1000) * model.costPer1kInput +
            (outputTokens / 1000) * model.costPer1kOutput
        );
    }

    /**
     * Estimate input tokens for a routing request.
     */
    private estimateInputTokens(request: RoutingRequest): number {
        let totalText = '';
        for (const msg of request.messages) {
            totalText += msg.content + ' ';
        }

        // Add tool definitions if present (they consume context)
        if (request.tools) {
            totalText += JSON.stringify(request.tools);
        }

        try {
            return encode(totalText).length;
        } catch {
            // Fallback: ~4 chars per token approximation
            return Math.ceil(totalText.length / 4);
        }
    }

    /**
     * Build a routing decision from the selected model.
     */
    private buildDecision(
        model: ModelInfo,
        inputTokens: number,
        request: RoutingRequest,
        scores: ModelScore[],
        reason: string,
    ): RoutingDecision {
        const estimatedOutputTokens = request.expectedOutputTokens ?? Math.min(inputTokens, 4096);

        return {
            modelId: model.id,
            provider: model.provider,
            model,
            config: {
                provider: model.provider as any,
                model: model.id,
                temperature: 0.7,
                maxTokens: estimatedOutputTokens,
            },
            estimatedInputTokens: inputTokens,
            estimatedCostUsd: this.estimateCost(model, inputTokens, estimatedOutputTokens),
            scores,
            reason,
        };
    }

    /**
     * Record a completed request for metrics tracking.
     */
    recordResult(modelId: string, latencyMs: number, success: boolean): void {
        this.registry.recordRequest(modelId, latencyMs, success);
    }

    /**
     * Get the underlying provider registry.
     */
    getRegistry(): ModelProviderRegistry {
        return this.registry;
    }
}

export class RouterError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RouterError';
    }
}
