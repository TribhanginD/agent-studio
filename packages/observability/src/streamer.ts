// ─── Agent Studio: SSE Event Streamer ─────────────────────────────────────
// Type-safe SSE event emitting for real-time UI updates during execution.
// Supports: step lifecycle, token streaming, cost updates, run lifecycle.

import { EventEmitter } from 'node:events';
import type { StreamEventPayload } from '@agent-studio/shared';

/**
 * Event types emitted during execution.
 */
export type StreamEventType =
    | 'step:start'
    | 'step:complete'
    | 'step:error'
    | 'step:retry'
    | 'token:stream'
    | 'cost:update'
    | 'tool:start'
    | 'tool:complete'
    | 'tool:error'
    | 'run:started'
    | 'run:complete'
    | 'run:failed'
    | 'run:cancelled';

/**
 * SSEStreamer: Type-safe event emitter for real-time execution updates.
 *
 * Each run gets its own streamer instance. Events are emitted as SSE-compatible
 * payloads with structured data for the frontend to consume.
 */
export class SSEStreamer extends EventEmitter {
    private runId: string;
    private eventLog: StreamEventPayload[] = [];

    constructor(runId: string) {
        super();
        this.runId = runId;
    }

    /**
     * Emit a step started event.
     */
    emitStepStart(stepId: string, nodeId: string, agentType: string): void {
        this.emit('step:start', stepId, nodeId, agentType);
        this.broadcast('step:start', { stepId, nodeId, agentType });
    }

    /**
     * Emit a step completed event with results.
     */
    emitStepComplete(stepId: string, nodeId: string, result: {
        tokensIn: number;
        tokensOut: number;
        costUsd: number;
        latencyMs: number;
        output?: unknown;
    }): void {
        this.emit('step:complete', stepId, nodeId, result);
        this.broadcast('step:complete', { stepId, nodeId, ...result });
    }

    /**
     * Emit a step error event.
     */
    emitStepError(stepId: string, nodeId: string, error: string): void {
        this.emit('step:error', stepId, nodeId, error);
        this.broadcast('step:error', { stepId, nodeId, error });
    }

    /**
     * Emit a partial token from LLM streaming.
     */
    emitTokenStream(stepId: string, nodeId: string, token: string): void {
        this.emit('token:stream', stepId, nodeId, token);
        this.broadcast('token:stream', { stepId, nodeId, token });
    }

    /**
     * Emit a cost update (running total).
     */
    emitCostUpdate(totalCostUsd: number, remainingBudget: number): void {
        this.emit('cost:update', totalCostUsd, remainingBudget);
        this.broadcast('cost:update', { totalCostUsd, remainingBudget });
    }

    /**
     * Emit a tool call started event.
     */
    emitToolStart(stepId: string, toolId: string, callId: string): void {
        this.emit('tool:start', stepId, toolId, callId);
        this.broadcast('tool:start', { stepId, toolId, callId });
    }

    /**
     * Emit a tool call completed event.
     */
    emitToolComplete(stepId: string, toolId: string, callId: string, result: {
        success: boolean;
        durationMs: number;
    }): void {
        this.emit('tool:complete', stepId, toolId, callId, result);
        this.broadcast('tool:complete', { stepId, toolId, callId, ...result });
    }

    /**
     * Emit run started.
     */
    emitRunStarted(): void {
        this.emit('run:started');
        this.broadcast('run:started', { runId: this.runId });
    }

    /**
     * Emit run completed with summary.
     */
    emitRunComplete(summary: {
        totalCostUsd: number;
        totalLatencyMs: number;
        stepsCompleted: number;
        output?: unknown;
    }): void {
        this.emit('run:complete', summary);
        this.broadcast('run:complete', { runId: this.runId, ...summary });
    }

    /**
     * Emit run failed.
     */
    emitRunFailed(error: string): void {
        this.emit('run:failed', error);
        this.broadcast('run:failed', { runId: this.runId, error });
    }

    /**
     * Broadcast a structured SSE event payload.
     */
    private broadcast(event: StreamEventType, data: unknown): void {
        const payload: StreamEventPayload = {
            event,
            runId: this.runId,
            data,
            timestamp: new Date().toISOString(),
        };

        this.eventLog.push(payload);
        this.emit('sse', payload);
    }

    /**
     * Get all events emitted for this run (for logging/debugging).
     */
    getEventLog(): readonly StreamEventPayload[] {
        return this.eventLog;
    }

    /**
     * Subscribe to SSE events for this run.
     */
    onSSE(handler: (payload: StreamEventPayload) => void): void {
        this.on('sse', handler);
    }

    /**
     * Format a payload as an SSE string for HTTP streaming.
     */
    static formatSSE(payload: StreamEventPayload): string {
        return `event: ${payload.event}\ndata: ${JSON.stringify(payload)}\n\n`;
    }
}
