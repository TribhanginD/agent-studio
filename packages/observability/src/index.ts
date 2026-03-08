// ─── Agent Studio: Observability Package Barrel Export ─────────────────────

export { AgentStudioTracer } from './tracer.js';
export { initTelemetry, shutdownTelemetry } from './setup.js';

export {
    stepDurationHistogram,
    stepCostCounter,
    toolCallsCounter,
    modelSelectionCounter,
    runCostHistogram,
    orchestrationOverheadHistogram,
    activeRunsGauge,
    tokenThroughputCounter,
    circuitBreakerGauge,
    recordStepExecution,
    recordToolCall,
    recordModelSelection,
    recordRunCompletion,
    getMetricsRegistry,
    getMetricsOutput,
} from './metrics.js';

export { SSEStreamer } from './streamer.js';
export type { StreamEventType } from './streamer.js';
