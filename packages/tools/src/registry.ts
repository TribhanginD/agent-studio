// ─── Agent Studio: Tool Registry ──────────────────────────────────────────
// Central registry for tool definitions with Zod schema enforcement.
// Tools are registered with their schemas, permissions, and resource limits.
// The registry auto-converts Zod schemas to JSON Schema for LLM consumption.

import { z, type ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { v4 as uuid } from 'uuid';
import type { ToolDefinition, ToolPermission } from '@agent-studio/shared';
import { Defaults } from '@agent-studio/shared';

/**
 * Options for registering a tool via the fluent builder API.
 */
export interface ToolRegistrationOptions<TInput extends ZodType, TOutput extends ZodType> {
    /** Unique tool identifier */
    id: string;
    /** Human-readable name */
    name: string;
    /** Description shown to LLMs */
    description: string;
    /** Zod schema for validating input arguments */
    inputSchema: TInput;
    /** Optional Zod schema for validating output */
    outputSchema?: TOutput;
    /** Version string (semver) */
    version?: string;
    /** Permission requirements */
    permissions?: {
        requiredRoles?: string[];
        rateLimit?: { maxCalls: number; windowSeconds: number };
    };
    /** Execution timeout in ms */
    timeoutMs?: number;
    /** Maximum memory in bytes */
    maxMemoryBytes?: number;
    /** Whether to run in WASM sandbox */
    sandboxed?: boolean;
    /** The actual handler function */
    handler: (input: z.infer<TInput>) => Promise<z.infer<TOutput>>;
}

/**
 * Internal representation of a registered tool including its handler and Zod schemas.
 */
export interface RegisteredTool {
    definition: ToolDefinition;
    inputZodSchema: ZodType;
    outputZodSchema?: ZodType;
    handler: (input: unknown) => Promise<unknown>;
}

/**
 * ToolRegistry: Central hub for managing tool definitions.
 *
 * Features:
 * - Zod schema validation on input/output
 * - Auto-conversion of Zod → JSON Schema for LLM tool calling
 * - Permission and rate limit metadata
 * - Version tracking and deprecation support
 * - Handler execution with timeout enforcement
 */
export class ToolRegistry {
    private tools = new Map<string, RegisteredTool>();

    /**
     * Register a tool with full type-safe schema validation.
     */
    register<TInput extends ZodType, TOutput extends ZodType>(
        options: ToolRegistrationOptions<TInput, TOutput>,
    ): void {
        if (this.tools.has(options.id)) {
            throw new ToolRegistryError(`Tool "${options.id}" is already registered`);
        }

        const inputJsonSchema = zodToJsonSchema(options.inputSchema, {
            name: `${options.id}_input`,
            target: 'openApi3',
        });

        const outputJsonSchema = options.outputSchema
            ? zodToJsonSchema(options.outputSchema, {
                name: `${options.id}_output`,
                target: 'openApi3',
            })
            : undefined;

        const definition: ToolDefinition = {
            id: options.id,
            name: options.name,
            description: options.description,
            version: options.version ?? '1.0.0',
            deprecated: false,
            inputSchema: inputJsonSchema as Record<string, unknown>,
            outputSchema: outputJsonSchema as Record<string, unknown> | undefined,
            permissions: {
                requiredRoles: options.permissions?.requiredRoles ?? [],
                rateLimit: options.permissions?.rateLimit,
            },
            timeoutMs: options.timeoutMs ?? Defaults.TOOL_TIMEOUT_MS,
            maxMemoryBytes: options.maxMemoryBytes,
            sandboxed: options.sandboxed ?? false,
        };

        this.tools.set(options.id, {
            definition,
            inputZodSchema: options.inputSchema,
            outputZodSchema: options.outputSchema,
            handler: options.handler as (input: unknown) => Promise<unknown>,
        });
    }

    /**
     * Retrieve a registered tool by ID.
     */
    get(toolId: string): RegisteredTool | undefined {
        return this.tools.get(toolId);
    }

    /**
     * Check if a tool is registered.
     */
    has(toolId: string): boolean {
        return this.tools.has(toolId);
    }

    /**
     * Get just the ToolDefinition (without handler) for a given tool.
     * This is what gets sent to LLMs.
     */
    getDefinition(toolId: string): ToolDefinition | undefined {
        return this.tools.get(toolId)?.definition;
    }

    /**
     * Get all tool definitions (for LLM consumption).
     */
    getAllDefinitions(): ToolDefinition[] {
        return [...this.tools.values()].map((t) => t.definition);
    }

    /**
     * Get all non-deprecated tool definitions.
     */
    getActiveDefinitions(): ToolDefinition[] {
        return [...this.tools.values()]
            .filter((t) => !t.definition.deprecated)
            .map((t) => t.definition);
    }

    /**
     * Mark a tool as deprecated (still callable but flagged).
     */
    deprecate(toolId: string): void {
        const tool = this.tools.get(toolId);
        if (!tool) throw new ToolRegistryError(`Tool "${toolId}" not found`);
        tool.definition.deprecated = true;
    }

    /**
     * Remove a tool from the registry entirely.
     */
    unregister(toolId: string): boolean {
        return this.tools.delete(toolId);
    }

    /**
     * List all registered tool IDs.
     */
    listIds(): string[] {
        return [...this.tools.keys()];
    }

    /**
     * Get count of registered tools.
     */
    get size(): number {
        return this.tools.size;
    }
}

export class ToolRegistryError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ToolRegistryError';
    }
}
