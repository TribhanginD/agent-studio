// ─── Agent Studio: Runtime Unit Tests ──────────────────────────────────────
// Tests for DAG engine, agent execution, and runner pipeline.

import { describe, it, expect } from 'vitest';
import { DAGEngine, DAGValidationError, AgentRegistry, ExecutionRunner } from '../src/index.js';
import type { WorkflowDefinition } from '@agent-studio/shared';

// ─── Test Fixtures ─────────────────────────────────────────────────────────

function createSimpleWorkflow(): WorkflowDefinition {
    return {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Test Linear Workflow',
        description: 'A → B → C linear chain',
        version: 1,
        nodes: [
            { id: 'a', type: 'planner', name: 'Planner', allowedTools: [], timeoutMs: 120000, maxRetries: 3, metadata: {} },
            { id: 'b', type: 'executor', name: 'Executor', allowedTools: [], timeoutMs: 120000, maxRetries: 3, metadata: {} },
            { id: 'c', type: 'validator', name: 'Validator', allowedTools: [], timeoutMs: 120000, maxRetries: 3, metadata: {} },
        ],
        edges: [
            { id: 'e1', source: 'a', target: 'b', isFallback: false },
            { id: 'e2', source: 'b', target: 'c', isFallback: false },
        ],
        entryNodeId: 'a',
        maxCostUsd: 5.0,
        metadata: {},
    };
}

function createParallelWorkflow(): WorkflowDefinition {
    return {
        id: '00000000-0000-0000-0000-000000000002',
        name: 'Test Parallel Workflow',
        description: 'A → [B, C] → D diamond pattern',
        version: 1,
        nodes: [
            { id: 'a', type: 'planner', name: 'Entry', allowedTools: [], timeoutMs: 120000, maxRetries: 3, metadata: {} },
            { id: 'b', type: 'executor', name: 'Branch 1', allowedTools: [], timeoutMs: 120000, maxRetries: 3, metadata: {} },
            { id: 'c', type: 'executor', name: 'Branch 2', allowedTools: [], timeoutMs: 120000, maxRetries: 3, metadata: {} },
            { id: 'd', type: 'validator', name: 'Merge', allowedTools: [], timeoutMs: 120000, maxRetries: 3, metadata: {} },
        ],
        edges: [
            { id: 'e1', source: 'a', target: 'b', isFallback: false },
            { id: 'e2', source: 'a', target: 'c', isFallback: false },
            { id: 'e3', source: 'b', target: 'd', isFallback: false },
            { id: 'e4', source: 'c', target: 'd', isFallback: false },
        ],
        entryNodeId: 'a',
        maxCostUsd: 5.0,
        metadata: {},
    };
}

function createCyclicWorkflow(): WorkflowDefinition {
    return {
        id: '00000000-0000-0000-0000-000000000003',
        name: 'Cyclic Workflow (should fail)',
        description: 'Cyclic A -> B -> A',
        version: 1,
        nodes: [
            { id: 'a', type: 'planner', name: 'A', allowedTools: [], timeoutMs: 120000, maxRetries: 3, metadata: {} },
            { id: 'b', type: 'executor', name: 'B', allowedTools: [], timeoutMs: 120000, maxRetries: 3, metadata: {} },
        ],
        edges: [
            { id: 'e1', source: 'a', target: 'b', isFallback: false },
            { id: 'e2', source: 'b', target: 'a', isFallback: false },
        ],
        entryNodeId: 'a',
        maxCostUsd: 5.0,
        metadata: {},
    };
}

// ─── DAG Engine Tests ──────────────────────────────────────────────────────

describe('DAGEngine', () => {
    const engine = new DAGEngine();

    describe('compile()', () => {
        it('should compile a valid linear workflow', () => {
            const dag = engine.compile(createSimpleWorkflow());

            expect(dag.sortedNodeIds).toHaveLength(3);
            expect(dag.entryNodeId).toBe('a');
            expect(dag.exitNodeIds).toEqual(['c']);
            expect(dag.layers.length).toBeGreaterThan(0);
        });

        it('should compute correct parallel layers for diamond pattern', () => {
            const dag = engine.compile(createParallelWorkflow());

            expect(dag.layers).toHaveLength(3);
            expect(dag.layers[0].nodeIds).toEqual(['a']);
            expect(dag.layers[1].nodeIds).toContain('b');
            expect(dag.layers[1].nodeIds).toContain('c');
            expect(dag.layers[2].nodeIds).toEqual(['d']);
        });

        it('should detect cycles and throw DAGValidationError', () => {
            expect(() => engine.compile(createCyclicWorkflow())).toThrow(DAGValidationError);
            expect(() => engine.compile(createCyclicWorkflow())).toThrow('cycle');
        });

        it('should detect missing entry node', () => {
            const workflow = createSimpleWorkflow();
            workflow.entryNodeId = 'nonexistent';

            expect(() => engine.compile(workflow)).toThrow('Entry node');
        });

        it('should detect missing edge target', () => {
            const workflow = createSimpleWorkflow();
            workflow.edges.push({
                id: 'e3',
                source: 'c',
                target: 'nonexistent',
                isFallback: false,
            });

            expect(() => engine.compile(workflow)).toThrow('not found');
        });

        it('should correctly track predecessors', () => {
            const dag = engine.compile(createParallelWorkflow());

            expect(engine.getPredecessors(dag, 'a')).toEqual([]);
            expect(engine.getPredecessors(dag, 'b')).toEqual(['a']);
            expect(engine.getPredecessors(dag, 'c')).toEqual(['a']);
            expect(engine.getPredecessors(dag, 'd')).toContain('b');
            expect(engine.getPredecessors(dag, 'd')).toContain('c');
        });
    });

    describe('evaluateEdges()', () => {
        it('should follow unconditional edges', () => {
            const dag = engine.compile(createSimpleWorkflow());
            const result = engine.evaluateEdges(dag, 'a', { status: 'ok' });

            expect(result.nextNodeIds).toContain('b');
            expect(result.fallbackNodeIds).toHaveLength(0);
        });

        it('should evaluate conditional edges', () => {
            const workflow = createSimpleWorkflow();
            workflow.edges[0].condition = {
                field: 'status',
                operator: 'eq',
                value: 'ok',
            };

            const dag = engine.compile(workflow);

            // Condition matches
            const result1 = engine.evaluateEdges(dag, 'a', { status: 'ok' });
            expect(result1.nextNodeIds).toContain('b');

            // Condition doesn't match
            const result2 = engine.evaluateEdges(dag, 'a', { status: 'error' });
            expect(result2.nextNodeIds).not.toContain('b');
        });
    });
});

// ─── Agent Registry Tests ──────────────────────────────────────────────────

describe('AgentRegistry', () => {
    it('should register and retrieve built-in agent types', () => {
        const registry = new AgentRegistry();

        expect(registry.has('planner')).toBe(true);
        expect(registry.has('executor')).toBe(true);
        expect(registry.has('validator')).toBe(true);
        expect(registry.has('retrieval')).toBe(true);
        expect(registry.listTypes()).toHaveLength(4);
    });

    it('should throw for unregistered agent types', () => {
        const registry = new AgentRegistry();
        expect(() => registry.get('unknown')).toThrow('No agent registered');
    });
});

// ─── ExecutionRunner Tests ──────────────────────────────────────────────────

import { BaseAgent } from '../src/agents/base.js';

class MockExecutorAgent extends BaseAgent {
    readonly type = 'executor' as const;
    readonly name = 'Mocked Executor';
    async execute() {
        return {
            output: { result: 'Mocked execution result' },
            toolCalls: [],
            toolResponses: [],
            tokensIn: 10,
            tokensOut: 20,
            costUsd: 0.001,
            metadata: { agentType: 'executor' },
        };
    }
}

class MockPlannerAgent extends BaseAgent {
    readonly type = 'planner' as const;
    readonly name = 'Mocked Planner';
    async execute() {
        return {
            output: {
                plan: [{ step: 1, action: 'test', agentType: 'executor', tools: [] }]
            },
            toolCalls: [],
            toolResponses: [],
            tokensIn: 5,
            tokensOut: 15,
            costUsd: 0.0005,
            metadata: { agentType: 'planner' },
        };
    }
}

class MockValidatorAgent extends BaseAgent {
    readonly type = 'validator' as const;
    readonly name = 'Mocked Validator';
    async execute() {
        return {
            output: { valid: true, results: {}, validatedAt: new Date().toISOString() },
            toolCalls: [],
            toolResponses: [],
            tokensIn: 5,
            tokensOut: 2,
            costUsd: 0.0001,
            metadata: { agentType: 'validator' },
        };
    }
}

describe('ExecutionRunner', () => {
    const registry = new AgentRegistry();
    registry.register('executor', new MockExecutorAgent() as any);
    registry.register('planner', new MockPlannerAgent() as any);
    registry.register('validator', new MockValidatorAgent() as any);

    const runner = new ExecutionRunner(registry);

    it('should execute a simple linear workflow', async () => {
        const workflow = createSimpleWorkflow();
        const events: string[] = [];

        const run = await runner.execute(
            workflow,
            { task: 'hello' },
            {},
            (event) => events.push(event.type),
        );

        expect(run.status).toBe('completed');
        expect(run.steps.length).toBeGreaterThanOrEqual(3);
        expect(events).toContain('run:start');
        expect(events).toContain('run:complete');
    });

    it('should execute a parallel diamond workflow', async () => {
        const workflow = createParallelWorkflow();

        const run = await runner.execute(workflow, { task: 'parallel test' });

        expect(run.status).toBe('completed');
        expect(run.steps.length).toBeGreaterThanOrEqual(4);
    });

    it('should emit cost:update events during execution', async () => {
        const workflow = createSimpleWorkflow();
        let costUpdates = 0;

        await runner.execute(workflow, { task: 'cost test' }, {}, (event) => {
            if (event.type === 'cost:update') costUpdates++;
        });

        expect(costUpdates).toBeGreaterThanOrEqual(1);
    });
});
