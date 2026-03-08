// ─── Agent Studio: Temporal Activities ────────────────────────────────────
// Activity definitions for the Temporal workflow orchestrator.
// Activities are the "side-effect" boundary — they call LLMs, tools, and DB.

/**
 * Activity interface — these are implemented by the worker and proxied by workflows.
 */
export interface AgentActivities {
    /**
     * Initialize a run record in the persistence layer.
     */
    initializeRun(runId: string, workflowId: string): Promise<void>;

    /**
     * Compute topological execution layers from graph JSON.
     * Returns an array of layers, each layer being an array of node IDs
     * that can execute in parallel.
     */
    computeExecutionLayers(graphJson: {
        nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
        edges: Array<{ source: string; target: string; condition?: string }>;
    }): Promise<string[][]>;

    /**
     * Route a model for a given agent step.
     */
    routeModel(params: {
        nodeId: string;
        agentType: string;
        complexityHint?: string;
        remainingBudget: number;
    }): Promise<{
        modelId: string;
        provider: string;
        estimatedCostUsd: number;
    }>;

    /**
     * Execute a single agent step.
     */
    executeAgent(params: {
        runId: string;
        nodeId: string;
        agentType: string;
        prompt: string;
        model: string;
        tools: string[];
        predecessorOutputs: unknown[];
    }): Promise<{
        output: unknown;
        costUsd: number;
        latencyMs: number;
        tokensIn: number;
        tokensOut: number;
    }>;

    /**
     * Execute a tool call through the sandbox.
     */
    executeToolCall(params: {
        runId: string;
        stepId: string;
        toolId: string;
        arguments: Record<string, unknown>;
        userId: string;
    }): Promise<{
        success: boolean;
        result: unknown;
        durationMs: number;
    }>;

    /**
     * Compensate (roll back) a completed step — saga pattern.
     */
    compensateStep(runId: string, nodeId: string): Promise<void>;

    /**
     * Finalize a run with terminal status.
     */
    finalizeRun(
        runId: string,
        status: string,
        totalCostUsd: number,
        error?: string,
    ): Promise<void>;
}

// Re-export for consumers
export type { AgentActivities as default };
