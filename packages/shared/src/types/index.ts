// ─── Agent Studio: Inferred Types ──────────────────────────────────────────
// All types are derived from Zod schemas — single source of truth.

import { z } from 'zod';
import {
    AgentTypeSchema,
    ExecutionStatusSchema,
    ModelProviderSchema,
    ModelConfigSchema,
    ToolPermissionSchema,
    ToolDefinitionSchema,
    ToolCallSchema,
    ToolResponseSchema,
    AgentNodeSchema,
    EdgePredicateSchema,
    WorkflowEdgeSchema,
    WorkflowDefinitionSchema,
    StepResultSchema,
    RunSchema,
    CreateRunRequestSchema,
    CreateWorkflowRequestSchema,
} from '../schemas/index.js';

// ─── Inferred Types ───────────────────────────────────────────────────────

export type AgentType = z.infer<typeof AgentTypeSchema>;
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type ToolPermission = z.infer<typeof ToolPermissionSchema>;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ToolResponse = z.infer<typeof ToolResponseSchema>;
export type AgentNode = z.infer<typeof AgentNodeSchema>;
export type EdgePredicate = z.infer<typeof EdgePredicateSchema>;
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type StepResult = z.infer<typeof StepResultSchema>;
export type Run = z.infer<typeof RunSchema>;
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;
export type CreateWorkflowRequest = z.infer<typeof CreateWorkflowRequestSchema>;

// ─── Runtime-Only Types (not schema-backed) ───────────────────────────────

/**
 * Context passed to each agent node during execution.
 */
export interface AgentContext {
    /** Unique run identifier */
    runId: string;
    /** Current step identifier */
    stepId: string;
    /** The agent node definition */
    node: AgentNode;
    /** User's original input */
    userInput: unknown;
    /** Outputs from predecessor nodes, keyed by node ID */
    predecessorOutputs: Record<string, unknown>;
    /** Available tool definitions for this agent */
    /** Available tool definitions for this agent */
    tools: ToolDefinition[];
    /** Accumulated cost so far in this run */
    accumulatedCostUsd: number;
    /** Cost cap for the entire run */
    maxCostUsd: number;
    /** Retry attempt number (0 = first attempt) */
    retryAttempt: number;
}

/**
 * Result returned by an agent after execution.
 */
export interface AgentResult {
    output: unknown;
    toolCalls: ToolCall[];
    toolResponses: ToolResponse[];
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    metadata?: Record<string, unknown>;
}

/**
 * Provider adapter interface for the model router.
 */
export interface ModelProviderAdapter {
    readonly provider: ModelProvider;
    readonly supportedModels: string[];

    chat(
        messages: ChatMessage[],
        config: ModelConfig,
        options?: ModelCallOptions,
    ): Promise<ModelResponse>;

    streamChat(
        messages: ChatMessage[],
        config: ModelConfig,
        options?: ModelCallOptions,
    ): AsyncIterable<ModelStreamChunk>;

    countTokens(text: string, model: string): Promise<number>;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    toolCallId?: string;
    name?: string;
    toolCalls?: ToolCall[];
}

export interface ModelCallOptions {
    signal?: AbortSignal;
    tools?: ToolDefinition[];
    toolChoice?: 'auto' | 'required' | 'none';
}

export interface ModelResponse {
    content: string;
    toolCalls?: ToolCall[];
    tokensIn: number;
    tokensOut: number;
    model: string;
    finishReason: string;
    latencyMs: number;
}

export interface ModelStreamChunk {
    content?: string;
    toolCall?: Partial<ToolCall>;
    tokensOut?: number;
    done?: boolean;
}

/**
 * SSE stream event sent to the frontend during execution.
 */
export interface StreamEventPayload {
    event: string;
    runId: string;
    stepId?: string;
    nodeId?: string;
    data: unknown;
    timestamp: string;
}

/**
 * Structured platform error.
 */
export interface AgentStudioError {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    stepId?: string;
    nodeId?: string;
    timestamp: string;
}
