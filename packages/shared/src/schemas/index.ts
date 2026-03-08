// ─── Agent Studio: Zod Schemas ─────────────────────────────────────────────
// Runtime-validated schemas for all core data structures.
// These are the single source of truth — TypeScript types are inferred from them.

import { z } from 'zod';

// ─── Primitives ────────────────────────────────────────────────────────────

export const AgentTypeSchema = z.enum([
    'planner',
    'executor',
    'validator',
    'retrieval',
    'custom',
]);

export const ExecutionStatusSchema = z.enum([
    'pending',
    'queued',
    'running',
    'completed',
    'failed',
    'cancelled',
    'timed_out',
    'retrying',
]);

export const ModelProviderSchema = z.enum(['openai', 'anthropic', 'google', 'groq', 'local']);

// ─── Model Configuration ──────────────────────────────────────────────────

export const ModelConfigSchema = z.object({
    provider: ModelProviderSchema,
    model: z.string(),
    temperature: z.number().min(0).max(2).default(0.7),
    maxTokens: z.number().positive().optional(),
    topP: z.number().min(0).max(1).optional(),
    costPer1kInput: z.number().nonnegative().optional(),
    costPer1kOutput: z.number().nonnegative().optional(),
});

// ─── Tool Schemas ──────────────────────────────────────────────────────────

export const ToolPermissionSchema = z.object({
    requiredRoles: z.array(z.string()).default([]),
    rateLimit: z
        .object({
            maxCalls: z.number().positive(),
            windowSeconds: z.number().positive(),
        })
        .optional(),
});

export const ToolDefinitionSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    version: z.string().default('1.0.0'),
    deprecated: z.boolean().default(false),
    inputSchema: z.record(z.unknown()), // JSON Schema object
    outputSchema: z.record(z.unknown()).optional(),
    permissions: ToolPermissionSchema.default({}),
    timeoutMs: z.number().positive().default(30_000),
    maxMemoryBytes: z.number().positive().optional(),
    sandboxed: z.boolean().default(false),
});

export const ToolCallSchema = z.object({
    toolId: z.string().min(1),
    arguments: z.record(z.unknown()),
    callId: z.string().uuid(),
    timestamp: z.string().datetime(),
});

export const ToolResponseSchema = z.object({
    callId: z.string().uuid(),
    toolId: z.string().min(1),
    success: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
    durationMs: z.number().nonnegative(),
    timestamp: z.string().datetime(),
});

// ─── Agent Node ────────────────────────────────────────────────────────────

export const AgentNodeSchema = z.object({
    id: z.string().min(1),
    type: AgentTypeSchema,
    name: z.string().min(1),
    prompt: z.string().optional(),
    providerPreference: ModelProviderSchema.optional(),
    timeoutMs: z.number().positive().default(120_000),
    maxRetries: z.number().nonnegative().default(3),
    metadata: z.record(z.unknown()).default({}),
});

// ─── Edges (Connections between nodes) ─────────────────────────────────────

export const EdgePredicateSchema = z.object({
    field: z.string(),
    operator: z.enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'exists']),
    value: z.unknown(),
});

export const WorkflowEdgeSchema = z.object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    label: z.string().optional(),
    condition: EdgePredicateSchema.optional(),
    isFallback: z.boolean().default(false),
});

// ─── Workflow Definition ───────────────────────────────────────────────────

export const WorkflowDefinitionSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    description: z.string().default(''),
    version: z.number().int().positive().default(1),
    nodes: z.array(AgentNodeSchema).min(1),
    edges: z.array(WorkflowEdgeSchema),
    entryNodeId: z.string().min(1),
    defaultModel: ModelConfigSchema.optional(),
    maxCostUsd: z.number().positive().default(5.0),
    metadata: z.record(z.unknown()).default({}),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
});

// ─── Execution Step ────────────────────────────────────────────────────────

export const StepResultSchema = z.object({
    stepId: z.string().uuid(),
    runId: z.string().uuid(),
    nodeId: z.string().min(1),
    agentType: AgentTypeSchema,
    status: ExecutionStatusSchema,
    modelUsed: z.string().optional(),
    prompt: z.string().optional(),
    response: z.unknown().optional(),
    toolCalls: z.array(ToolCallSchema).default([]),
    toolResponses: z.array(ToolResponseSchema).default([]),
    tokensIn: z.number().nonnegative().default(0),
    tokensOut: z.number().nonnegative().default(0),
    costUsd: z.number().nonnegative().default(0),
    latencyMs: z.number().nonnegative().default(0),
    error: z.string().optional(),
    retryAttempt: z.number().nonnegative().default(0),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
});

// ─── Run ───────────────────────────────────────────────────────────────────

export const RunSchema = z.object({
    id: z.string().uuid(),
    workflowId: z.string().uuid(),
    status: ExecutionStatusSchema,
    userInput: z.unknown(),
    graphSnapshot: WorkflowDefinitionSchema.optional(),
    steps: z.array(StepResultSchema).default([]),
    totalCostUsd: z.number().nonnegative().default(0),
    totalTokensIn: z.number().nonnegative().default(0),
    totalTokensOut: z.number().nonnegative().default(0),
    totalLatencyMs: z.number().nonnegative().default(0),
    error: z.string().optional(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
});

// ─── API Schemas ───────────────────────────────────────────────────────────

export const CreateRunRequestSchema = z.object({
    workflowId: z.string().uuid(),
    input: z.unknown(),
    modelOverride: ModelConfigSchema.optional(),
    maxCostUsd: z.number().positive().optional(),
});

export const CreateWorkflowRequestSchema = WorkflowDefinitionSchema.omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
