// ─── Agent Studio: Tool Executor ──────────────────────────────────────────
// Orchestrates the full tool execution pipeline:
// validate → sandbox/direct → record → return

import { v4 as uuid } from 'uuid';
import type { ToolCall, ToolResponse } from '@agent-studio/shared';
import { ErrorCode } from '@agent-studio/shared';
import type { ToolRegistry, RegisteredTool } from './registry.js';
import { ToolValidator, type CallerContext, type ValidationResult } from './validator.js';
import type { ToolSandbox } from './sandbox.js';

/**
 * Execution result from a complete tool call pipeline.
 */
export interface ToolExecutionResult {
    response: ToolResponse;
    validationResult: ValidationResult;
}

/**
 * ToolExecutor: End-to-end tool execution pipeline.
 *
 * 1. Validates through 5-layer pipeline
 * 2. Routes to sandbox or direct execution
 * 3. Applies timeout enforcement
 * 4. Records the response with timing data
 */
export class ToolExecutor {
    private validator: ToolValidator;

    constructor(
        private registry: ToolRegistry,
        private sandbox?: ToolSandbox,
        rateLimiter?: import('./rate-limiter.js').RateLimiter | import('./rate-limiter.js').InMemoryRateLimiter,
    ) {
        this.validator = new ToolValidator(registry, rateLimiter as any);
    }

    /**
     * Execute a tool call through the full pipeline.
     */
    async execute(
        toolCall: ToolCall,
        caller: CallerContext,
    ): Promise<ToolExecutionResult> {
        const startTime = Date.now();

        // ── Step 1: Validate ───────────────────────────────────────────────
        const validationResult = await this.validator.validate(
            toolCall.toolId,
            toolCall.arguments as Record<string, unknown>,
            caller,
        );

        if (!validationResult.valid) {
            return {
                validationResult,
                response: {
                    callId: toolCall.callId,
                    toolId: toolCall.toolId,
                    success: false,
                    error: validationResult.error,
                    durationMs: Date.now() - startTime,
                    timestamp: new Date().toISOString(),
                },
            };
        }

        // ── Step 2: Get tool ───────────────────────────────────────────────
        const tool = this.registry.get(toolCall.toolId)!;

        // ── Step 3: Execute with timeout ───────────────────────────────────
        try {
            const result = await this.executeWithTimeout(
                tool,
                toolCall.arguments as Record<string, unknown>,
                tool.definition.timeoutMs,
            );

            // ── Step 4: Validate output (if schema defined) ──────────────────
            if (tool.outputZodSchema) {
                const outputValidation = tool.outputZodSchema.safeParse(result);
                if (!outputValidation.success) {
                    return {
                        validationResult: { valid: true },
                        response: {
                            callId: toolCall.callId,
                            toolId: toolCall.toolId,
                            success: false,
                            error: `Tool output schema validation failed: ${outputValidation.error.message}`,
                            durationMs: Date.now() - startTime,
                            timestamp: new Date().toISOString(),
                        },
                    };
                }
            }

            return {
                validationResult: { valid: true },
                response: {
                    callId: toolCall.callId,
                    toolId: toolCall.toolId,
                    success: true,
                    result,
                    durationMs: Date.now() - startTime,
                    timestamp: new Date().toISOString(),
                },
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isTimeout = errorMessage.includes('timed out');

            return {
                validationResult: { valid: true },
                response: {
                    callId: toolCall.callId,
                    toolId: toolCall.toolId,
                    success: false,
                    error: errorMessage,
                    durationMs: Date.now() - startTime,
                    timestamp: new Date().toISOString(),
                },
            };
        }
    }

    /**
     * Execute a tool handler with timeout enforcement.
     */
    private async executeWithTimeout(
        tool: RegisteredTool,
        args: Record<string, unknown>,
        timeoutMs: number,
    ): Promise<unknown> {
        // If sandbox is available and tool is marked for sandboxing, use it
        if (this.sandbox && tool.definition.sandboxed) {
            return this.sandbox.execute(tool, args, timeoutMs);
        }

        // Direct execution with timeout
        return Promise.race([
            tool.handler(args),
            new Promise<never>((_, reject) =>
                setTimeout(
                    () => reject(new Error(`Tool "${tool.definition.id}" timed out after ${timeoutMs}ms`)),
                    timeoutMs,
                ),
            ),
        ]);
    }

    /**
     * Execute multiple tool calls in parallel with concurrency limit.
     */
    async executeBatch(
        toolCalls: ToolCall[],
        caller: CallerContext,
        concurrency: number = 5,
    ): Promise<ToolExecutionResult[]> {
        const results: ToolExecutionResult[] = [];

        // Simple sequential batching — can be upgraded to p-limit later
        for (let i = 0; i < toolCalls.length; i += concurrency) {
            const batch = toolCalls.slice(i, i + concurrency);
            const batchResults = await Promise.all(
                batch.map((tc) => this.execute(tc, caller)),
            );
            results.push(...batchResults);
        }

        return results;
    }
}
