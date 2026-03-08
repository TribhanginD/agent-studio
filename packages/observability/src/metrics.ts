// ─── Agent Studio: Prometheus Metrics ─────────────────────────────────────
// Custom Prometheus metrics for the platform.
// Exposes: step duration, cost, tool calls, model selection, run cost, overhead.

import client from 'prom-client';

// Create a registry for Agent Studio metrics
const registry = new client.Registry();

// Apply default labels
registry.setDefaultLabels({
    app: 'agent-studio',
});

// Collect default Node.js metrics (GC, event loop, memory)
client.collectDefaultMetrics({ register: registry });

// ─── Custom Metrics ───────────────────────────────────────────────────────

/**
 * Step execution duration in seconds.
 */
export const stepDurationHistogram = new client.Histogram({
    name: 'agent_studio_step_duration_seconds',
    help: 'Duration of individual step executions',
    labelNames: ['agent_type', 'model', 'status'] as const,
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [registry],
});

/**
 * Step cost in USD.
 */
export const stepCostCounter = new client.Counter({
    name: 'agent_studio_step_cost_usd_total',
    help: 'Accumulated cost of step executions in USD',
    labelNames: ['model', 'provider'] as const,
    registers: [registry],
});

/**
 * Tool call counter.
 */
export const toolCallsCounter = new client.Counter({
    name: 'agent_studio_tool_calls_total',
    help: 'Total number of tool calls',
    labelNames: ['tool_name', 'status'] as const,
    registers: [registry],
});

/**
 * Model selection counter (tracks which models the router picks).
 */
export const modelSelectionCounter = new client.Counter({
    name: 'agent_studio_model_selections_total',
    help: 'Number of times each model was selected by the router',
    labelNames: ['model', 'provider', 'complexity_hint'] as const,
    registers: [registry],
});

/**
 * Total run cost histogram.
 */
export const runCostHistogram = new client.Histogram({
    name: 'agent_studio_run_total_cost_usd',
    help: 'Total cost per run execution in USD',
    buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
    registers: [registry],
});

/**
 * Orchestration overhead (time spent outside of agent execution).
 */
export const orchestrationOverheadHistogram = new client.Histogram({
    name: 'agent_studio_orchestration_overhead_seconds',
    help: 'Time spent in orchestration overhead (scheduling, validation, etc.)',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    registers: [registry],
});

/**
 * Active runs gauge.
 */
export const activeRunsGauge = new client.Gauge({
    name: 'agent_studio_active_runs',
    help: 'Number of currently active (running) executions',
    registers: [registry],
});

/**
 * Token throughput counter.
 */
export const tokenThroughputCounter = new client.Counter({
    name: 'agent_studio_tokens_total',
    help: 'Total tokens processed',
    labelNames: ['direction', 'model'] as const,
    registers: [registry],
});

/**
 * Circuit breaker state gauge.
 */
export const circuitBreakerGauge = new client.Gauge({
    name: 'agent_studio_circuit_breaker_state',
    help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
    labelNames: ['provider'] as const,
    registers: [registry],
});

// ─── Convenience Functions ────────────────────────────────────────────────

/**
 * Record a completed step execution.
 */
export function recordStepExecution(params: {
    agentType: string;
    model: string;
    provider: string;
    status: 'success' | 'error';
    durationSeconds: number;
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
}): void {
    stepDurationHistogram.observe(
        { agent_type: params.agentType, model: params.model, status: params.status },
        params.durationSeconds,
    );

    stepCostCounter.inc(
        { model: params.model, provider: params.provider },
        params.costUsd,
    );

    tokenThroughputCounter.inc(
        { direction: 'input', model: params.model },
        params.tokensIn,
    );

    tokenThroughputCounter.inc(
        { direction: 'output', model: params.model },
        params.tokensOut,
    );
}

/**
 * Record a tool call.
 */
export function recordToolCall(toolName: string, success: boolean): void {
    toolCallsCounter.inc({ tool_name: toolName, status: success ? 'success' : 'error' });
}

/**
 * Record a model selection event.
 */
export function recordModelSelection(model: string, provider: string, complexityHint: string): void {
    modelSelectionCounter.inc({ model, provider, complexity_hint: complexityHint });
}

/**
 * Record a completed run.
 */
export function recordRunCompletion(totalCostUsd: number): void {
    runCostHistogram.observe(totalCostUsd);
    activeRunsGauge.dec();
}

/**
 * Get the Prometheus metrics registry.
 */
export function getMetricsRegistry(): client.Registry {
    return registry;
}

/**
 * Get metrics output for the /metrics endpoint.
 */
export async function getMetricsOutput(): Promise<string> {
    return registry.metrics();
}
