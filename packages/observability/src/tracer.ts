// ─── Agent Studio: OpenTelemetry Tracer ───────────────────────────────────
// Custom tracer for distributed tracing across the agent orchestration pipeline.
// Creates spans for: agent execution, tool calls, model inference, router selection.

import { trace, context, SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';

const TRACER_NAME = 'agent-studio';

/**
 * AgentStudioTracer: High-level tracing API for the platform.
 *
 * Wraps OpenTelemetry to provide domain-specific span creation
 * with standardized attributes.
 */
export class AgentStudioTracer {
    private tracer: Tracer;

    constructor() {
        this.tracer = trace.getTracer(TRACER_NAME, '0.1.0');
    }

    /**
     * Create a span for an agent execution step.
     */
    async traceAgentExecution<T>(
        params: {
            runId: string;
            stepId: string;
            nodeId: string;
            agentType: string;
            model?: string;
        },
        fn: (span: Span) => Promise<T>,
    ): Promise<T> {
        return this.tracer.startActiveSpan(`agent.execute.${params.agentType}`, async (span) => {
            span.setAttributes({
                'agent_studio.run_id': params.runId,
                'agent_studio.step_id': params.stepId,
                'agent_studio.node_id': params.nodeId,
                'agent_studio.agent_type': params.agentType,
                'agent_studio.model': params.model ?? 'unknown',
            });

            try {
                const result = await fn(span);
                span.setStatus({ code: SpanStatusCode.OK });
                return result;
            } catch (error) {
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: error instanceof Error ? error.message : String(error),
                });
                span.recordException(error as Error);
                throw error;
            } finally {
                span.end();
            }
        });
    }

    /**
     * Create a span for a tool call.
     */
    async traceToolCall<T>(
        params: {
            runId: string;
            stepId: string;
            toolName: string;
            callId: string;
        },
        fn: (span: Span) => Promise<T>,
    ): Promise<T> {
        return this.tracer.startActiveSpan(`tool.call.${params.toolName}`, async (span) => {
            span.setAttributes({
                'agent_studio.run_id': params.runId,
                'agent_studio.step_id': params.stepId,
                'agent_studio.tool_name': params.toolName,
                'agent_studio.tool_call_id': params.callId,
            });

            try {
                const result = await fn(span);
                span.setStatus({ code: SpanStatusCode.OK });
                return result;
            } catch (error) {
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: error instanceof Error ? error.message : String(error),
                });
                span.recordException(error as Error);
                throw error;
            } finally {
                span.end();
            }
        });
    }

    /**
     * Create a span for model inference.
     */
    async traceModelInference<T>(
        params: {
            runId: string;
            stepId: string;
            model: string;
            provider: string;
            tokensIn?: number;
            tokensOut?: number;
            costUsd?: number;
        },
        fn: (span: Span) => Promise<T>,
    ): Promise<T> {
        return this.tracer.startActiveSpan(`model.inference.${params.model}`, async (span) => {
            span.setAttributes({
                'agent_studio.run_id': params.runId,
                'agent_studio.step_id': params.stepId,
                'agent_studio.model': params.model,
                'agent_studio.provider': params.provider,
            });

            try {
                const result = await fn(span);

                // Add token/cost attributes after completion
                if (params.tokensIn) span.setAttribute('agent_studio.tokens_in', params.tokensIn);
                if (params.tokensOut) span.setAttribute('agent_studio.tokens_out', params.tokensOut);
                if (params.costUsd) span.setAttribute('agent_studio.cost_usd', params.costUsd);

                span.setStatus({ code: SpanStatusCode.OK });
                return result;
            } catch (error) {
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: error instanceof Error ? error.message : String(error),
                });
                span.recordException(error as Error);
                throw error;
            } finally {
                span.end();
            }
        });
    }

    /**
     * Create a span for router model selection.
     */
    async traceRouterSelection<T>(
        params: {
            runId: string;
            selectedModel: string;
            candidateCount: number;
            reason: string;
        },
        fn: (span: Span) => Promise<T>,
    ): Promise<T> {
        return this.tracer.startActiveSpan('router.select', async (span) => {
            span.setAttributes({
                'agent_studio.run_id': params.runId,
                'agent_studio.selected_model': params.selectedModel,
                'agent_studio.candidate_count': params.candidateCount,
                'agent_studio.selection_reason': params.reason,
            });

            try {
                const result = await fn(span);
                span.setStatus({ code: SpanStatusCode.OK });
                return result;
            } catch (error) {
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: error instanceof Error ? error.message : String(error),
                });
                throw error;
            } finally {
                span.end();
            }
        });
    }

    /**
     * Add result attributes to the current span.
     */
    addResultAttributes(span: Span, result: {
        tokensIn?: number;
        tokensOut?: number;
        costUsd?: number;
        durationMs?: number;
        success: boolean;
    }): void {
        if (result.tokensIn) span.setAttribute('agent_studio.tokens_in', result.tokensIn);
        if (result.tokensOut) span.setAttribute('agent_studio.tokens_out', result.tokensOut);
        if (result.costUsd) span.setAttribute('agent_studio.cost_usd', result.costUsd);
        if (result.durationMs) span.setAttribute('agent_studio.duration_ms', result.durationMs);
        span.setAttribute('agent_studio.success', result.success);
    }
}
