// ─── Agent Studio: Phase 5 Runtime Tests ──────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { ReflectorAgent, ShortTermMemory, LongTermMemory, InMemoryVectorStore, PolicyEngine } from '../src/index.js';

// ─── Reflector Agent Tests ────────────────────────────────────────────────

describe('ReflectorAgent', () => {
    let reflector: ReflectorAgent;

    beforeEach(() => {
        reflector = new ReflectorAgent({ maxRetries: 3 });
    });

    it('should classify schema errors', () => {
        expect(reflector.classifyError('Expected type string but got number')).toBe('schema_mismatch');
    });

    it('should classify tool failures', () => {
        expect(reflector.classifyError('Tool web-search failed: API returned 500')).toBe('tool_failure');
    });

    it('should classify rate limits', () => {
        expect(reflector.classifyError('429 Too Many Requests')).toBe('rate_limited');
    });

    it('should classify LLM refusals', () => {
        expect(reflector.classifyError('I cannot assist with that request due to content policy')).toBe('llm_refusal');
    });

    it('should reflect with prompt revision for schema errors', () => {
        const result = reflector.reflect({
            originalPrompt: 'Generate a JSON report',
            error: 'Expected type string but got number in field "summary"',
            attempt: 1,
            nodeId: 'exec-1',
            agentType: 'executor',
        });

        expect(result.errorCategory).toBe('schema_mismatch');
        expect(result.shouldRetry).toBe(true);
        expect(result.revisedPrompt).toContain('RETRY CONTEXT');
        expect(result.revisedPrompt).toContain('schema');
        expect(result.confidenceScore).toBeGreaterThan(0.5);
    });

    it('should not retry LLM refusals', () => {
        const result = reflector.reflect({
            originalPrompt: 'Original prompt',
            error: 'I refuse to assist with that',
            attempt: 1,
            nodeId: 'exec-1',
            agentType: 'executor',
        });

        expect(result.shouldRetry).toBe(false);
    });

    it('should decrease confidence with each retry', () => {
        const r1 = reflector.reflect({ originalPrompt: 'test', error: 'schema validation failed', attempt: 1, nodeId: 'n1', agentType: 'executor' });
        const r2 = reflector.reflect({ originalPrompt: 'test', error: 'schema validation failed', attempt: 2, nodeId: 'n1', agentType: 'executor' });
        const r3 = reflector.reflect({ originalPrompt: 'test', error: 'schema validation failed', attempt: 3, nodeId: 'n1', agentType: 'executor' });

        expect(r1.confidenceScore).toBeGreaterThan(r2.confidenceScore);
        expect(r2.confidenceScore).toBeGreaterThan(r3.confidenceScore);
    });

    it('should compute exponential backoff', () => {
        expect(reflector.getBackoffMs(1)).toBe(1000);
        expect(reflector.getBackoffMs(2)).toBe(2000);
        expect(reflector.getBackoffMs(3)).toBe(4000);
    });
});

// ─── Short-Term Memory Tests ──────────────────────────────────────────────

describe('ShortTermMemory', () => {
    it('should add messages and count tokens', () => {
        const mem = new ShortTermMemory(1000);
        mem.addMessage({ role: 'system', content: 'You are a helpful assistant.' });
        mem.addMessage({ role: 'user', content: 'Hello, world!' });

        expect(mem.getContext()).toHaveLength(2);
        expect(mem.getTotalTokens()).toBeGreaterThan(0);
    });

    it('should trim low-priority messages when over budget', () => {
        const mem = new ShortTermMemory(50); // Very small budget
        mem.addMessage({ role: 'system', content: 'System message that should be retained.' });
        mem.addMessage({ role: 'user', content: 'First user message with moderate length.' });
        mem.addMessage({ role: 'assistant', content: 'A very long response that has many tokens and should be considered for trimming when we reach the budget limit.' });
        mem.addMessage({ role: 'user', content: 'Another query from the user.' });

        expect(mem.getTotalTokens()).toBeLessThanOrEqual(50);
        // System message should always be retained
        expect(mem.getContext().some((m) => m.role === 'system')).toBe(true);
    });

    it('should cache and retrieve prompt responses', () => {
        const mem = new ShortTermMemory();
        mem.cacheResponse('What is 2+2?', 'The answer is 4.');

        expect(mem.getCachedResponse('What is 2+2?')).toBe('The answer is 4.');
        expect(mem.getCachedResponse('What is 3+3?')).toBeNull();
    });
});

// ─── Long-Term Memory Tests ──────────────────────────────────────────────

describe('LongTermMemory', () => {
    it('should store and retrieve documents', async () => {
        const store = new InMemoryVectorStore();
        const ltm = new LongTermMemory(store, { similarityThreshold: 0.3 });

        await ltm.store({
            id: 'doc-1',
            content: 'Agent executed a web search for market data.',
            metadata: { timestamp: Date.now(), importance: 0.8, source: 'agent_output' },
        });

        await ltm.store({
            id: 'doc-2',
            content: 'Tool returned error: API rate limited.',
            metadata: { timestamp: Date.now() - 86400000, importance: 0.3, source: 'tool_result' },
        });

        const results = await ltm.retrieve([], 5);
        expect(results).toHaveLength(2);
    });

    it('should forget documents', async () => {
        const store = new InMemoryVectorStore();
        const ltm = new LongTermMemory(store);

        await ltm.store({ id: 'doc-1', content: 'Test', metadata: { timestamp: Date.now(), importance: 0.5, source: 'summary' } });
        await ltm.forget(['doc-1']);

        const results = await ltm.retrieve([], 5);
        expect(results).toHaveLength(0);
    });
});

// ─── Policy Engine Tests ──────────────────────────────────────────────────

describe('PolicyEngine', () => {
    let engine: PolicyEngine;

    beforeEach(() => {
        engine = new PolicyEngine();
        engine.loadDefaults();
    });

    it('should have 5 default policies loaded', () => {
        expect(engine.getRules()).toHaveLength(5);
    });

    it('should abort when cost cap exceeded', () => {
        const result = engine.evaluate({
            totalCostUsd: 6.0,
            maxCostUsd: 5.0,
            stepCount: 5,
        }, 'per-step');

        expect(result.allowed).toBe(false);
        expect(result.action).toBe('abort');
        expect(result.matchedRules[0].name).toBe('cost-cap');
    });

    it('should warn at 80% cost', () => {
        const result = engine.evaluate({
            totalCostUsd: 4.5,
            maxCostUsd: 5.0,
            stepCount: 5,
        }, 'per-step');

        expect(result.allowed).toBe(true);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings[0]).toContain('cost-warning-80pct');
    });

    it('should deny tool calls with missing permissions', () => {
        const result = engine.evaluate({
            toolRequiredRole: 'admin',
            userRoles: ['developer'],
        }, 'per-call');

        expect(result.allowed).toBe(false);
        expect(result.action).toBe('deny');
    });

    it('should allow tool calls with correct permissions', () => {
        const result = engine.evaluate({
            toolRequiredRole: 'developer',
            userRoles: ['developer', 'admin'],
        }, 'per-call');

        expect(result.allowed).toBe(true);
    });

    it('should abort runaway execution (>50 steps)', () => {
        const result = engine.evaluate({
            stepCount: 55,
            totalCostUsd: 1.0,
            maxCostUsd: 10.0,
        }, 'per-step');

        expect(result.allowed).toBe(false);
        expect(result.matchedRules.some((r) => r.name === 'max-steps')).toBe(true);
    });

    it('should support custom rules', () => {
        engine.addRule({
            name: 'block-gpt4o',
            description: 'Block GPT-4o usage during budget optimization',
            type: 'per-step',
            enabled: true,
            priority: 80,
            condition: { field: 'model', operator: 'eq', value: 'gpt-4o' },
            action: 'deny',
        });

        const result = engine.evaluate({ model: 'gpt-4o' }, 'per-step');
        expect(result.allowed).toBe(false);
    });
});
