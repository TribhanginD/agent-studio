// ─── Agent Studio: Shared Constants ────────────────────────────────────────
// Central source of truth for all enums, error codes, and magic values.
// NOTE: Canonical TypeScript types are inferred from Zod schemas in types/.
// These consts provide runtime lookup values (e.g., AGENT_TYPES.PLANNER === 'planner').

/**
 * Agent types supported by the runtime.
 * Each maps to a specialized node implementation in packages/runtime.
 */
export const AGENT_TYPES = {
    PLANNER: 'planner',
    EXECUTOR: 'executor',
    VALIDATOR: 'validator',
    RETRIEVAL: 'retrieval',
    CUSTOM: 'custom',
} as const;

/**
 * Execution states for a run or individual step.
 */
export const EXECUTION_STATUSES = {
    PENDING: 'pending',
    QUEUED: 'queued',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    TIMED_OUT: 'timed_out',
    RETRYING: 'retrying',
} as const;

/**
 * Model provider identifiers used by the router.
 */
export const MODEL_PROVIDERS = {
    OPENAI: 'openai',
    ANTHROPIC: 'anthropic',
    GOOGLE: 'google',
    LOCAL: 'local',
} as const;


/**
 * Error codes for structured error handling across the platform.
 */
export const ErrorCode = {
    // Runtime errors
    CYCLE_DETECTED: 'CYCLE_DETECTED',
    NODE_NOT_FOUND: 'NODE_NOT_FOUND',
    EXECUTION_TIMEOUT: 'EXECUTION_TIMEOUT',
    MAX_RETRIES_EXCEEDED: 'MAX_RETRIES_EXCEEDED',
    AGENT_EXECUTION_FAILED: 'AGENT_EXECUTION_FAILED',

    // Tool errors
    TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
    TOOL_SCHEMA_INVALID: 'TOOL_SCHEMA_INVALID',
    TOOL_PERMISSION_DENIED: 'TOOL_PERMISSION_DENIED',
    TOOL_RATE_LIMITED: 'TOOL_RATE_LIMITED',
    TOOL_EXECUTION_FAILED: 'TOOL_EXECUTION_FAILED',
    TOOL_TIMEOUT: 'TOOL_TIMEOUT',

    // Router errors
    NO_PROVIDER_AVAILABLE: 'NO_PROVIDER_AVAILABLE',
    COST_CAP_EXCEEDED: 'COST_CAP_EXCEEDED',
    CONTEXT_WINDOW_EXCEEDED: 'CONTEXT_WINDOW_EXCEEDED',

    // Persistence errors
    RUN_NOT_FOUND: 'RUN_NOT_FOUND',
    WORKFLOW_NOT_FOUND: 'WORKFLOW_NOT_FOUND',

    // General
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * SSE event types emitted during execution streaming.
 */
export const StreamEvent = {
    STEP_START: 'step:start',
    STEP_COMPLETE: 'step:complete',
    STEP_ERROR: 'step:error',
    TOKEN_STREAM: 'token:stream',
    COST_UPDATE: 'cost:update',
    RUN_COMPLETE: 'run:complete',
    RUN_FAILED: 'run:failed',
} as const;
export type StreamEvent = (typeof StreamEvent)[keyof typeof StreamEvent];

/**
 * Default configuration values.
 */
export const Defaults = {
    /** Maximum execution time for a single tool call (ms) */
    TOOL_TIMEOUT_MS: 30_000,
    /** Maximum execution time for a single agent step (ms) */
    STEP_TIMEOUT_MS: 120_000,
    /** Maximum retry attempts per step */
    MAX_RETRIES: 3,
    /** Base delay for exponential backoff (ms) */
    RETRY_BASE_DELAY_MS: 1_000,
    /** Maximum concurrent parallel branches */
    MAX_PARALLEL_BRANCHES: 10,
    /** Default cost cap per run (USD) */
    DEFAULT_COST_CAP_USD: 5.0,
    /** Maximum WASM fuel per tool execution */
    WASM_MAX_FUEL: 1_000_000_000,
    /** Maximum WASM memory per tool execution (bytes) */
    WASM_MAX_MEMORY_BYTES: 256 * 1024 * 1024, // 256 MB
} as const;
