// ─── Agent Studio: Multi-Tenant Architecture ─────────────────────────────
// Tenant isolation via scoped API keys, namespace isolation, and RLS helpers.

/**
 * Tenant definition.
 */
export interface Tenant {
    id: string;
    name: string;
    plan: 'free' | 'pro' | 'enterprise';
    apiKeyHash: string;
    maxCostPerMonthUsd: number;
    maxConcurrentRuns: number;
    allowedModels: string[];
    createdAt: Date;
    metadata?: Record<string, unknown>;
}

/**
 * TenantContext: Request-scoped tenant information.
 */
export interface TenantContext {
    tenantId: string;
    plan: Tenant['plan'];
    remainingBudget: number;
    allowedModels: string[];
}

/**
 * TenantManager: Manages tenant isolation and enforcement.
 */
export class TenantManager {
    private tenants: Map<string, Tenant> = new Map();
    private apiKeyIndex: Map<string, string> = new Map(); // hash → tenantId
    private monthlyUsage: Map<string, number> = new Map(); // tenantId → cost this month

    /**
     * Register a tenant.
     */
    registerTenant(tenant: Tenant): void {
        this.tenants.set(tenant.id, tenant);
        this.apiKeyIndex.set(tenant.apiKeyHash, tenant.id);
        this.monthlyUsage.set(tenant.id, 0);
    }

    /**
     * Resolve tenant from API key hash.
     */
    resolveTenant(apiKeyHash: string): TenantContext | null {
        const tenantId = this.apiKeyIndex.get(apiKeyHash);
        if (!tenantId) return null;

        const tenant = this.tenants.get(tenantId);
        if (!tenant) return null;

        const usage = this.monthlyUsage.get(tenantId) ?? 0;

        return {
            tenantId: tenant.id,
            plan: tenant.plan,
            remainingBudget: tenant.maxCostPerMonthUsd - usage,
            allowedModels: tenant.allowedModels,
        };
    }

    /**
     * Record cost usage for a tenant.
     */
    recordUsage(tenantId: string, costUsd: number): void {
        const current = this.monthlyUsage.get(tenantId) ?? 0;
        this.monthlyUsage.set(tenantId, current + costUsd);
    }

    /**
     * Check if a tenant can execute a run.
     */
    canExecute(tenantId: string): { allowed: boolean; reason?: string } {
        const tenant = this.tenants.get(tenantId);
        if (!tenant) return { allowed: false, reason: 'Tenant not found' };

        const usage = this.monthlyUsage.get(tenantId) ?? 0;
        if (usage >= tenant.maxCostPerMonthUsd) {
            return { allowed: false, reason: `Monthly budget exhausted ($${usage.toFixed(2)}/$${tenant.maxCostPerMonthUsd})` };
        }

        return { allowed: true };
    }

    /**
     * Get tenant limits for plan-based enforcement.
     */
    getLimits(tenantId: string): {
        maxCostPerRun: number;
        maxStepsPerRun: number;
        allowedTools: string[];
    } {
        const tenant = this.tenants.get(tenantId);
        if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

        const planLimits: Record<string, { maxCostPerRun: number; maxSteps: number; tools: string[] }> = {
            free: { maxCostPerRun: 0.50, maxSteps: 10, tools: ['json-transform', 'text-summary'] },
            pro: { maxCostPerRun: 10.00, maxSteps: 50, tools: ['json-transform', 'text-summary', 'web-search', 'http-request'] },
            enterprise: { maxCostPerRun: 100.00, maxSteps: 200, tools: ['*'] },
        };

        const limits = planLimits[tenant.plan] ?? planLimits.free;

        return {
            maxCostPerRun: limits.maxCostPerRun,
            maxStepsPerRun: limits.maxSteps,
            allowedTools: limits.tools,
        };
    }

    /**
     * Generate PostgreSQL Row-Level Security SQL for tenant isolation.
     */
    static generateRlsSql(tableName: string): string {
        return [
            `-- Enable RLS on ${tableName}`,
            `ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;`,
            ``,
            `-- Policy: tenants can only access their own rows`,
            `CREATE POLICY tenant_isolation_${tableName} ON ${tableName}`,
            `  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);`,
            ``,
            `-- Policy: tenants can only insert their own rows`,
            `CREATE POLICY tenant_insert_${tableName} ON ${tableName}`,
            `  FOR INSERT`,
            `  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);`,
        ].join('\n');
    }

    /**
     * Generate RLS for all core tables.
     */
    static generateFullRlsSql(): string {
        const tables = ['workflows', 'workflow_versions', 'runs', 'run_steps', 'audit_log', 'tool_definitions'];
        return tables.map((t) => TenantManager.generateRlsSql(t)).join('\n\n');
    }
}
