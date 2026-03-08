// ─── Agent Studio: Executor Agent ──────────────────────────────────────────
// Executes tool calls against the tool registry to fulfill a task.

import type { AgentContext, AgentResult, ToolCall, ToolResponse, ChatMessage } from '@agent-studio/shared';
import { ModelRouter, ProviderAdapterManager, type ProviderRequest } from '@agent-studio/router';
import { ToolRegistry, ToolExecutor } from '@agent-studio/tools';
import { BaseAgent } from './base.js';

/**
 * ExecutorAgent: The workhorse agent that performs actions by calling tools.
 *
 * This agent:
 * 1. Receives a task (from planner output or direct input)
 * 2. Uses ModelRouter to select the most cost-effective model
 * 3. Enters a ReAct loop to execute tools until the task is complete
 */
export class ExecutorAgent extends BaseAgent {
    readonly type = 'executor' as const;
    readonly name = 'Executor';

    private adapterManager: ProviderAdapterManager;

    constructor(private router: ModelRouter, private toolRegistry: ToolRegistry) {
        super();
        this.adapterManager = new ProviderAdapterManager();
    }

    async execute(context: AgentContext): Promise<AgentResult> {
        const toolCalls: ToolCall[] = [];
        const toolResponses: ToolResponse[] = [];
        let tokensIn = 0;
        let tokensOut = 0;
        let costUsd = 0;

        const toolExecutor = new ToolExecutor(this.toolRegistry);

        // Build the prompt with predecessor context
        const predecessorContext = Object.entries(context.predecessorOutputs)
            .map(([nodeId, output]) => `[${nodeId}]: ${JSON.stringify(output)}`)
            .join('\n');

        const systemPrompt = `You are an executor agent. Use the available tools to accomplish the given task.
        
Available tools:
${context.tools.map((t) => `- ${t.id}: ${t.description}`).join('\n')}

${predecessorContext ? `Context from previous steps:\n${predecessorContext}` : ''}`;

        const userPrompt = context.node.prompt
            ? `${context.node.prompt}\n\nInput: ${JSON.stringify(context.userInput)}`
            : `Execute the task: ${JSON.stringify(context.userInput)}`;

        const messages: ChatMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        let isDone = false;
        let finalContent = '';
        const MAX_STEPS = 10; // Prevent infinite ReAct loops
        let stepCount = 0;

        while (!isDone && stepCount < MAX_STEPS) {
            stepCount++;

            // 1. Route the request to select the optimal model
            const hasTool = context.tools.length > 0;
            const decision = this.router.route({
                messages,
                tools: hasTool ? context.tools : undefined,
                providerLock: context.node.providerPreference,
                requiresToolCalling: hasTool,
                maxCostUsd: context.maxCostUsd - context.accumulatedCostUsd - costUsd
            });

            // 2. Execute the model via ProviderAdapter
            const adapter = this.adapterManager.get(decision.config.provider);
            if (!adapter) {
                throw new Error(`Provider adapter not found for ${decision.config.provider}`);
            }

            const request: ProviderRequest = {
                model: decision.config.model,
                messages,
                temperature: decision.config.temperature,
                maxTokens: decision.config.maxTokens,
                tools: context.tools
            };

            const response = await adapter.complete(request);

            // Accumulate metrics
            tokensIn += response.tokensIn;
            tokensOut += response.tokensOut;
            costUsd += this.router.estimateCost(decision.model, response.tokensIn, response.tokensOut);

            // Append assistant response to history
            messages.push({
                role: 'assistant',
                content: response.content || '',
                toolCalls: response.toolCalls
            });

            if (response.content) {
                finalContent = response.content;
            }

            // 3. Handle Tool Calls
            if (response.toolCalls && response.toolCalls.length > 0) {
                for (const tc of response.toolCalls) {
                    toolCalls.push(tc);
                    try {
                        const toolResult = await toolExecutor.execute(tc, {
                            userId: 'system',
                            runId: context.runId,
                            roles: ['admin']
                        });

                        const tr: ToolResponse = {
                            callId: tc.callId,
                            toolId: tc.toolId,
                            success: toolResult.response.success,
                            result: toolResult.response.result,
                            error: toolResult.response.error,
                            timestamp: new Date().toISOString(),
                            durationMs: toolResult.response.durationMs,
                        };
                        toolResponses.push(tr);

                        messages.push({
                            role: 'tool',
                            toolCallId: tc.callId,
                            name: tc.toolId,
                            content: toolResult.response.error
                                ? `Error: ${toolResult.response.error}`
                                : typeof toolResult.response.result === 'string'
                                    ? toolResult.response.result
                                    : JSON.stringify(toolResult.response.result)
                        });

                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        messages.push({
                            role: 'tool',
                            toolCallId: tc.callId,
                            name: tc.toolId,
                            content: `Critical Error: ${errorMessage}`
                        });
                    }
                }
            } else {
                // No tool calls means the LLM is done reasoning
                isDone = true;
            }
        }

        return {
            output: {
                result: finalContent,
                stepsTaken: stepCount
            },
            toolCalls,
            toolResponses,
            tokensIn,
            tokensOut,
            costUsd,
            metadata: { agentType: 'executor', steps: stepCount, modelUsed: messages.length > 2 ? 'routed dynamically' : 'none' }
        };
    }
}
