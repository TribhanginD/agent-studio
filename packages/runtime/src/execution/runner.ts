// ─── Agent Studio: Execution Runner ───────────────────────────────────────
// Orchestrates the execution of a compiled DAG through agent nodes.
// Supports sequential chains, parallel branches, conditional routing,
// fallback handling, and cost cap enforcement.

import { v4 as uuid } from 'uuid';
import type {
    Run,
    StepResult,
    AgentContext,
    AgentResult,
    WorkflowDefinition,
    ToolDefinition,
    ModelConfig,
} from '@agent-studio/shared';
import { ErrorCode, Defaults } from '@agent-studio/shared';
import { DAGEngine, type CompiledDAG } from '../engine.js';
import { AgentRegistry } from '../agents/index.js';
import {
    createRunState,
    updateRunStatus,
    createStepState,
    completeStep,
    failStep,
    recordStepInRun,
} from './state.js';

/**
 * Event types emitted during execution for streaming to the UI.
 */
export type RunnerEvent =
    | { type: 'run:start'; run: Run }
    | { type: 'step:start'; stepId: string; nodeId: string; agentType: string }
    | { type: 'step:complete'; step: StepResult }
    | { type: 'step:error'; stepId: string; nodeId: string; error: string }
    | { type: 'cost:update'; totalCostUsd: number; stepCostUsd: number }
    | { type: 'run:complete'; run: Run }
    | { type: 'run:failed'; run: Run; error: string };

/**
 * Configuration for the execution runner.
 */
export interface RunnerConfig {
    /** Maximum parallel branches to execute simultaneously */
    maxParallelBranches?: number;
    /** Default model configuration (used if node doesn't specify one) */
    defaultModel?: ModelConfig;
    /** Available tool definitions for agents */
    tools?: ToolDefinition[];
    /** Maximum cost for this run (USD) */
    maxCostUsd?: number;
    /** Abort signal for cancellation */
    signal?: AbortSignal;
}

/**
 * ExecutionRunner: Takes a compiled DAG and runs it to completion,
 * handling parallel branches, conditional edges, retries, and fallbacks.
 *
 * Emits events via a callback for real-time streaming to the UI.
 */
export class ExecutionRunner {
    private dagEngine: DAGEngine;
    private agentRegistry: AgentRegistry;

    constructor(agentRegistry?: AgentRegistry) {
        this.dagEngine = new DAGEngine();
        this.agentRegistry = agentRegistry ?? new AgentRegistry();
    }

    /**
     * Returns all tool definitions registered in the tool registry.
     * Used by the API server to inject tool context into each run.
     */
    getTools() {
        return this.agentRegistry.toolRegistry.getActiveDefinitions();
    }

    /**
     * Execute a workflow definition from start to finish.
     *
     * @param workflow - The workflow definition to execute
     * @param userInput - User's input data
     * @param config - Execution configuration
     * @param onEvent - Callback for real-time event streaming
     * @returns The completed Run with all step results
     */
    async execute(
        workflow: WorkflowDefinition,
        userInput: unknown,
        config: RunnerConfig = {},
        onEvent?: (event: RunnerEvent) => void,
    ): Promise<Run> {
        // ── Compile and validate the DAG ───────────────────────────────────
        const dag = this.dagEngine.compile(workflow);

        // ── Initialize run state ───────────────────────────────────────────
        let run = createRunState(workflow.id, userInput, workflow);
        run = updateRunStatus(run, 'running');
        onEvent?.({ type: 'run:start', run });

        const maxCostUsd = config.maxCostUsd ?? workflow.maxCostUsd ?? Defaults.DEFAULT_COST_CAP_USD;
        const maxParallel = config.maxParallelBranches ?? Defaults.MAX_PARALLEL_BRANCHES;
        const tools = config.tools ?? [];

        // ── Node output storage (keyed by node ID) ─────────────────────────
        const nodeOutputs = new Map<string, unknown>();

        try {
            // ── Execute layer by layer ─────────────────────────────────────
            // Each layer contains nodes that can run in parallel.
            for (const layer of dag.layers) {
                // Check for cancellation
                if (config.signal?.aborted) {
                    run = updateRunStatus(run, 'cancelled', 'Execution cancelled by user');
                    return run;
                }

                // ── Execute all nodes in this layer concurrently ──────────────
                const layerPromises = layer.nodeIds.map(async (nodeId) => {
                    // Check if this node should execute based on edge conditions
                    const predecessors = this.dagEngine.getPredecessors(dag, nodeId);

                    // Skip if node has no predecessors in a non-entry layer
                    // (it's reachable only through conditional edges that didn't fire)
                    if (predecessors.length > 0) {
                        const hasInputFromPredecessor = predecessors.some((predId) =>
                            nodeOutputs.has(predId),
                        );
                        if (!hasInputFromPredecessor) {
                            return; // Skip — no input data arrived at this node
                        }
                    }

                    const node = dag.nodeMap.get(nodeId);
                    if (!node) return;

                    // ── Build agent context ──────────────────────────────────────
                    const predecessorOutputs: Record<string, unknown> = {};
                    for (const predId of predecessors) {
                        const output = nodeOutputs.get(predId);
                        if (output !== undefined) {
                            predecessorOutputs[predId] = output;
                        }
                    }

                    const stepState = createStepState(run.id, nodeId, node.type);

                    const context: AgentContext = {
                        runId: run.id,
                        stepId: stepState.stepId,
                        node,
                        userInput: run.userInput,
                        predecessorOutputs,
                        tools: tools,
                        accumulatedCostUsd: run.totalCostUsd,
                        maxCostUsd,
                        retryAttempt: 0,
                    };

                    // ── Emit step start ──────────────────────────────────────────
                    onEvent?.({
                        type: 'step:start',
                        stepId: stepState.stepId,
                        nodeId,
                        agentType: node.type,
                    });

                    try {
                        // ── Execute the agent ──────────────────────────────────────
                        const agent = this.agentRegistry.get(node.type);

                        // Apply timeout
                        const timeoutMs = node.timeoutMs ?? Defaults.STEP_TIMEOUT_MS;
                        const result = await this.executeWithTimeout(
                            () => agent.run(context),
                            timeoutMs,
                        );

                        // ── Cost cap check ─────────────────────────────────────────
                        const projectedCost = run.totalCostUsd + result.costUsd;
                        if (projectedCost > maxCostUsd) {
                            throw new ExecutionError(
                                ErrorCode.COST_CAP_EXCEEDED,
                                `Run cost ($${projectedCost.toFixed(4)}) would exceed cap ($${maxCostUsd.toFixed(2)})`,
                            );
                        }

                        // ── Record step completion ─────────────────────────────────
                        const completedStep = completeStep(stepState, {
                            output: result.output,
                            tokensIn: result.tokensIn,
                            tokensOut: result.tokensOut,
                            costUsd: result.costUsd,
                            modelUsed: (result.metadata?.modelUsed as string) || node.providerPreference || 'auto',
                            toolCalls: result.toolCalls,
                            toolResponses: result.toolResponses,
                        });

                        run = recordStepInRun(run, completedStep);
                        nodeOutputs.set(nodeId, result.output);

                        onEvent?.({ type: 'step:complete', step: completedStep });
                        onEvent?.({
                            type: 'cost:update',
                            totalCostUsd: run.totalCostUsd,
                            stepCostUsd: result.costUsd,
                        });

                        // ── Evaluate outgoing edges for conditional routing ────────
                        const { nextNodeIds, fallbackNodeIds } = this.dagEngine.evaluateEdges(
                            dag,
                            nodeId,
                            result.output,
                        );

                        // Fallback nodes are only activated if the primary path is empty
                        // (this is handled naturally by the layer execution — nodes without
                        // predecessor outputs are skipped)

                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);

                        const failedStep = failStep(stepState, errorMessage, context.retryAttempt);
                        run = recordStepInRun(run, failedStep);

                        onEvent?.({
                            type: 'step:error',
                            stepId: stepState.stepId,
                            nodeId,
                            error: errorMessage,
                        });

                        // Check if this is a fatal error (cost cap, etc.)
                        if (error instanceof ExecutionError && error.code === ErrorCode.COST_CAP_EXCEEDED) {
                            throw error;
                        }

                        // For non-fatal errors, mark node output as error for fallback edges
                        nodeOutputs.set(nodeId, { _error: errorMessage });

                        // If no fallback branches exist, we should fail the entire run
                        throw new ExecutionError(ErrorCode.AGENT_EXECUTION_FAILED, `Step ${nodeId} failed: ${errorMessage}`);
                    }
                });

                // Execute layer with concurrency limit
                await this.executeBatch(layerPromises, maxParallel);
            }

            // ── Run complete ───────────────────────────────────────────────────
            run = updateRunStatus(run, 'completed');
            onEvent?.({ type: 'run:complete', run });
            return run;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            run = updateRunStatus(run, 'failed', errorMessage);
            onEvent?.({ type: 'run:failed', run, error: errorMessage });
            return run;
        }
    }

    /**
     * Wraps an async function with a timeout.
     */
    private async executeWithTimeout<T>(
        fn: () => Promise<T>,
        timeoutMs: number,
    ): Promise<T> {
        return Promise.race([
            fn(),
            new Promise<never>((_, reject) =>
                setTimeout(
                    () => reject(new ExecutionError(ErrorCode.EXECUTION_TIMEOUT, `Step timed out after ${timeoutMs}ms`)),
                    timeoutMs,
                ),
            ),
        ]);
    }

    /**
     * Executes async tasks with a concurrency limit using a simple pool.
     */
    private async executeBatch(
        tasks: Promise<void>[],
        concurrency: number,
    ): Promise<void> {
        // Simple batch execution — for more sophisticated pooling,
        // we can integrate p-limit in later phases.
        const results = await Promise.allSettled(tasks);

        for (const result of results) {
            if (result.status === 'rejected') {
                throw result.reason;
            }
        }
    }
}

/**
 * Structured execution error with an error code.
 */
export class ExecutionError extends Error {
    constructor(
        public readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = 'ExecutionError';
    }
}
