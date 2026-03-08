// ─── Agent Studio: Self-Healing Reflector Agent ──────────────────────────
// Intercepts execution failures, analyzes the error type, generates a
// revised prompt with error context injected, and retries with backoff.

import type { StepResult } from '@agent-studio/shared';

/**
 * Error classification for targeted prompt revision.
 */
export type ErrorCategory =
    | 'schema_mismatch'      // Output doesn't match expected schema
    | 'tool_failure'         // A tool call failed
    | 'llm_refusal'          // Model refused to answer
    | 'timeout'              // Step timed out
    | 'rate_limited'         // Provider rate limit hit
    | 'cost_exceeded'        // Cost cap exceeded
    | 'validation_failed'    // Validator rejected output
    | 'unknown';

interface ReflectorConfig {
    maxRetries: number;
    backoffBaseMs: number;
    backoffMultiplier: number;
    confidenceThreshold: number;
}

interface ReflectionResult {
    revisedPrompt: string;
    errorCategory: ErrorCategory;
    attempt: number;
    analysis: string;
    shouldRetry: boolean;
    confidenceScore: number;
}

/**
 * ReflectorAgent: Analyzes failures and generates corrective prompts.
 *
 * Instead of simply retrying failed steps, the reflector:
 * 1. Classifies the error into a category
 * 2. Generates a contextual analysis
 * 3. Revises the original prompt with error context + guidance
 * 4. Scores confidence on whether the retry will succeed
 * 5. Decides whether to retry or escalate
 */
export class ReflectorAgent {
    private config: ReflectorConfig;

    constructor(config?: Partial<ReflectorConfig>) {
        this.config = {
            maxRetries: config?.maxRetries ?? 3,
            backoffBaseMs: config?.backoffBaseMs ?? 1000,
            backoffMultiplier: config?.backoffMultiplier ?? 2,
            confidenceThreshold: config?.confidenceThreshold ?? 0.4,
        };
    }

    /**
     * Classify an error into a structured category.
     */
    classifyError(error: string, context?: { toolName?: string; model?: string }): ErrorCategory {
        const lower = error.toLowerCase();

        if (lower.includes('schema') || lower.includes('validation') || lower.includes('expected type'))
            return 'schema_mismatch';
        if (lower.includes('tool') && (lower.includes('failed') || lower.includes('error')))
            return 'tool_failure';
        if (lower.includes('refuse') || lower.includes('cannot assist') || lower.includes('content policy'))
            return 'llm_refusal';
        if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('deadline'))
            return 'timeout';
        if (lower.includes('rate limit') || lower.includes('429') || lower.includes('too many'))
            return 'rate_limited';
        if (lower.includes('cost') || lower.includes('budget') || lower.includes('cap exceeded'))
            return 'cost_exceeded';
        if (lower.includes('validator') || lower.includes('quality') || lower.includes('rejected'))
            return 'validation_failed';

        return 'unknown';
    }

    /**
     * Generate a reflection analysis and revised prompt for retry.
     */
    reflect(params: {
        originalPrompt: string;
        error: string;
        previousOutput?: unknown;
        attempt: number;
        nodeId: string;
        agentType: string;
    }): ReflectionResult {
        const category = this.classifyError(params.error);
        const shouldRetry = params.attempt < this.config.maxRetries && this.isRetryable(category);

        // Generate analysis based on the error category
        const analysis = this.generateAnalysis(category, params.error, params.agentType);

        // Compute confidence score (decreases with each attempt)
        const baseConfidence = this.getBaseConfidence(category);
        const confidenceScore = baseConfidence * Math.pow(0.7, params.attempt - 1);

        // Generate revised prompt with error context
        const revisedPrompt = this.revisePrompt(
            params.originalPrompt,
            category,
            params.error,
            params.previousOutput,
            params.attempt,
        );

        return {
            revisedPrompt,
            errorCategory: category,
            attempt: params.attempt,
            analysis,
            shouldRetry: shouldRetry && confidenceScore >= this.config.confidenceThreshold,
            confidenceScore,
        };
    }

    /**
     * Compute backoff delay for a retry attempt.
     */
    getBackoffMs(attempt: number): number {
        return this.config.backoffBaseMs * Math.pow(this.config.backoffMultiplier, attempt - 1);
    }

    // ─── Private Methods ──────────────────────────────────────────────────

    private isRetryable(category: ErrorCategory): boolean {
        // Non-retryable errors
        if (category === 'cost_exceeded' || category === 'llm_refusal') return false;
        return true;
    }

    private getBaseConfidence(category: ErrorCategory): number {
        const scores: Record<ErrorCategory, number> = {
            schema_mismatch: 0.8,   // High — schema guidance usually fixes this
            tool_failure: 0.6,       // Medium — tool might be flaky
            llm_refusal: 0.1,        // Very low — rephrasing rarely helps
            timeout: 0.5,            // Medium — might just be transient
            rate_limited: 0.9,       // High — just needs backoff
            cost_exceeded: 0.0,      // Cannot retry
            validation_failed: 0.7,  // High — guidance helps
            unknown: 0.4,            // Low — unknown failure mode
        };
        return scores[category];
    }

    private generateAnalysis(category: ErrorCategory, error: string, agentType: string): string {
        const analyses: Record<ErrorCategory, string> = {
            schema_mismatch: `The ${agentType} agent produced output that doesn't match the expected schema. The revised prompt will include explicit schema requirements and an example of valid output.`,
            tool_failure: `A tool call within the ${agentType} agent failed. The revised prompt will instruct the agent to use alternative tools or approaches.`,
            llm_refusal: `The model refused to generate a response. This is typically a content policy issue and is not retryable.`,
            timeout: `The ${agentType} agent exceeded its timeout. The revised prompt will request a more concise response.`,
            rate_limited: `The provider returned a rate limit error. Retrying after backoff should resolve this.`,
            cost_exceeded: `The cost cap has been exceeded. No further execution is possible without increasing the budget.`,
            validation_failed: `The validator rejected the ${agentType} agent's output. The revised prompt will include the validation feedback.`,
            unknown: `An unexpected error occurred in the ${agentType} agent: ${error.slice(0, 100)}`,
        };
        return analyses[category];
    }

    private revisePrompt(
        original: string,
        category: ErrorCategory,
        error: string,
        previousOutput: unknown,
        attempt: number,
    ): string {
        const errorContext = `\n\n---\n⚠️ RETRY CONTEXT (Attempt ${attempt + 1}/${this.config.maxRetries})\nPrevious attempt failed with: ${error}\n`;

        const guidance: Record<ErrorCategory, string> = {
            schema_mismatch: 'IMPORTANT: Your output MUST strictly follow the expected JSON schema. Do not include any extra fields or markdown formatting.',
            tool_failure: 'NOTE: The tool call failed previously. Try an alternative approach or use different tools if available.',
            timeout: 'IMPORTANT: Be concise and direct. Avoid lengthy explanations. Prioritize speed.',
            rate_limited: '', // No prompt revision needed, just backoff
            validation_failed: `The validator found issues with your previous output. Please address: ${error}`,
            llm_refusal: 'Please rephrase your approach to comply with content guidelines.',
            cost_exceeded: '',
            unknown: `Previous error: ${error}. Please try a different approach.`,
        };

        const previousOutputStr = previousOutput
            ? `\nPrevious (rejected) output:\n${JSON.stringify(previousOutput, null, 2).slice(0, 500)}\n`
            : '';

        return `${original}${errorContext}${previousOutputStr}\n${guidance[category]}`;
    }
}
