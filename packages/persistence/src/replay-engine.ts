// ─── Agent Studio: Replay Engine ──────────────────────────────────────────
// Reconstructs and diffs execution runs from stored data.
// Supports full replay, partial replay from a node, and structured run diffing.

import { eq } from 'drizzle-orm';
import type { Database } from './connection.js';
import { runs, runSteps, workflows } from './schema.js';
import { RunStore } from './run-store.js';

/**
 * A reconstructed step for replay.
 */
export interface ReplayStep {
    stepId: string;
    nodeId: string;
    agentType: string;
    status: string;
    prompt?: string;
    response: unknown;
    modelUsed?: string;
    toolCalls: unknown[];
    toolResponses: unknown[];
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    latencyMs: number;
    retryAttempt: number;
    error?: string;
    predecessorOutputs: unknown;
    startedAt: Date;
    completedAt?: Date;
}

/**
 * Full replay of a run.
 */
export interface RunReplay {
    runId: string;
    workflowId: string;
    status: string;
    userInput: unknown;
    graphSnapshot: unknown;
    totalCostUsd: number;
    totalTokensIn: number;
    totalTokensOut: number;
    totalLatencyMs: number;
    steps: ReplayStep[];
    createdAt: Date;
    completedAt?: Date;
}

/**
 * Structured diff between two runs.
 */
export interface RunDiff {
    runId1: string;
    runId2: string;
    summary: {
        costDelta: number;
        costDeltaPercent: number;
        latencyDelta: number;
        latencyDeltaPercent: number;
        tokensDelta: number;
        stepCountDelta: number;
    };
    stepDiffs: StepDiff[];
    graphDiff: {
        addedNodes: string[];
        removedNodes: string[];
        changedNodes: string[];
    };
}

export interface StepDiff {
    nodeId: string;
    status: 'added' | 'removed' | 'changed' | 'unchanged';
    run1?: { prompt?: string; response: unknown; model?: string; cost: number; latency: number };
    run2?: { prompt?: string; response: unknown; model?: string; cost: number; latency: number };
    changes?: string[];
}

/**
 * ReplayEngine: Reconstructs, replays, and diffs execution runs.
 */
export class ReplayEngine {
    private runStore: RunStore;

    constructor(private db: Database) {
        this.runStore = new RunStore(db);
    }

    /**
     * Reconstruct full run from stored data for replay.
     */
    async replayRun(runId: string): Promise<RunReplay | null> {
        const run = await this.runStore.getRun(runId);
        if (!run) return null;

        const steps: ReplayStep[] = run.steps.map((s) => ({
            stepId: s.id,
            nodeId: s.nodeId,
            agentType: s.agentType,
            status: s.status,
            prompt: s.prompt ?? undefined,
            response: s.response,
            modelUsed: s.modelUsed ?? undefined,
            toolCalls: (s.toolCalls as unknown[]) ?? [],
            toolResponses: (s.toolResponses as unknown[]) ?? [],
            tokensIn: s.tokensIn,
            tokensOut: s.tokensOut,
            costUsd: s.costUsd,
            latencyMs: s.latencyMs,
            retryAttempt: s.retryAttempt,
            error: s.error ?? undefined,
            predecessorOutputs: s.predecessorOutputs,
            startedAt: s.startedAt,
            completedAt: s.completedAt ?? undefined,
        }));

        return {
            runId: run.id,
            workflowId: run.workflowId,
            status: run.status,
            userInput: run.userInput,
            graphSnapshot: run.graphSnapshot,
            totalCostUsd: run.totalCostUsd,
            totalTokensIn: run.totalTokensIn,
            totalTokensOut: run.totalTokensOut,
            totalLatencyMs: run.totalLatencyMs,
            steps,
            createdAt: run.createdAt,
            completedAt: run.completedAt ?? undefined,
        };
    }

    /**
     * Replay from a specific node — returns only the steps from that node onward.
     * Useful for debugging failures mid-execution.
     */
    async replayFromNode(runId: string, nodeId: string): Promise<ReplayStep[]> {
        const replay = await this.replayRun(runId);
        if (!replay) return [];

        const nodeIndex = replay.steps.findIndex((s) => s.nodeId === nodeId);
        if (nodeIndex === -1) return [];

        return replay.steps.slice(nodeIndex);
    }

    /**
     * Structured diff between two runs. Compares cost, latency, prompts,
     * graph structure, and model usage across matching nodes.
     */
    async diffRuns(runId1: string, runId2: string): Promise<RunDiff | null> {
        const run1 = await this.replayRun(runId1);
        const run2 = await this.replayRun(runId2);

        if (!run1 || !run2) return null;

        // ── Summary delta ──────────────────────────────────────────────────
        const costDelta = run2.totalCostUsd - run1.totalCostUsd;
        const latencyDelta = run2.totalLatencyMs - run1.totalLatencyMs;
        const tokensDelta = (run2.totalTokensIn + run2.totalTokensOut) - (run1.totalTokensIn + run1.totalTokensOut);

        const summary = {
            costDelta,
            costDeltaPercent: run1.totalCostUsd > 0 ? (costDelta / run1.totalCostUsd) * 100 : 0,
            latencyDelta,
            latencyDeltaPercent: run1.totalLatencyMs > 0 ? (latencyDelta / run1.totalLatencyMs) * 100 : 0,
            tokensDelta,
            stepCountDelta: run2.steps.length - run1.steps.length,
        };

        // ── Per-step diff ──────────────────────────────────────────────────
        const steps1Map = new Map(run1.steps.map((s) => [s.nodeId, s]));
        const steps2Map = new Map(run2.steps.map((s) => [s.nodeId, s]));
        const allNodeIds = new Set([...steps1Map.keys(), ...steps2Map.keys()]);

        const stepDiffs: StepDiff[] = [];
        const addedNodes: string[] = [];
        const removedNodes: string[] = [];
        const changedNodes: string[] = [];

        for (const nodeId of allNodeIds) {
            const s1 = steps1Map.get(nodeId);
            const s2 = steps2Map.get(nodeId);

            if (!s1 && s2) {
                addedNodes.push(nodeId);
                stepDiffs.push({
                    nodeId,
                    status: 'added',
                    run2: { prompt: s2.prompt, response: s2.response, model: s2.modelUsed, cost: s2.costUsd, latency: s2.latencyMs },
                });
            } else if (s1 && !s2) {
                removedNodes.push(nodeId);
                stepDiffs.push({
                    nodeId,
                    status: 'removed',
                    run1: { prompt: s1.prompt, response: s1.response, model: s1.modelUsed, cost: s1.costUsd, latency: s1.latencyMs },
                });
            } else if (s1 && s2) {
                const changes: string[] = [];
                if (s1.prompt !== s2.prompt) changes.push('prompt');
                if (JSON.stringify(s1.response) !== JSON.stringify(s2.response)) changes.push('response');
                if (s1.modelUsed !== s2.modelUsed) changes.push('model');
                if (Math.abs(s1.costUsd - s2.costUsd) > 0.0001) changes.push('cost');
                if (Math.abs(s1.latencyMs - s2.latencyMs) > 100) changes.push('latency');

                const status = changes.length > 0 ? 'changed' : 'unchanged';
                if (status === 'changed') changedNodes.push(nodeId);

                stepDiffs.push({
                    nodeId,
                    status,
                    run1: { prompt: s1.prompt, response: s1.response, model: s1.modelUsed, cost: s1.costUsd, latency: s1.latencyMs },
                    run2: { prompt: s2.prompt, response: s2.response, model: s2.modelUsed, cost: s2.costUsd, latency: s2.latencyMs },
                    changes: changes.length > 0 ? changes : undefined,
                });
            }
        }

        return {
            runId1,
            runId2,
            summary,
            stepDiffs,
            graphDiff: { addedNodes, removedNodes, changedNodes },
        };
    }
}
