// ─── Agent Studio: Planner Agent ───────────────────────────────────────────
// Decomposes a user task into structured sub-steps for downstream agents.

import type { AgentContext, AgentResult, ChatMessage } from '@agent-studio/shared';
import { ModelRouter, ProviderAdapterManager, type ProviderRequest } from '@agent-studio/router';
import { BaseAgent } from './base.js';

/**
 * PlannerAgent: Takes a high-level user input and produces a structured
 * execution plan. The plan is consumed by downstream Executor/Validator nodes.
 */
export class PlannerAgent extends BaseAgent {
    readonly type = 'planner' as const;
    readonly name = 'Planner';

    private adapterManager: ProviderAdapterManager;

    constructor(private router: ModelRouter) {
        super();
        this.adapterManager = new ProviderAdapterManager();
    }

    async execute(context: AgentContext): Promise<AgentResult> {
        const systemPrompt = `You are a planning agent. Given the user's task, decompose it into clear, actionable sub-steps.

Output a strictly valid JSON object with the following structure:
{
  "plan": [
    { "step": 1, "action": "description", "agentType": "executor|validator|retrieval", "tools": ["tool_id"] }
  ],
  "reasoning": "why this plan was chosen"
}

Available tools: ${context.tools.map((t) => `${t.id}: ${t.description}`).join(', ')}`;

        const userPrompt = context.node.prompt
            ? `${context.node.prompt}\n\nUser input: ${JSON.stringify(context.userInput)}`
            : `Plan the following task: ${JSON.stringify(context.userInput)}`;

        const messages: ChatMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        // 1. Route the request (Planner needs structured output / reasoning)
        const decision = this.router.route({
            messages,
            providerLock: context.node.providerPreference,
            complexityHint: 'reasoning',
            maxCostUsd: context.maxCostUsd - context.accumulatedCostUsd
        });

        // 2. Execute via provider
        const adapter = this.adapterManager.get(decision.config.provider);
        if (!adapter) {
            throw new Error(`Provider adapter not found for ${decision.config.provider}`);
        }

        const request: ProviderRequest = {
            model: decision.config.model,
            messages,
            temperature: 0.1, // Low temp for planning json
            maxTokens: decision.config.maxTokens,
            // No tools — Planner only needs structured text output
            responseFormat: 'json',
        };

        const response = await adapter.complete(request);
        const costUsd = this.router.estimateCost(decision.model, response.tokensIn, response.tokensOut);

        // 3. Parse output JSON
        let outputData: any;
        try {
            // Attempt to extract JSON from markdown fences if any
            let content = response.content;
            const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (jsonMatch) {
                content = jsonMatch[1];
            }
            outputData = JSON.parse(content);
        } catch (e) {
            // Fallback: wrap raw content in plan structure if JSON parsing fails
            const rawText = response.content?.trim() || 'No response content';
            outputData = {
                plan: [{ step: 1, action: rawText, agentType: 'executor', tools: [] }],
                reasoning: 'Used fallback — LLM did not output valid JSON',
                rawResponse: rawText,
            };
        }

        return {
            output: outputData,
            toolCalls: [],
            toolResponses: [],
            tokensIn: response.tokensIn,
            tokensOut: response.tokensOut,
            costUsd,
            metadata: { agentType: 'planner', modelUsed: decision.config.model },
        };
    }
}
