// ─── Agent Studio: Observability Tests ────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import {
    SSEStreamer,
    recordStepExecution,
    recordToolCall,
    recordModelSelection,
    getMetricsOutput,
} from '../src/index.js';

// ─── SSE Streamer Tests ───────────────────────────────────────────────────

describe('SSEStreamer', () => {
    let streamer: SSEStreamer;

    beforeEach(() => {
        streamer = new SSEStreamer('run-1');
    });

    it('should emit step lifecycle events', () => {
        const events: string[] = [];
        streamer.onSSE((payload) => events.push(payload.event));

        streamer.emitStepStart('s1', 'n1', 'planner');
        streamer.emitStepComplete('s1', 'n1', {
            tokensIn: 100,
            tokensOut: 50,
            costUsd: 0.005,
            latencyMs: 1200,
        });

        expect(events).toEqual(['step:start', 'step:complete']);
    });

    it('should emit cost update events', () => {
        const costs: number[] = [];
        streamer.onSSE((payload) => {
            if (payload.event === 'cost:update') {
                costs.push((payload.data as any).totalCostUsd);
            }
        });

        streamer.emitCostUpdate(0.01, 4.99);
        streamer.emitCostUpdate(0.05, 4.95);

        expect(costs).toEqual([0.01, 0.05]);
    });

    it('should maintain event log', () => {
        streamer.emitRunStarted();
        streamer.emitStepStart('s1', 'n1', 'executor');
        streamer.emitToolStart('s1', 'web-search', 'c1');
        streamer.emitToolComplete('s1', 'web-search', 'c1', { success: true, durationMs: 500 });
        streamer.emitStepComplete('s1', 'n1', { tokensIn: 200, tokensOut: 100, costUsd: 0.01, latencyMs: 2000 });
        streamer.emitRunComplete({ totalCostUsd: 0.01, totalLatencyMs: 2000, stepsCompleted: 1 });

        const log = streamer.getEventLog();
        expect(log).toHaveLength(6);
        expect(log[0].event).toBe('run:started');
        expect(log[5].event).toBe('run:complete');
    });

    it('should format SSE correctly', () => {
        streamer.emitRunStarted();
        const payload = streamer.getEventLog()[0];
        const formatted = SSEStreamer.formatSSE(payload);

        expect(formatted).toContain('event: run:started');
        expect(formatted).toContain('data: ');
        expect(formatted).toContain('"runId":"run-1"');
    });

    it('should emit token streaming events', () => {
        const tokens: string[] = [];
        streamer.onSSE((payload) => {
            if (payload.event === 'token:stream') {
                tokens.push((payload.data as any).token);
            }
        });

        streamer.emitTokenStream('s1', 'n1', 'Hello');
        streamer.emitTokenStream('s1', 'n1', ' ');
        streamer.emitTokenStream('s1', 'n1', 'World');

        expect(tokens).toEqual(['Hello', ' ', 'World']);
    });

    it('should emit run failed event', () => {
        let failError: string | undefined;
        streamer.onSSE((payload) => {
            if (payload.event === 'run:failed') {
                failError = (payload.data as any).error;
            }
        });

        streamer.emitRunFailed('Cost cap exceeded');
        expect(failError).toBe('Cost cap exceeded');
    });
});

// ─── Prometheus Metrics Tests ─────────────────────────────────────────────

describe('Prometheus Metrics', () => {
    it('should record step execution metrics', async () => {
        recordStepExecution({
            agentType: 'planner',
            model: 'gpt-4o',
            provider: 'openai',
            status: 'success',
            durationSeconds: 1.5,
            costUsd: 0.008,
            tokensIn: 500,
            tokensOut: 200,
        });

        const output = await getMetricsOutput();
        expect(output).toContain('agent_studio_step_duration_seconds');
        expect(output).toContain('agent_studio_step_cost_usd_total');
        expect(output).toContain('agent_studio_tokens_total');
    });

    it('should record tool call metrics', async () => {
        recordToolCall('web-search', true);
        recordToolCall('web-search', false);

        const output = await getMetricsOutput();
        expect(output).toContain('agent_studio_tool_calls_total');
        expect(output).toContain('tool_name="web-search"');
    });

    it('should record model selection metrics', async () => {
        recordModelSelection('gpt-4o', 'openai', 'complex');

        const output = await getMetricsOutput();
        expect(output).toContain('agent_studio_model_selections_total');
    });

    it('should provide full metrics output for /metrics endpoint', async () => {
        const output = await getMetricsOutput();
        expect(typeof output).toBe('string');
        expect(output.length).toBeGreaterThan(0);
        // Default Node.js metrics should also be present
        expect(output).toContain('nodejs_');
    });
});
