// ─── Agent Studio: Validator Agent ─────────────────────────────────────────
// Validates outputs from upstream agents against expected schemas or criteria.

import type { AgentContext, AgentResult, ChatMessage } from '@agent-studio/shared';
import { ModelRouter, ProviderAdapterManager, type ProviderRequest } from '@agent-studio/router';
import { BaseAgent } from './base.js';

/**
 * ValidatorAgent: Quality gate that inspects upstream agent outputs.
 *
 * This agent:
 * 1. Receives outputs from predecessor agents
 * 2. Validates them against schema or semantic criteria
 * 3. Returns a validation verdict (pass/fail with reasons)
 *
 * When validation fails, the runner can route to fallback nodes.
 */
export class ValidatorAgent extends BaseAgent {
    readonly type = 'validator' as const;
    readonly name = 'Validator';

    private adapterManager: ProviderAdapterManager;

    constructor(private router: ModelRouter) {
        super();
        this.adapterManager = new ProviderAdapterManager();
    }

    async execute(context: AgentContext): Promise<AgentResult> {
        const predecessorOutputs = context.predecessorOutputs;
        const validationResults: Record<string, { valid: boolean; reason: string }> = {};

        let tokensIn = 0;
        let tokensOut = 0;
        let costUsd = 0;

        // If no predecessors, we can't really "validate" them semantically, just pass.
        if (Object.keys(predecessorOutputs).length === 0) {
            return {
                output: { valid: true, results: {}, validatedAt: new Date().toISOString() },
                toolCalls: [],
                toolResponses: [],
                tokensIn: 0,
                tokensOut: 0,
                costUsd: 0,
                metadata: { agentType: 'validator', allValid: true },
            };
        }

        // Validate each predecessor's output
        for (const [nodeId, output] of Object.entries(predecessorOutputs)) {
            const systemPrompt = `You are a strict quality gate and validator agent.
Your task is to evaluate the output of a previous agent step against the user's overarching intent or prompt.

Output a strictly valid JSON object with the following structure:
{
  "valid": <boolean>,
  "reason": "<string detailing why it passed or failed>"
}`;

            const userPrompt = `Overarching Task/Criteria: 
${context.node.prompt || JSON.stringify(context.userInput)}

Output to validate (from node ${nodeId}):
${JSON.stringify(output)}

Evaluate if the output successfully fulfills the criteria.`;

            const messages: ChatMessage[] = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ];

            const decision = this.router.route({
                messages,
                providerLock: context.node.providerPreference,
                complexityHint: 'simple', // Validation is usually simpler
                maxCostUsd: context.maxCostUsd - context.accumulatedCostUsd - costUsd
            });

            const adapter = this.adapterManager.get(decision.config.provider);
            if (!adapter) throw new Error(`Provider adapter not found for ${decision.config.provider}`);

            const request: ProviderRequest = {
                model: decision.config.model,
                messages,
                temperature: 0.1,
                maxTokens: 512,
            };

            const response = await adapter.complete(request);

            tokensIn += response.tokensIn;
            tokensOut += response.tokensOut;
            costUsd += this.router.estimateCost(decision.model, response.tokensIn, response.tokensOut);

            let resultData = { valid: true, reason: 'unparsed response assumed valid' };
            try {
                let content = response.content;
                const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
                if (jsonMatch) content = jsonMatch[1];

                const parsed = JSON.parse(content);
                if (typeof parsed.valid === 'boolean') {
                    resultData = { valid: parsed.valid, reason: parsed.reason || 'No reason provided' };
                }
            } catch (e) {
                resultData = { valid: false, reason: 'Failed to parse JSON validation response from model' };
            }

            validationResults[nodeId] = resultData;
        }

        const allValid = Object.values(validationResults).every((r) => r.valid);

        return {
            output: {
                valid: allValid,
                results: validationResults,
                validatedAt: new Date().toISOString(),
            },
            toolCalls: [],
            toolResponses: [],
            tokensIn,
            tokensOut,
            costUsd,
            metadata: { agentType: 'validator', allValid },
        };
    }
}
