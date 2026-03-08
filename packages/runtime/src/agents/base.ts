// ─── Agent Studio: Base Agent ──────────────────────────────────────────────
// Abstract base class for all agent types with lifecycle hooks.

import type { AgentContext, AgentResult } from '@agent-studio/shared';

/**
 * BaseAgent: Abstract foundation for all agent type implementations.
 *
 * Provides lifecycle hooks and a structured execution flow:
 *   onEnter → execute → onExit (or onError → onRetry)
 *
 * Subclasses MUST implement `execute()`.
 * Subclasses MAY override lifecycle hooks for custom behavior.
 */
export abstract class BaseAgent {
    abstract readonly type: string;
    abstract readonly name: string;

    /**
     * Main execution method — must be implemented by each agent type.
     * Receives full context including predecessors' outputs, available tools, and model config.
     */
    abstract execute(context: AgentContext): Promise<AgentResult>;

    /**
     * Called before execution begins.
     * Use for: prompt preparation, context enrichment, pre-validation.
     */
    async onEnter(context: AgentContext): Promise<void> {
        // Default: no-op. Override in subclass.
    }

    /**
     * Called after successful execution.
     * Use for: output post-processing, logging, cleanup.
     */
    async onExit(context: AgentContext, result: AgentResult): Promise<AgentResult> {
        // Default: pass through result unchanged.
        return result;
    }

    /**
     * Called when execution throws an error.
     * Use for: error classification, metric emission, cleanup.
     * Return true to allow retry, false to propagate failure immediately.
     */
    async onError(context: AgentContext, error: Error): Promise<boolean> {
        // Default: allow retry if retries remain.
        return context.retryAttempt < (context.node.maxRetries ?? 3);
    }

    /**
     * Called before a retry attempt.
     * Use for: modifying the prompt, adjusting model config, logging.
     * Receives the error that caused the retry.
     */
    async onRetry(context: AgentContext, error: Error, attempt: number): Promise<void> {
        // Default: no-op. Override for self-healing behavior.
    }

    /**
     * Full execution lifecycle — called by the runner.
     * Handles the enter → execute → exit/error/retry flow.
     */
    async run(context: AgentContext): Promise<AgentResult> {
        await this.onEnter(context);

        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= (context.node.maxRetries ?? 3); attempt++) {
            try {
                const updatedContext: AgentContext = { ...context, retryAttempt: attempt };

                if (attempt > 0 && lastError) {
                    await this.onRetry(updatedContext, lastError, attempt);
                }

                const result = await this.execute(updatedContext);
                return await this.onExit(updatedContext, result);
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                const shouldRetry = await this.onError(
                    { ...context, retryAttempt: attempt },
                    lastError,
                );

                if (!shouldRetry || attempt >= (context.node.maxRetries ?? 3)) {
                    throw lastError;
                }

                // Exponential backoff
                const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }

        throw lastError ?? new Error('Agent execution failed after all retries');
    }
}
