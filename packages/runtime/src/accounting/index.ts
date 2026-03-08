// ─── Agent Studio: Fine-Grained Token Accounting ──────────────────────────
// Middleware that intercepts every LLM call and records exact token counts,
// attributed to: user, workflow, run, step, model.

/**
 * Token usage record attributed across all dimensions.
 */
export interface TokenRecord {
    id: string;
    timestamp: number;
    // Attribution
    tenantId: string;
    userId: string;
    workflowId: string;
    runId: string;
    stepId: string;
    nodeId: string;
    // Model
    model: string;
    provider: string;
    // Tokens
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    // Cost
    costUsd: number;
    // Pricing used (for audit)
    inputPricePer1k: number;
    outputPricePer1k: number;
}

/**
 * Aggregated token stats.
 */
export interface TokenAggregate {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    recordCount: number;
}

/**
 * TokenAccountant: Records and queries fine-grained token usage.
 */
export class TokenAccountant {
    private records: TokenRecord[] = [];
    private idCounter = 0;

    /**
     * Record a token usage event.
     */
    record(params: Omit<TokenRecord, 'id' | 'timestamp' | 'totalTokens' | 'costUsd'> & {
        inputPricePer1k: number;
        outputPricePer1k: number;
    }): TokenRecord {
        const totalTokens = params.promptTokens + params.completionTokens;
        const costUsd =
            (params.promptTokens / 1000) * params.inputPricePer1k +
            (params.completionTokens / 1000) * params.outputPricePer1k;

        const record: TokenRecord = {
            id: `tok-${++this.idCounter}`,
            timestamp: Date.now(),
            ...params,
            totalTokens,
            costUsd,
        };

        this.records.push(record);
        return record;
    }

    /**
     * Aggregate by a specific dimension.
     */
    aggregateBy(dimension: keyof TokenRecord, filter?: Partial<TokenRecord>): Map<string, TokenAggregate> {
        const groups = new Map<string, TokenAggregate>();

        for (const record of this.records) {
            // Apply filter
            if (filter) {
                let match = true;
                for (const [key, value] of Object.entries(filter)) {
                    if ((record as any)[key] !== value) { match = false; break; }
                }
                if (!match) continue;
            }

            const groupKey = String((record as any)[dimension]);
            const agg = groups.get(groupKey) ?? {
                totalPromptTokens: 0,
                totalCompletionTokens: 0,
                totalTokens: 0,
                totalCostUsd: 0,
                recordCount: 0,
            };

            agg.totalPromptTokens += record.promptTokens;
            agg.totalCompletionTokens += record.completionTokens;
            agg.totalTokens += record.totalTokens;
            agg.totalCostUsd += record.costUsd;
            agg.recordCount += 1;

            groups.set(groupKey, agg);
        }

        return groups;
    }

    /**
     * Get cost breakdown by model for a given run.
     */
    getCostByModel(runId: string): Map<string, TokenAggregate> {
        return this.aggregateBy('model', { runId } as any);
    }

    /**
     * Get cost breakdown by tenant.
     */
    getCostByTenant(): Map<string, TokenAggregate> {
        return this.aggregateBy('tenantId');
    }

    /**
     * Get cost breakdown by workflow.
     */
    getCostByWorkflow(): Map<string, TokenAggregate> {
        return this.aggregateBy('workflowId');
    }

    /**
     * Get total usage for a specific run.
     */
    getRunTotal(runId: string): TokenAggregate {
        const agg = { totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, totalCostUsd: 0, recordCount: 0 };
        for (const r of this.records) {
            if (r.runId === runId) {
                agg.totalPromptTokens += r.promptTokens;
                agg.totalCompletionTokens += r.completionTokens;
                agg.totalTokens += r.totalTokens;
                agg.totalCostUsd += r.costUsd;
                agg.recordCount++;
            }
        }
        return agg;
    }

    /**
     * Get all records (for export/persistence).
     */
    getRecords(): readonly TokenRecord[] {
        return this.records;
    }

    /**
     * Get total across all records.
     */
    getTotal(): TokenAggregate {
        const agg = { totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, totalCostUsd: 0, recordCount: 0 };
        for (const r of this.records) {
            agg.totalPromptTokens += r.promptTokens;
            agg.totalCompletionTokens += r.completionTokens;
            agg.totalTokens += r.totalTokens;
            agg.totalCostUsd += r.costUsd;
            agg.recordCount++;
        }
        return agg;
    }
}
