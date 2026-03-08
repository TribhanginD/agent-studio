// ─── Agent Studio: Phase 6 Runtime Tests ──────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { PluginRegistry, GraphOptimizer, TenantManager, TokenAccountant } from '../src/index.js';

// ─── Plugin System Tests ──────────────────────────────────────────────────

describe('PluginRegistry', () => {
    let registry: PluginRegistry;

    beforeEach(() => { registry = new PluginRegistry(); });

    it('should register and list plugins', () => {
        registry.register({ name: 'logger', version: '1.0', description: 'Logs events', hooks: {} });
        registry.register({ name: 'metrics', version: '1.0', description: 'Records metrics', hooks: {} });

        expect(registry.list()).toHaveLength(2);
    });

    it('should prevent duplicate registration', () => {
        registry.register({ name: 'logger', version: '1.0', description: '', hooks: {} });
        expect(() => registry.register({ name: 'logger', version: '1.1', description: '', hooks: {} })).toThrow();
    });

    it('should load plugins in dependency order', async () => {
        const order: string[] = [];

        registry.register({ name: 'db', version: '1.0', description: '', hooks: { onLoad: async () => { order.push('db'); } } });
        registry.register({ name: 'cache', version: '1.0', description: '', dependencies: ['db'], hooks: { onLoad: async () => { order.push('cache'); } } });
        registry.register({ name: 'app', version: '1.0', description: '', dependencies: ['cache'], hooks: { onLoad: async () => { order.push('app'); } } });

        await registry.loadAll();
        expect(order).toEqual(['db', 'cache', 'app']);
    });

    it('should detect missing dependencies', () => {
        registry.register({ name: 'app', version: '1.0', description: '', dependencies: ['db'], hooks: {} });
        expect(registry.loadAll()).rejects.toThrow('depends on "db"');
    });

    it('should detect circular dependencies', () => {
        registry.register({ name: 'a', version: '1.0', description: '', dependencies: ['b'], hooks: {} });
        registry.register({ name: 'b', version: '1.0', description: '', dependencies: ['a'], hooks: {} });
        expect(registry.loadAll()).rejects.toThrow('Circular');
    });
});

// ─── Graph Optimizer Tests ────────────────────────────────────────────────

describe('GraphOptimizer', () => {
    let optimizer: GraphOptimizer;

    beforeEach(() => { optimizer = new GraphOptimizer(); });

    it('should suggest merging sequential same-model nodes', () => {
        const suggestions = optimizer.analyze(
            [
                { id: 'a', type: 'executor', model: 'gpt-4o-mini', prompt: 'Step 1' },
                { id: 'b', type: 'executor', model: 'gpt-4o-mini', prompt: 'Step 2' },
            ],
            [{ source: 'a', target: 'b' }],
        );

        expect(suggestions.some((s) => s.type === 'merge')).toBe(true);
    });

    it('should suggest model downgrade for simple tasks', () => {
        const suggestions = optimizer.analyze(
            [{ id: 'a', type: 'executor', model: 'gpt-4o', prompt: 'Say hello' }],
            [],
        );

        expect(suggestions.some((s) => s.type === 'downgrade')).toBe(true);
        expect(suggestions.find((s) => s.type === 'downgrade')?.description).toContain('gpt-4o-mini');
    });

    it('should detect redundant nodes', () => {
        const suggestions = optimizer.analyze(
            [
                { id: 'a', type: 'executor', model: 'gpt-4o', prompt: 'Analyze the data and produce a report' },
                { id: 'b', type: 'executor', model: 'gpt-4o', prompt: 'Analyze the data and produce a report' },
            ],
            [],
        );

        expect(suggestions.some((s) => s.type === 'remove_redundant')).toBe(true);
    });
});

// ─── Tenant Manager Tests ─────────────────────────────────────────────────

describe('TenantManager', () => {
    let manager: TenantManager;

    beforeEach(() => {
        manager = new TenantManager();
        manager.registerTenant({
            id: 't1', name: 'Acme Corp', plan: 'pro', apiKeyHash: 'hash-123',
            maxCostPerMonthUsd: 100, maxConcurrentRuns: 5, allowedModels: ['gpt-4o', 'gpt-4o-mini'],
            createdAt: new Date(),
        });
    });

    it('should resolve tenant from API key', () => {
        const ctx = manager.resolveTenant('hash-123');
        expect(ctx).not.toBeNull();
        expect(ctx!.tenantId).toBe('t1');
        expect(ctx!.plan).toBe('pro');
        expect(ctx!.remainingBudget).toBe(100);
    });

    it('should return null for unknown API keys', () => {
        expect(manager.resolveTenant('bad-key')).toBeNull();
    });

    it('should track usage and enforce budget', () => {
        manager.recordUsage('t1', 95);
        expect(manager.canExecute('t1').allowed).toBe(true);

        manager.recordUsage('t1', 10); // Total: 105 > 100
        expect(manager.canExecute('t1').allowed).toBe(false);
    });

    it('should return plan-based limits', () => {
        const limits = manager.getLimits('t1');
        expect(limits.maxCostPerRun).toBe(10.0);
        expect(limits.maxStepsPerRun).toBe(50);
    });

    it('should generate RLS SQL', () => {
        const sql = TenantManager.generateFullRlsSql();
        expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
        expect(sql).toContain('workflows');
        expect(sql).toContain('runs');
        expect(sql).toContain('run_steps');
    });
});

// ─── Token Accountant Tests ───────────────────────────────────────────────

describe('TokenAccountant', () => {
    let accountant: TokenAccountant;

    beforeEach(() => {
        accountant = new TokenAccountant();
    });

    it('should record and compute cost', () => {
        const record = accountant.record({
            tenantId: 't1', userId: 'u1', workflowId: 'w1', runId: 'r1', stepId: 's1', nodeId: 'n1',
            model: 'gpt-4o', provider: 'openai',
            promptTokens: 1000, completionTokens: 500,
            inputPricePer1k: 0.0025, outputPricePer1k: 0.01,
        });

        // Cost = (1000/1000) * 0.0025 + (500/1000) * 0.01 = 0.0025 + 0.005 = 0.0075
        expect(record.costUsd).toBeCloseTo(0.0075, 4);
        expect(record.totalTokens).toBe(1500);
    });

    it('should aggregate by model', () => {
        accountant.record({ tenantId: 't1', userId: 'u1', workflowId: 'w1', runId: 'r1', stepId: 's1', nodeId: 'n1', model: 'gpt-4o', provider: 'openai', promptTokens: 500, completionTokens: 200, inputPricePer1k: 0.0025, outputPricePer1k: 0.01 });
        accountant.record({ tenantId: 't1', userId: 'u1', workflowId: 'w1', runId: 'r1', stepId: 's2', nodeId: 'n2', model: 'gpt-4o-mini', provider: 'openai', promptTokens: 1000, completionTokens: 400, inputPricePer1k: 0.00015, outputPricePer1k: 0.0006 });
        accountant.record({ tenantId: 't1', userId: 'u1', workflowId: 'w1', runId: 'r1', stepId: 's3', nodeId: 'n3', model: 'gpt-4o', provider: 'openai', promptTokens: 800, completionTokens: 300, inputPricePer1k: 0.0025, outputPricePer1k: 0.01 });

        const byModel = accountant.getCostByModel('r1');
        expect(byModel.has('gpt-4o')).toBe(true);
        expect(byModel.has('gpt-4o-mini')).toBe(true);
        expect(byModel.get('gpt-4o')!.recordCount).toBe(2);
        expect(byModel.get('gpt-4o-mini')!.recordCount).toBe(1);
    });

    it('should compute run totals', () => {
        accountant.record({ tenantId: 't1', userId: 'u1', workflowId: 'w1', runId: 'r1', stepId: 's1', nodeId: 'n1', model: 'gpt-4o', provider: 'openai', promptTokens: 500, completionTokens: 200, inputPricePer1k: 0.0025, outputPricePer1k: 0.01 });
        accountant.record({ tenantId: 't1', userId: 'u1', workflowId: 'w1', runId: 'r2', stepId: 's1', nodeId: 'n1', model: 'gpt-4o', provider: 'openai', promptTokens: 500, completionTokens: 200, inputPricePer1k: 0.0025, outputPricePer1k: 0.01 });

        const r1 = accountant.getRunTotal('r1');
        expect(r1.recordCount).toBe(1);
        expect(r1.totalTokens).toBe(700);

        const total = accountant.getTotal();
        expect(total.recordCount).toBe(2);
    });
});
