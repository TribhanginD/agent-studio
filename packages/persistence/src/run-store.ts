// ─── Agent Studio: Run Store ──────────────────────────────────────────────
// Data access layer for run persistence. Handles creation, step recording,
// finalization, and querying of execution runs.

import { eq, desc, and, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import type { Database } from './connection.js';
import { runs, runSteps, auditLog } from './schema.js';
import type { Run, StepResult } from '@agent-studio/shared';

/**
 * RunStore: CRUD operations for execution runs and their steps.
 */
export class RunStore {
    constructor(private db: Database) { }

    /**
     * Create a new run record in the database.
     */
    async createRun(params: {
        workflowId: string;
        userInput: unknown;
        graphSnapshot?: unknown;
        triggeredBy?: string;
    }): Promise<string> {
        const id = uuid();

        await this.db.insert(runs).values({
            id,
            workflowId: params.workflowId,
            status: 'pending',
            userInput: params.userInput,
            graphSnapshot: params.graphSnapshot,
            triggeredBy: params.triggeredBy,
        });

        // Audit log
        await this.db.insert(auditLog).values({
            runId: id,
            eventType: 'run:created',
            eventData: { workflowId: params.workflowId },
        });

        return id;
    }

    /**
     * Update run status.
     */
    async updateRunStatus(runId: string, status: string, error?: string): Promise<void> {
        const update: Record<string, unknown> = { status };
        if (error) update.error = error;
        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
            update.completedAt = new Date();
        }

        await this.db.update(runs).set(update).where(eq(runs.id, runId));
    }

    /**
     * Record a completed step with full execution metadata.
     */
    async recordStep(step: {
        runId: string;
        nodeId: string;
        agentType: string;
        status: string;
        prompt?: string;
        response?: unknown;
        modelUsed?: string;
        toolCalls?: unknown[];
        toolResponses?: unknown[];
        tokensIn: number;
        tokensOut: number;
        costUsd: number;
        latencyMs: number;
        retryAttempt: number;
        error?: string;
        predecessorOutputs?: unknown;
    }): Promise<string> {
        const id = uuid();

        await this.db.insert(runSteps).values({
            id,
            runId: step.runId,
            nodeId: step.nodeId,
            agentType: step.agentType,
            status: step.status,
            prompt: step.prompt,
            response: step.response,
            modelUsed: step.modelUsed,
            toolCalls: step.toolCalls ?? [],
            toolResponses: step.toolResponses ?? [],
            tokensIn: step.tokensIn,
            tokensOut: step.tokensOut,
            costUsd: step.costUsd,
            latencyMs: step.latencyMs,
            retryAttempt: step.retryAttempt,
            error: step.error,
            predecessorOutputs: step.predecessorOutputs,
            completedAt: step.status === 'completed' || step.status === 'failed' ? new Date() : undefined,
        });

        // Update run aggregates
        await this.db.update(runs).set({
            totalCostUsd: sql`${runs.totalCostUsd} + ${step.costUsd}`,
            totalTokensIn: sql`${runs.totalTokensIn} + ${step.tokensIn}`,
            totalTokensOut: sql`${runs.totalTokensOut} + ${step.tokensOut}`,
            totalLatencyMs: sql`${runs.totalLatencyMs} + ${step.latencyMs}`,
        }).where(eq(runs.id, step.runId));

        return id;
    }

    /**
     * Finalize a run — compute final aggregates and set terminal status.
     */
    async finalizeRun(runId: string, status: 'completed' | 'failed', error?: string): Promise<void> {
        await this.db.update(runs).set({
            status,
            error,
            completedAt: new Date(),
        }).where(eq(runs.id, runId));

        // Audit log
        await this.db.insert(auditLog).values({
            runId,
            eventType: `run:${status}`,
            eventData: { error },
        });
    }

    /**
     * Get a run by ID with all its steps.
     */
    async getRun(runId: string) {
        const run = await this.db.query.runs.findFirst({
            where: eq(runs.id, runId),
        });
        if (!run) return null;

        const steps = await this.db.query.runSteps.findMany({
            where: eq(runSteps.runId, runId),
            orderBy: runSteps.startedAt,
        });

        return { ...run, steps };
    }

    /**
     * Get the ordered timeline of steps for replay.
     */
    async getRunTimeline(runId: string) {
        return this.db.query.runSteps.findMany({
            where: eq(runSteps.runId, runId),
            orderBy: runSteps.startedAt,
        });
    }

    /**
     * List runs with optional filtering.
     */
    async listRuns(params?: {
        workflowId?: string;
        status?: string;
        limit?: number;
        offset?: number;
    }) {
        const limit = params?.limit ?? 50;
        const offset = params?.offset ?? 0;

        // Build conditions
        const conditions = [];
        if (params?.workflowId) conditions.push(eq(runs.workflowId, params.workflowId));
        if (params?.status) conditions.push(eq(runs.status, params.status));

        const where = conditions.length > 0 ? and(...conditions) : undefined;

        const results = await this.db.query.runs.findMany({
            where,
            orderBy: desc(runs.createdAt),
            limit,
            offset,
        });

        return results;
    }

    /**
     * Get cost analysis for a run.
     */
    async getRunCostAnalysis(runId: string) {
        const steps = await this.getRunTimeline(runId);

        const byModel: Record<string, { cost: number; tokens: number; calls: number }> = {};
        const byAgent: Record<string, { cost: number; tokens: number; calls: number }> = {};

        for (const step of steps) {
            const model = step.modelUsed ?? 'unknown';
            if (!byModel[model]) byModel[model] = { cost: 0, tokens: 0, calls: 0 };
            byModel[model].cost += step.costUsd;
            byModel[model].tokens += step.tokensIn + step.tokensOut;
            byModel[model].calls += 1;

            if (!byAgent[step.agentType]) byAgent[step.agentType] = { cost: 0, tokens: 0, calls: 0 };
            byAgent[step.agentType].cost += step.costUsd;
            byAgent[step.agentType].tokens += step.tokensIn + step.tokensOut;
            byAgent[step.agentType].calls += 1;
        }

        return { byModel, byAgent, totalSteps: steps.length };
    }
}
