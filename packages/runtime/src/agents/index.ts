// ─── Agent Studio: Agent Registry ──────────────────────────────────────────
// Central registry for agent type → implementation mapping.

import type { AgentType } from '@agent-studio/shared';
import { ModelRouter } from '@agent-studio/router';
import { ToolRegistry, registerBuiltinTools } from '@agent-studio/tools';

import { BaseAgent } from './base.js';
import { PlannerAgent } from './planner.js';
import { ExecutorAgent } from './executor.js';
import { ValidatorAgent } from './validator.js';
import { RetrievalAgent } from './retrieval.js';

export { BaseAgent } from './base.js';
export { PlannerAgent } from './planner.js';
export { ExecutorAgent } from './executor.js';
export { ValidatorAgent } from './validator.js';
export { RetrievalAgent } from './retrieval.js';

/**
 * AgentRegistry: Maps agent type strings to their concrete implementations.
 * Supports registration of custom agent types at runtime.
 */
export class AgentRegistry {
    private agents = new Map<string, BaseAgent>();
    public readonly router: ModelRouter;
    public readonly toolRegistry: ToolRegistry;

    constructor(router?: ModelRouter, toolRegistry?: ToolRegistry) {
        this.router = router ?? new ModelRouter();

        if (toolRegistry) {
            this.toolRegistry = toolRegistry;
        } else {
            this.toolRegistry = new ToolRegistry();
            registerBuiltinTools(this.toolRegistry);
        }

        // Register built-in agent types
        this.register('planner', new PlannerAgent(this.router));
        this.register('executor', new ExecutorAgent(this.router, this.toolRegistry));
        this.register('validator', new ValidatorAgent(this.router));
        this.register('retrieval', new RetrievalAgent());
    }

    /**
     * Register a custom agent implementation.
     */
    register(type: string, agent: BaseAgent): void {
        this.agents.set(type, agent);
    }

    /**
     * Get the agent implementation for a given type.
     * Throws if the agent type is not registered.
     */
    get(type: string): BaseAgent {
        const agent = this.agents.get(type);
        if (!agent) {
            throw new Error(`No agent registered for type: "${type}". Available types: ${[...this.agents.keys()].join(', ')}`);
        }
        return agent;
    }

    /**
     * Check if an agent type is registered.
     */
    has(type: string): boolean {
        return this.agents.has(type);
    }

    /**
     * List all registered agent types.
     */
    listTypes(): string[] {
        return [...this.agents.keys()];
    }
}
