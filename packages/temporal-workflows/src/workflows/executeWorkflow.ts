// ─── Agent Studio: Temporal Workflow Orchestrator ─────────────────────────
// Durable workflow execution using Temporal.io.
// Each agent step is an Activity with saga-style compensations, 
// automatic retries, pause/resume signals, and state queries.

import {
    proxyActivities,
    defineSignal,
    defineQuery,
    setHandler,
    condition,
    sleep,
    ApplicationFailure,
} from '@temporalio/workflow';

import type { AgentActivities } from '../activities/index.js';

// Proxy activities with retry and timeout config
const activities = proxyActivities<AgentActivities>({
    startToCloseTimeout: '2 minutes',
    retry: {
        maximumAttempts: 3,
        initialInterval: '1 second',
        backoffCoefficient: 2,
        maximumInterval: '30 seconds',
        nonRetryableErrorTypes: ['CostCapExceeded', 'PolicyDenied'],
    },
});

// ─── Signals ──────────────────────────────────────────────────────────────

export const pauseSignal = defineSignal('pause');
export const resumeSignal = defineSignal('resume');
export const cancelSignal = defineSignal('cancel');
export const updateCostCapSignal = defineSignal<[number]>('updateCostCap');

// ─── Queries ──────────────────────────────────────────────────────────────

export const statusQuery = defineQuery<WorkflowState>('status');
export const costQuery = defineQuery<number>('currentCost');
export const stepsQuery = defineQuery<StepResult[]>('completedSteps');

// ─── Types ────────────────────────────────────────────────────────────────

interface WorkflowInput {
    workflowId: string;
    runId: string;
    graphJson: {
        nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
        edges: Array<{ source: string; target: string; condition?: string }>;
    };
    userInput: unknown;
    costCapUsd: number;
}

interface StepResult {
    nodeId: string;
    status: 'completed' | 'failed' | 'compensated';
    output: unknown;
    costUsd: number;
    latencyMs: number;
    model?: string;
}

type WorkflowState = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

// ─── Main Workflow ────────────────────────────────────────────────────────

/**
 * executeWorkflow: Primary durable workflow for orchestrating agent runs.
 * 
 * - Each agent step is a Temporal Activity with built-in retries
 * - Saga-style compensations roll back completed steps on failure
 * - Supports pause/resume/cancel signals during execution
 * - Exposes queries for live state inspection
 */
export async function executeWorkflow(input: WorkflowInput): Promise<{
    status: WorkflowState;
    steps: StepResult[];
    totalCostUsd: number;
    error?: string;
}> {
    let state: WorkflowState = 'running';
    let isPaused = false;
    let isCancelled = false;
    let costCapUsd = input.costCapUsd;
    let totalCostUsd = 0;
    const completedSteps: StepResult[] = [];
    const compensations: Array<() => Promise<void>> = [];

    // ── Signal Handlers ──────────────────────────────────────────────────
    setHandler(pauseSignal, () => { isPaused = true; state = 'paused'; });
    setHandler(resumeSignal, () => { isPaused = false; state = 'running'; });
    setHandler(cancelSignal, () => { isCancelled = true; state = 'cancelled'; });
    setHandler(updateCostCapSignal, (newCap) => { costCapUsd = newCap; });

    // ── Query Handlers ───────────────────────────────────────────────────
    setHandler(statusQuery, () => state);
    setHandler(costQuery, () => totalCostUsd);
    setHandler(stepsQuery, () => completedSteps);

    try {
        // Initialize run in persistence
        await activities.initializeRun(input.runId, input.workflowId);

        // Compute execution layers (topological generations)
        const layers = await activities.computeExecutionLayers(input.graphJson);

        for (const layer of layers) {
            // ── Check pause ──────────────────────────────────────────────
            if (isPaused) {
                await condition(() => !isPaused && !isCancelled);
            }
            if (isCancelled) break;

            // ── Execute layer (parallel branches) ────────────────────────
            const layerResults = await Promise.all(
                layer.map(async (nodeId) => {
                    const node = input.graphJson.nodes.find((n) => n.id === nodeId);
                    if (!node) throw ApplicationFailure.nonRetryable(`Node ${nodeId} not found in graph`);

                    // Check cost cap before executing
                    if (totalCostUsd >= costCapUsd) {
                        throw ApplicationFailure.nonRetryable(
                            `Cost cap exceeded: $${totalCostUsd.toFixed(4)} >= $${costCapUsd}`,
                            'CostCapExceeded',
                        );
                    }

                    // Route model
                    const routing = await activities.routeModel({
                        nodeId,
                        agentType: node.type ?? 'executor',
                        complexityHint: (node.data as any).complexityHint,
                        remainingBudget: costCapUsd - totalCostUsd,
                    });

                    // Collect predecessor outputs
                    const predecessorOutputs = completedSteps
                        .filter((s) => input.graphJson.edges.some((e) => e.source === s.nodeId && e.target === nodeId))
                        .map((s) => s.output);

                    // Execute agent
                    const result = await activities.executeAgent({
                        runId: input.runId,
                        nodeId,
                        agentType: node.type ?? 'executor',
                        prompt: (node.data as any).prompt ?? '',
                        model: routing.modelId,
                        tools: (node.data as any).tools ?? [],
                        predecessorOutputs,
                    });

                    // Register compensation
                    compensations.push(async () => {
                        await activities.compensateStep(input.runId, nodeId);
                    });

                    const stepResult: StepResult = {
                        nodeId,
                        status: 'completed',
                        output: result.output,
                        costUsd: result.costUsd,
                        latencyMs: result.latencyMs,
                        model: routing.modelId,
                    };

                    totalCostUsd += result.costUsd;
                    completedSteps.push(stepResult);
                    return stepResult;
                }),
            );
        }

        // Finalize run
        state = isCancelled ? 'cancelled' : 'completed';
        await activities.finalizeRun(input.runId, state, totalCostUsd);

        return { status: state, steps: completedSteps, totalCostUsd };
    } catch (error) {
        state = 'failed';
        const errorMsg = error instanceof Error ? error.message : String(error);

        // ── Saga Compensations ─────────────────────────────────────────────
        for (const compensate of compensations.reverse()) {
            try {
                await compensate();
            } catch (compError) {
                // Log but don't fail on compensation errors
                console.error('[Saga] Compensation failed:', compError);
            }
        }

        await activities.finalizeRun(input.runId, 'failed', totalCostUsd, errorMsg);
        return { status: 'failed', steps: completedSteps, totalCostUsd, error: errorMsg };
    }
}
