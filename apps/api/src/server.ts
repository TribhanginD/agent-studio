// ─── Agent Studio: Fastify API Server ──────────────────────────────────────
// HTTP entry point for the Agent Studio platform.
// Provides REST endpoints for workflow management, run execution, and SSE streaming.

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from 'dotenv';
import path from 'path';
import { v4 as uuid } from 'uuid';
import {
    WorkflowDefinitionSchema,
    CreateRunRequestSchema,
    CreateWorkflowRequestSchema,
} from '@agent-studio/shared';
import type { WorkflowDefinition, Run } from '@agent-studio/shared';
import { ExecutionRunner } from '@agent-studio/runtime';
import type { RunnerEvent } from '@agent-studio/runtime';

// Load environment variables from the monorepo root
config({ path: path.resolve(process.cwd(), '../../.env') });

// ─── In-Memory Stores (Phase 3 replaces with Postgres) ────────────────────
const workflows = new Map<string, WorkflowDefinition>();
const runs = new Map<string, Run>();
const runEventSubscribers = new Map<string, Set<(event: RunnerEvent) => void>>();
const runControllers = new Map<string, AbortController>();

// ─── Server Setup ─────────────────────────────────────────────────────────

const server = Fastify({
    logger: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
            process.env.NODE_ENV === 'development'
                ? { target: 'pino-pretty', options: { colorize: true } }
                : undefined,
    },
});

// ─── Plugins ──────────────────────────────────────────────────────────────

await server.register(cors, {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

await server.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
});

// ─── Runner Instance ──────────────────────────────────────────────────────

const runner = new ExecutionRunner();

// ─── Health Check ─────────────────────────────────────────────────────────

server.get('/health', async () => ({
    status: 'ok',
    service: 'agent-studio-api',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
}));

// ─── Workflow Routes ──────────────────────────────────────────────────────

/**
 * POST /api/workflows — Create a new workflow definition
 */
server.post('/api/workflows', async (request, reply) => {
    try {
        const parsed = CreateWorkflowRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: 'VALIDATION_ERROR',
                message: 'Invalid workflow definition',
                details: parsed.error.flatten(),
            });
        }

        const workflow: WorkflowDefinition = {
            ...parsed.data,
            id: uuid(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        workflows.set(workflow.id, workflow);
        server.log.info({ workflowId: workflow.id }, 'Workflow created');

        return reply.status(201).send(workflow);
    } catch (error) {
        server.log.error(error, 'Failed to create workflow');
        return reply.status(500).send({
            error: 'INTERNAL_ERROR',
            message: 'Failed to create workflow',
        });
    }
});

/**
 * GET /api/workflows — List all workflows
 */
server.get('/api/workflows', async () => {
    return [...workflows.values()].map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description,
        version: w.version,
        nodeCount: w.nodes.length,
        edgeCount: w.edges.length,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
    }));
});

/**
 * GET /api/workflows/:id — Get a specific workflow
 */
server.get<{ Params: { id: string } }>('/api/workflows/:id', async (request, reply) => {
    const workflow = workflows.get(request.params.id);
    if (!workflow) {
        return reply.status(404).send({ error: 'WORKFLOW_NOT_FOUND' });
    }
    return workflow;
});

// ─── Run Routes ───────────────────────────────────────────────────────────

/**
 * POST /api/runs — Start a new execution run
 */
server.post('/api/runs', async (request, reply) => {
    try {
        const parsed = CreateRunRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: 'VALIDATION_ERROR',
                message: 'Invalid run request',
                details: parsed.error.flatten(),
            });
        }

        const workflow = workflows.get(parsed.data.workflowId);
        if (!workflow) {
            return reply.status(404).send({ error: 'WORKFLOW_NOT_FOUND' });
        }

        server.log.info(
            { workflowId: workflow.id, workflowName: workflow.name },
            'Starting run execution',
        );

        const abortController = new AbortController();
        let runId: string | undefined;

        // Execute asynchronously — the client can subscribe to SSE for live updates
        const runPromise = runner.execute(
            workflow,
            parsed.data.input,
            { maxCostUsd: parsed.data.maxCostUsd, signal: abortController.signal, tools: runner.getTools() },
            (event) => {
                // Store run state on relevant events
                if ('run' in event) {
                    runs.set(event.run.id, event.run);
                    if (event.type === 'run:start') {
                        runId = event.run.id;
                        runControllers.set(event.run.id, abortController);
                    }
                }

                // Broadcast to all SSE subscribers
                for (const [, subs] of runEventSubscribers.entries()) {
                    for (const sub of subs) {
                        sub(event);
                    }
                }
            },
        );

        // Yield to event loop to allow synchronous run:start event to fire
        await new Promise((resolve) => setTimeout(resolve, 50));

        if (runId) {
            const currentRun = runs.get(runId);
            return reply.status(202).send({
                runId: runId,
                status: currentRun?.status || 'running',
                message: 'Run started. Subscribe to SSE at /api/runs/:id/stream for live updates.',
            });
        }

        // Fallback: wait for full completion
        const completedRun = await runPromise;
        runs.set(completedRun.id, completedRun);

        return reply.status(200).send(completedRun);
    } catch (error) {
        server.log.error(error, 'Failed to start run');
        return reply.status(500).send({
            error: 'INTERNAL_ERROR',
            message: 'Failed to start execution run',
        });
    }
});

/**
 * POST /api/runs/:id/cancel — Cancel an executing run
 */
server.post<{ Params: { id: string } }>('/api/runs/:id/cancel', async (request, reply) => {
    const run = runs.get(request.params.id);
    if (!run) {
        return reply.status(404).send({ error: 'RUN_NOT_FOUND' });
    }

    if (run.status !== 'running' && run.status !== 'queued' && run.status !== 'pending') {
        return reply.status(400).send({ error: 'INVALID_STATE', message: 'Run is not active' });
    }

    const controller = runControllers.get(run.id);
    if (!controller) {
        return reply.status(404).send({ error: 'NO_CONTROLLER_FOUND' });
    }

    server.log.info({ runId: run.id }, 'Cancelling run');
    controller.abort();
    runControllers.delete(run.id);

    // Update state manually before the runner handles the abort exception,
    // so clients fetching via REST see immediate confirmation
    run.status = 'cancelled';
    run.completedAt = new Date().toISOString();
    runs.set(run.id, run);

    // Broadcast cancellation
    const subs = runEventSubscribers.get(run.id);
    if (subs) {
        for (const sub of subs) {
            sub({ type: 'run:completed' as any, run }); // The UI actually wants 'run:completed' or 'run:failed' with status updated
        }
    }

    return reply.status(200).send({ message: 'Run cancelled successfully' });
});

/**
 * GET /api/runs/:id — Get run status and results
 */
server.get<{ Params: { id: string } }>('/api/runs/:id', async (request, reply) => {
    const run = runs.get(request.params.id);
    if (!run) {
        return reply.status(404).send({ error: 'RUN_NOT_FOUND' });
    }
    return run;
});

/**
 * GET /api/runs — List all runs
 */
server.get('/api/runs', async () => {
    return [...runs.values()].map((r) => ({
        id: r.id,
        workflowId: r.workflowId,
        status: r.status,
        totalCostUsd: r.totalCostUsd,
        stepCount: r.steps.length,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
    }));
});

/**
 * GET /api/runs/:id/stream — SSE stream for real-time execution updates
 */
server.get<{ Params: { id: string } }>('/api/runs/:id/stream', async (request, reply) => {
    const runId = request.params.id;

    reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });

    const sendEvent = (event: RunnerEvent) => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Register subscriber
    if (!runEventSubscribers.has(runId)) {
        runEventSubscribers.set(runId, new Set());
    }
    runEventSubscribers.get(runId)!.add(sendEvent);

    // Send initial state if run exists
    const existingRun = runs.get(runId);
    if (existingRun) {
        reply.raw.write(
            `data: ${JSON.stringify({ type: 'run:state', run: existingRun })}\n\n`,
        );
    }

    // Cleanup on disconnect
    request.raw.on('close', () => {
        const subs = runEventSubscribers.get(runId);
        if (subs) {
            subs.delete(sendEvent);
            if (subs.size === 0) {
                runEventSubscribers.delete(runId);
            }
        }
    });
});

// ─── System Routes ────────────────────────────────────────────────────────

/**
 * GET /api/agents — List registered agent types
 */
server.get('/api/agents', async () => {
    const registry = new (await import('@agent-studio/runtime')).AgentRegistry();
    return {
        types: registry.listTypes(),
    };
});

// ─── Start Server ─────────────────────────────────────────────────────────

const PORT = parseInt(process.env.API_PORT ?? '4000', 10);
const HOST = process.env.API_HOST ?? '0.0.0.0';

try {
    await server.listen({ port: PORT, host: HOST });
    server.log.info(`🚀 Agent Studio API running at http://${HOST}:${PORT}`);
    server.log.info(`📋 Health check: http://${HOST}:${PORT}/health`);
    server.log.info(`🔧 Agent types: http://${HOST}:${PORT}/api/agents`);
} catch (err) {
    server.log.fatal(err);
    process.exit(1);
}

export { server };
