// ─── Agent Studio: Policy Engine ──────────────────────────────────────────
// Declarative policy enforcement evaluated at run start, before tool calls,
// and after each step. Supports ABAC via structured policy rules.

/**
 * Policy rule definition.
 */
export interface PolicyRule {
    name: string;
    description: string;
    type: 'run-level' | 'per-call' | 'per-step' | 'global';
    enabled: boolean;
    priority: number; // Higher = evaluated first
    condition: PolicyCondition;
    action: 'allow' | 'deny' | 'abort' | 'warn' | 'audit';
    metadata?: Record<string, unknown>;
}

/**
 * Condition that triggers a policy rule.
 */
export interface PolicyCondition {
    field: string;
    operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'contains' | 'matches';
    value: unknown;
}

/**
 * Context provided to the policy engine for evaluation.
 */
export interface PolicyContext {
    // Run context
    runId?: string;
    workflowId?: string;
    totalCostUsd?: number;
    maxCostUsd?: number;
    stepCount?: number;

    // User context
    userId?: string;
    userRoles?: string[];

    // Tool context
    toolId?: string;
    toolRequiredRole?: string;

    // Step context
    agentType?: string;
    model?: string;
    tokensIn?: number;
    tokensOut?: number;

    // Custom fields
    [key: string]: unknown;
}

/**
 * Result of policy evaluation.
 */
export interface PolicyResult {
    allowed: boolean;
    action: PolicyRule['action'];
    matchedRules: Array<{ name: string; action: string; reason: string }>;
    warnings: string[];
}

/**
 * PolicyEngine: Evaluates declarative policy rules against execution context.
 *
 * Features:
 * - Priority-ordered rule evaluation
 * - Short-circuit on deny/abort
 * - Audit trail of matched rules
 * - Built-in rules for common patterns
 */
export class PolicyEngine {
    private rules: PolicyRule[] = [];

    constructor(rules?: PolicyRule[]) {
        if (rules) {
            this.rules = [...rules].sort((a, b) => b.priority - a.priority);
        }
    }

    /**
     * Add a policy rule.
     */
    addRule(rule: PolicyRule): void {
        this.rules.push(rule);
        this.rules.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Evaluate all applicable rules against the given context.
     */
    evaluate(context: PolicyContext, ruleType?: PolicyRule['type']): PolicyResult {
        const applicableRules = this.rules.filter(
            (r) => r.enabled && (!ruleType || r.type === ruleType || r.type === 'global'),
        );

        const result: PolicyResult = {
            allowed: true,
            action: 'allow',
            matchedRules: [],
            warnings: [],
        };

        for (const rule of applicableRules) {
            if (this.evaluateCondition(rule.condition, context)) {
                result.matchedRules.push({
                    name: rule.name,
                    action: rule.action,
                    reason: rule.description,
                });

                if (rule.action === 'deny' || rule.action === 'abort') {
                    result.allowed = false;
                    result.action = rule.action;
                    return result; // Short-circuit
                }

                if (rule.action === 'warn') {
                    result.warnings.push(`[${rule.name}] ${rule.description}`);
                }
            }
        }

        return result;
    }

    /**
     * Get all registered rules.
     */
    getRules(): readonly PolicyRule[] {
        return this.rules;
    }

    /**
     * Load built-in default policies.
     */
    loadDefaults(): void {
        this.addRule({
            name: 'cost-cap',
            description: 'Abort if run total cost exceeds workflow max cost',
            type: 'per-step',
            enabled: true,
            priority: 100,
            condition: { field: 'totalCostUsd', operator: 'gte', value: '__maxCostUsd__' },
            action: 'abort',
        });

        this.addRule({
            name: 'cost-warning-80pct',
            description: 'Warn when run cost exceeds 80% of budget',
            type: 'per-step',
            enabled: true,
            priority: 90,
            condition: { field: '__costPercent__', operator: 'gte', value: 80 },
            action: 'warn',
        });

        this.addRule({
            name: 'tool-permission',
            description: 'Deny tool calls requiring roles the user does not have',
            type: 'per-call',
            enabled: true,
            priority: 95,
            condition: { field: '__missingRole__', operator: 'eq', value: true },
            action: 'deny',
        });

        this.addRule({
            name: 'max-steps',
            description: 'Abort if run exceeds 50 steps (runaway protection)',
            type: 'per-step',
            enabled: true,
            priority: 99,
            condition: { field: 'stepCount', operator: 'gt', value: 50 },
            action: 'abort',
        });

        this.addRule({
            name: 'large-output-audit',
            description: 'Audit steps with more than 4000 output tokens',
            type: 'per-step',
            enabled: true,
            priority: 50,
            condition: { field: 'tokensOut', operator: 'gt', value: 4000 },
            action: 'audit',
        });
    }

    // ─── Private ──────────────────────────────────────────────────────────

    private evaluateCondition(cond: PolicyCondition, context: PolicyContext): boolean {
        let fieldValue = this.resolveField(cond.field, context);
        let condValue = this.resolveValue(cond.value, context);

        switch (cond.operator) {
            case 'eq': return fieldValue === condValue;
            case 'neq': return fieldValue !== condValue;
            case 'gt': return Number(fieldValue) > Number(condValue);
            case 'gte': return Number(fieldValue) >= Number(condValue);
            case 'lt': return Number(fieldValue) < Number(condValue);
            case 'lte': return Number(fieldValue) <= Number(condValue);
            case 'in': return Array.isArray(condValue) && condValue.includes(fieldValue);
            case 'not_in': return Array.isArray(condValue) && !condValue.includes(fieldValue);
            case 'contains':
                return typeof fieldValue === 'string' && fieldValue.includes(String(condValue));
            case 'matches':
                return typeof fieldValue === 'string' && new RegExp(String(condValue)).test(fieldValue);
            default: return false;
        }
    }

    private resolveField(field: string, context: PolicyContext): unknown {
        // Special computed fields
        if (field === '__costPercent__') {
            const total = Number(context.totalCostUsd ?? 0);
            const max = Number(context.maxCostUsd ?? 1);
            return (total / max) * 100;
        }
        if (field === '__missingRole__') {
            const required = context.toolRequiredRole;
            const userRoles = context.userRoles ?? [];
            return required ? !userRoles.includes(required) : false;
        }
        return context[field];
    }

    private resolveValue(value: unknown, context: PolicyContext): unknown {
        if (typeof value === 'string' && value.startsWith('__') && value.endsWith('__')) {
            const key = value.slice(2, -2);
            return context[key];
        }
        return value;
    }
}
