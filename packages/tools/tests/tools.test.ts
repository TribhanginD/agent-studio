// ─── Agent Studio: Tools Package Tests ────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import {
    ToolRegistry,
    ToolRegistryError,
    ToolValidator,
    ToolExecutor,
    InMemoryRateLimiter,
    registerBuiltinTools,
} from '../src/index.js';
import type { CallerContext } from '../src/index.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────

function createMathTool(registry: ToolRegistry): void {
    registry.register({
        id: 'math-add',
        name: 'Math Add',
        description: 'Adds two numbers',
        inputSchema: z.object({
            a: z.number(),
            b: z.number(),
        }),
        outputSchema: z.object({
            result: z.number(),
        }),
        handler: async (input) => ({ result: input.a + input.b }),
    });
}

function createRestrictedTool(registry: ToolRegistry): void {
    registry.register({
        id: 'admin-tool',
        name: 'Admin Tool',
        description: 'Requires admin role',
        inputSchema: z.object({ action: z.string() }),
        permissions: {
            requiredRoles: ['admin'],
            rateLimit: { maxCalls: 3, windowSeconds: 60 },
        },
        handler: async (input) => ({ done: true }),
    });
}

const defaultCaller: CallerContext = {
    userId: 'user-1',
    roles: ['developer'],
    runId: 'run-1',
};

const adminCaller: CallerContext = {
    userId: 'admin-1',
    roles: ['admin', 'developer'],
    runId: 'run-1',
};

// ─── Tool Registry Tests ──────────────────────────────────────────────────

describe('ToolRegistry', () => {
    let registry: ToolRegistry;

    beforeEach(() => {
        registry = new ToolRegistry();
    });

    it('should register and retrieve a tool', () => {
        createMathTool(registry);
        expect(registry.has('math-add')).toBe(true);
        expect(registry.size).toBe(1);
    });

    it('should prevent duplicate registration', () => {
        createMathTool(registry);
        expect(() => createMathTool(registry)).toThrow(ToolRegistryError);
    });

    it('should convert Zod schema to JSON Schema', () => {
        createMathTool(registry);
        const def = registry.getDefinition('math-add')!;
        expect(def.inputSchema).toBeDefined();
        expect(typeof def.inputSchema).toBe('object');
    });

    it('should list all tool IDs', () => {
        createMathTool(registry);
        createRestrictedTool(registry);
        expect(registry.listIds()).toEqual(['math-add', 'admin-tool']);
    });

    it('should deprecate a tool', () => {
        createMathTool(registry);
        registry.deprecate('math-add');
        expect(registry.getDefinition('math-add')!.deprecated).toBe(true);
    });

    it('should register all built-in tools', () => {
        registerBuiltinTools(registry);
        expect(registry.has('web-search')).toBe(true);
        expect(registry.has('http-request')).toBe(true);
        expect(registry.has('json-transform')).toBe(true);
        expect(registry.has('text-summary')).toBe(true);
        expect(registry.size).toBe(4);
    });
});

// ─── 5-Layer Validation Tests ─────────────────────────────────────────────

describe('ToolValidator (5-Layer Pipeline)', () => {
    let registry: ToolRegistry;
    let rateLimiter: InMemoryRateLimiter;
    let validator: ToolValidator;

    beforeEach(() => {
        registry = new ToolRegistry();
        rateLimiter = new InMemoryRateLimiter();
        validator = new ToolValidator(registry, rateLimiter as any);
        createMathTool(registry);
        createRestrictedTool(registry);
    });

    it('Layer 1: should reject non-existent tools', async () => {
        const result = await validator.validate('nonexistent', {}, defaultCaller);
        expect(result.valid).toBe(false);
        expect(result.layer).toBe('existence');
        expect(result.errorCode).toBe('TOOL_NOT_FOUND');
    });

    it('Layer 2: should reject invalid input schema', async () => {
        const result = await validator.validate('math-add', { a: 'not a number' }, defaultCaller);
        expect(result.valid).toBe(false);
        expect(result.layer).toBe('schema');
        expect(result.errorCode).toBe('TOOL_SCHEMA_INVALID');
    });

    it('Layer 2: should accept valid input schema', async () => {
        const result = await validator.validate('math-add', { a: 1, b: 2 }, defaultCaller);
        expect(result.valid).toBe(true);
    });

    it('Layer 3: should reject insufficient permissions', async () => {
        const result = await validator.validate('admin-tool', { action: 'delete' }, defaultCaller);
        expect(result.valid).toBe(false);
        expect(result.layer).toBe('permission');
        expect(result.errorCode).toBe('TOOL_PERMISSION_DENIED');
    });

    it('Layer 3: should accept correct permissions', async () => {
        const result = await validator.validate('admin-tool', { action: 'delete' }, adminCaller);
        expect(result.valid).toBe(true);
    });

    it('Layer 4: should enforce rate limits', async () => {
        // Fill up the rate limit (3 calls/60s)
        for (let i = 0; i < 3; i++) {
            const result = await validator.validate('admin-tool', { action: 'ok' }, adminCaller);
            expect(result.valid).toBe(true);
        }

        // Fourth call should be rate limited
        const result = await validator.validate('admin-tool', { action: 'over' }, adminCaller);
        expect(result.valid).toBe(false);
        expect(result.layer).toBe('rate_limit');
        expect(result.errorCode).toBe('TOOL_RATE_LIMITED');
    });
});

// ─── Tool Executor Tests ──────────────────────────────────────────────────

describe('ToolExecutor', () => {
    let registry: ToolRegistry;
    let executor: ToolExecutor;

    beforeEach(() => {
        registry = new ToolRegistry();
        executor = new ToolExecutor(registry);
        createMathTool(registry);
        createRestrictedTool(registry);
    });

    it('should execute a valid tool call', async () => {
        const result = await executor.execute(
            {
                toolId: 'math-add',
                arguments: { a: 3, b: 7 },
                callId: 'call-1',
                timestamp: new Date().toISOString(),
            },
            defaultCaller,
        );

        expect(result.response.success).toBe(true);
        expect(result.response.result).toEqual({ result: 10 });
        expect(result.response.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should fail validation for bad input', async () => {
        const result = await executor.execute(
            {
                toolId: 'math-add',
                arguments: { a: 'not a number' },
                callId: 'call-2',
                timestamp: new Date().toISOString(),
            },
            defaultCaller,
        );

        expect(result.response.success).toBe(false);
        expect(result.validationResult.valid).toBe(false);
    });

    it('should batch execute multiple tool calls', async () => {
        const results = await executor.executeBatch(
            [
                { toolId: 'math-add', arguments: { a: 1, b: 2 }, callId: 'c1', timestamp: new Date().toISOString() },
                { toolId: 'math-add', arguments: { a: 3, b: 4 }, callId: 'c2', timestamp: new Date().toISOString() },
            ],
            defaultCaller,
        );

        expect(results).toHaveLength(2);
        expect(results[0].response.result).toEqual({ result: 3 });
        expect(results[1].response.result).toEqual({ result: 7 });
    });
});
