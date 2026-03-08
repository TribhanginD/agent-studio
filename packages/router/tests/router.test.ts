// ─── Agent Studio: Router Package Tests ───────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import {
    ModelRouter,
    ModelProviderRegistry,
    CostTracker,
    CostCapError,
} from '../src/index.js';
import type { RoutingRequest } from '../src/index.js';

// ─── Model Router Tests ───────────────────────────────────────────────────

describe('ModelRouter', () => {
    let router: ModelRouter;

    beforeEach(() => {
        router = new ModelRouter();
    });

    it('should select a model based on scoring', () => {
        const request: RoutingRequest = {
            messages: [{ role: 'user', content: 'Hello, world!' }],
            complexityHint: 'simple',
        };

        const decision = router.route(request);
        expect(decision.modelId).toBeDefined();
        expect(decision.provider).toBeDefined();
        expect(decision.estimatedCostUsd).toBeGreaterThanOrEqual(0);
        expect(decision.scores.length).toBeGreaterThan(0);
    });

    it('should prefer cheaper models for simple tasks', () => {
        const request: RoutingRequest = {
            messages: [{ role: 'user', content: 'Say hi' }],
            complexityHint: 'simple',
        };

        const decision = router.route(request);
        // Simple tasks should route to cheaper models
        const model = decision.model;
        expect(model.complexityTier).toBe('simple');
    });

    it('should respect explicit model preference', () => {
        const request: RoutingRequest = {
            messages: [{ role: 'user', content: 'Hello' }],
            preferredModel: 'gpt-4o',
        };

        const decision = router.route(request);
        expect(decision.modelId).toBe('gpt-4o');
        expect(decision.reason).toContain('Explicit');
    });

    it('should filter by tool calling support', () => {
        const request: RoutingRequest = {
            messages: [{ role: 'user', content: 'Use a tool' }],
            requiresToolCalling: true,
        };

        const decision = router.route(request);
        expect(decision.model.supportsToolCalling).toBe(true);
    });

    it('should estimate costs correctly', () => {
        const registry = router.getRegistry();
        const gpt4o = registry.getModel('gpt-4o')!;

        const cost = router.estimateCost(gpt4o, 1000, 500);
        // gpt-4o: $0.0025/1K input + $0.01/1K output
        const expected = (1000 / 1000) * 0.0025 + (500 / 1000) * 0.01;
        expect(cost).toBeCloseTo(expected, 6);
    });

    it('should provide score breakdowns', () => {
        const request: RoutingRequest = {
            messages: [{ role: 'user', content: 'Hello' }],
            complexityHint: 'complex',
        };

        const decision = router.route(request);
        const topScore = decision.scores[0];

        expect(topScore.costScore).toBeGreaterThanOrEqual(0);
        expect(topScore.latencyScore).toBeGreaterThanOrEqual(0);
        expect(topScore.reliabilityScore).toBeGreaterThanOrEqual(0);
        expect(topScore.complexityMatchScore).toBeGreaterThanOrEqual(0);
    });

    // ── Provider Lock Tests ──────────────────────────────────────────────

    it('should lock routing to a specific provider', () => {
        const request: RoutingRequest = {
            messages: [{ role: 'user', content: 'Hello' }],
            providerLock: 'groq',
            complexityHint: 'simple',
        };

        const decision = router.route(request);
        expect(decision.provider).toBe('groq');
        // Should still pick the cheapest simple Groq model
        expect(decision.model.complexityTier).toBe('simple');
    });

    it('should use cheapest Groq model for simple tasks when locked', () => {
        const request: RoutingRequest = {
            messages: [{ role: 'user', content: 'Say hi' }],
            providerLock: 'groq',
            complexityHint: 'simple',
        };

        const decision = router.route(request);
        expect(decision.provider).toBe('groq');
        // LLaMA 3.1 8B is the cheapest Groq simple model
        expect(decision.estimatedCostUsd).toBeLessThan(0.01);
    });

    it('should use complex Groq model for complex tasks when locked', () => {
        const request: RoutingRequest = {
            messages: [{ role: 'user', content: 'Analyze this complex dataset.' }],
            providerLock: 'groq',
            complexityHint: 'complex',
        };

        const decision = router.route(request);
        expect(decision.provider).toBe('groq');
        expect(decision.modelId).toBe('llama-3.3-70b-versatile');
    });

    it('should throw for unknown locked provider', () => {
        const request: RoutingRequest = {
            messages: [{ role: 'user', content: 'Hello' }],
            providerLock: 'nonexistent',
        };

        expect(() => router.route(request)).toThrow('nonexistent');
    });

    it('should lock to openai provider and still score within it', () => {
        const request: RoutingRequest = {
            messages: [{ role: 'user', content: 'Hello' }],
            providerLock: 'openai',
            complexityHint: 'simple',
        };

        const decision = router.route(request);
        expect(decision.provider).toBe('openai');
    });
});

// ─── Model Provider Registry Tests ────────────────────────────────────────

describe('ModelProviderRegistry', () => {
    let registry: ModelProviderRegistry;

    beforeEach(() => {
        registry = new ModelProviderRegistry();
    });

    it('should have default models registered', () => {
        expect(registry.getAllModels().length).toBeGreaterThan(9);
        expect(registry.getModel('gpt-4o')).toBeDefined();
        expect(registry.getModel('claude-4-sonnet')).toBeDefined();
        expect(registry.getModel('gemini-2.5-pro')).toBeDefined();
        expect(registry.getModel('llama-3.3-70b-versatile')).toBeDefined();
    });

    it('should filter by provider', () => {
        const openaiModels = registry.getModelsByProvider('openai');
        expect(openaiModels.length).toBeGreaterThan(0);
        expect(openaiModels.every((m) => m.provider === 'openai')).toBe(true);

        const groqModels = registry.getModelsByProvider('groq');
        expect(groqModels.length).toBe(4);
        expect(groqModels.every((m) => m.provider === 'groq')).toBe(true);
    });

    it('should filter by context window', () => {
        const largeContext = registry.getModelsForContext(500_000);
        expect(largeContext.length).toBeGreaterThan(0);
        expect(largeContext.every((m) => m.contextWindow >= 500_000)).toBe(true);
    });

    it('should track metrics', () => {
        registry.recordRequest('gpt-4o', 1500, true);
        registry.recordRequest('gpt-4o', 2000, true);
        registry.recordRequest('gpt-4o', 10000, false);

        const metrics = registry.getMetrics('gpt-4o');
        expect(metrics.totalRequests).toBe(3);
        expect(metrics.totalFailures).toBe(1);
        expect(metrics.failureRate).toBeCloseTo(1 / 3, 2);
    });
});

// ─── Cost Tracker Tests ───────────────────────────────────────────────────

describe('CostTracker', () => {
    it('should track cumulative costs', () => {
        const tracker = new CostTracker(5.0);

        tracker.record({
            modelId: 'gpt-4o', provider: 'openai',
            tokensIn: 1000, tokensOut: 500,
            costUsd: 0.05, stepId: 's1', timestamp: Date.now(),
        });

        tracker.record({
            modelId: 'gpt-4o-mini', provider: 'openai',
            tokensIn: 2000, tokensOut: 1000,
            costUsd: 0.01, stepId: 's2', timestamp: Date.now(),
        });

        expect(tracker.getTotalCost()).toBeCloseTo(0.06, 4);
        expect(tracker.getRemainingBudget()).toBeCloseTo(4.94, 4);
    });

    it('should throw on cost cap exceeded', () => {
        const tracker = new CostTracker(0.10);

        tracker.record({
            modelId: 'gpt-4o', provider: 'openai',
            tokensIn: 1000, tokensOut: 500,
            costUsd: 0.05, stepId: 's1', timestamp: Date.now(),
        });

        expect(() => tracker.record({
            modelId: 'gpt-4o', provider: 'openai',
            tokensIn: 1000, tokensOut: 500,
            costUsd: 0.08, stepId: 's2', timestamp: Date.now(),
        })).toThrow(CostCapError);
    });

    it('should emit warning at 80% threshold', () => {
        const tracker = new CostTracker(1.0);

        const result1 = tracker.record({
            modelId: 'gpt-4o', provider: 'openai',
            tokensIn: 1000, tokensOut: 500,
            costUsd: 0.50, stepId: 's1', timestamp: Date.now(),
        });
        expect(result1.warning).toBeUndefined();

        const result2 = tracker.record({
            modelId: 'gpt-4o', provider: 'openai',
            tokensIn: 1000, tokensOut: 500,
            costUsd: 0.35, stepId: 's2', timestamp: Date.now(),
        });
        expect(result2.warning).toContain('Cost warning');
    });

    it('should provide cost breakdown', () => {
        const tracker = new CostTracker(10.0);

        tracker.record({ modelId: 'gpt-4o', provider: 'openai', tokensIn: 1000, tokensOut: 500, costUsd: 0.05, stepId: 's1', timestamp: Date.now() });
        tracker.record({ modelId: 'claude-4-sonnet', provider: 'anthropic', tokensIn: 1000, tokensOut: 500, costUsd: 0.08, stepId: 's2', timestamp: Date.now() });
        tracker.record({ modelId: 'gpt-4o', provider: 'openai', tokensIn: 2000, tokensOut: 1000, costUsd: 0.10, stepId: 's3', timestamp: Date.now() });

        const byModel = tracker.getCostByModel();
        expect(byModel['gpt-4o']).toBeCloseTo(0.15, 4);
        expect(byModel['claude-4-sonnet']).toBeCloseTo(0.08, 4);

        const byProvider = tracker.getCostByProvider();
        expect(byProvider['openai']).toBeCloseTo(0.15, 4);
        expect(byProvider['anthropic']).toBeCloseTo(0.08, 4);
    });
});
