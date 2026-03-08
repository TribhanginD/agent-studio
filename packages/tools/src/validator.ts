// ─── Agent Studio: 5-Layer Tool Validation Pipeline ───────────────────────
// Validates every tool call through 5 sequential layers before execution.
// Any layer failure short-circuits the pipeline with a structured error.

import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import type { ToolCall, ToolResponse } from '@agent-studio/shared';
import { ErrorCode } from '@agent-studio/shared';
import type { ToolRegistry, RegisteredTool } from './registry.js';
import type { RateLimiter } from './rate-limiter.js';

/**
 * Caller context for permission checks.
 */
export interface CallerContext {
    userId: string;
    roles: string[];
    runId: string;
}

/**
 * Validation result from the pipeline.
 */
export interface ValidationResult {
    valid: boolean;
    layer?: string;
    error?: string;
    errorCode?: string;
}

/**
 * ToolValidator: 5-layer validation pipeline.
 *
 * Layer 1: Existence    — tool exists in registry
 * Layer 2: Schema       — input matches Zod schema
 * Layer 3: Permission   — caller has required roles
 * Layer 4: Rate Limit   — within allowed call frequency
 * Layer 5: Resource     — within timeout and memory limits
 */
export class ToolValidator {
    constructor(
        private registry: ToolRegistry,
        private rateLimiter?: RateLimiter,
    ) { }

    /**
     * Runs all 5 validation layers sequentially.
     * Returns the first failure or { valid: true } if all pass.
     */
    async validate(
        toolId: string,
        args: Record<string, unknown>,
        caller: CallerContext,
    ): Promise<ValidationResult> {
        // ── Layer 1: Existence ─────────────────────────────────────────────
        const tool = this.registry.get(toolId);
        if (!tool) {
            return {
                valid: false,
                layer: 'existence',
                error: `Tool "${toolId}" not found in registry. Available: ${this.registry.listIds().join(', ')}`,
                errorCode: ErrorCode.TOOL_NOT_FOUND,
            };
        }

        if (tool.definition.deprecated) {
            // Log warning but don't block — deprecated tools are still callable
            console.warn(`[ToolValidator] Tool "${toolId}" is deprecated (v${tool.definition.version})`);
        }

        // ── Layer 2: Schema Validation ─────────────────────────────────────
        const schemaResult = this.validateSchema(tool, args);
        if (!schemaResult.valid) return schemaResult;

        // ── Layer 3: Permission Check ──────────────────────────────────────
        const permResult = this.validatePermissions(tool, caller);
        if (!permResult.valid) return permResult;

        // ── Layer 4: Rate Limit Check ──────────────────────────────────────
        const rateResult = await this.validateRateLimit(tool, caller);
        if (!rateResult.valid) return rateResult;

        // ── Layer 5: Resource Limits (pre-check) ───────────────────────────
        const resourceResult = this.validateResourceLimits(tool);
        if (!resourceResult.valid) return resourceResult;

        return { valid: true };
    }

    /**
     * Layer 2: Validates input arguments against the tool's Zod schema.
     */
    private validateSchema(tool: RegisteredTool, args: Record<string, unknown>): ValidationResult {
        const result = tool.inputZodSchema.safeParse(args);
        if (!result.success) {
            const issues = result.error.issues.map(
                (issue) => `${issue.path.join('.')}: ${issue.message}`,
            );
            return {
                valid: false,
                layer: 'schema',
                error: `Schema validation failed for tool "${tool.definition.id}":\n${issues.join('\n')}`,
                errorCode: ErrorCode.TOOL_SCHEMA_INVALID,
            };
        }
        return { valid: true };
    }

    /**
     * Layer 3: Checks caller has required roles for this tool.
     */
    private validatePermissions(tool: RegisteredTool, caller: CallerContext): ValidationResult {
        const requiredRoles = tool.definition.permissions.requiredRoles;
        if (requiredRoles.length === 0) return { valid: true };

        const hasPermission = requiredRoles.some((role) => caller.roles.includes(role));
        if (!hasPermission) {
            return {
                valid: false,
                layer: 'permission',
                error: `Caller lacks required roles for tool "${tool.definition.id}". ` +
                    `Required: [${requiredRoles.join(', ')}], Has: [${caller.roles.join(', ')}]`,
                errorCode: ErrorCode.TOOL_PERMISSION_DENIED,
            };
        }
        return { valid: true };
    }

    /**
     * Layer 4: Checks rate limit using Redis-backed sliding window.
     */
    private async validateRateLimit(
        tool: RegisteredTool,
        caller: CallerContext,
    ): Promise<ValidationResult> {
        const rateLimit = tool.definition.permissions.rateLimit;
        if (!rateLimit || !this.rateLimiter) return { valid: true };

        const key = `tool:${tool.definition.id}:user:${caller.userId}`;
        const allowed = await this.rateLimiter.checkAndIncrement(
            key,
            rateLimit.maxCalls,
            rateLimit.windowSeconds,
        );

        if (!allowed) {
            return {
                valid: false,
                layer: 'rate_limit',
                error: `Rate limit exceeded for tool "${tool.definition.id}": ` +
                    `max ${rateLimit.maxCalls} calls per ${rateLimit.windowSeconds}s`,
                errorCode: ErrorCode.TOOL_RATE_LIMITED,
            };
        }
        return { valid: true };
    }

    /**
     * Layer 5: Pre-validates resource limits are configured properly.
     * Actual enforcement (timeout, memory) happens at execution time.
     */
    private validateResourceLimits(tool: RegisteredTool): ValidationResult {
        if (tool.definition.timeoutMs <= 0) {
            return {
                valid: false,
                layer: 'resource',
                error: `Invalid timeout for tool "${tool.definition.id}": ${tool.definition.timeoutMs}ms`,
                errorCode: ErrorCode.VALIDATION_ERROR,
            };
        }
        return { valid: true };
    }
}
