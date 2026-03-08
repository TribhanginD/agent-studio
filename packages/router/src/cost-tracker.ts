// ─── Agent Studio: Cost Tracker ───────────────────────────────────────────
// Per-run cost accumulation with real-time tracking and cap enforcement.

import { ErrorCode } from '@agent-studio/shared';

/**
 * Records cost for a single model call.
 */
export interface CostRecord {
    modelId: string;
    provider: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    stepId: string;
    timestamp: number;
}

/**
 * CostTracker: Tracks cumulative cost across a run and enforces caps.
 *
 * Features:
 * - Per-step cost recording
 * - Running total computation
 * - Cap enforcement with configurable threshold
 * - Cost breakdown by model and provider
 * - Warning emission as cap is approached (80% threshold)
 */
export class CostTracker {
    private records: CostRecord[] = [];
    private totalCostUsd = 0;
    private maxCostUsd: number;
    private warningThreshold: number;
    private warningEmitted = false;

    constructor(maxCostUsd: number, warningThresholdPercent: number = 0.8) {
        this.maxCostUsd = maxCostUsd;
        this.warningThreshold = maxCostUsd * warningThresholdPercent;
    }

    /**
     * Record cost for a completed model call.
     * Throws if the cost cap would be exceeded.
     */
    record(record: CostRecord): { warning?: string } {
        const projectedTotal = this.totalCostUsd + record.costUsd;

        if (projectedTotal > this.maxCostUsd) {
            throw new CostCapError(
                `Cost cap exceeded: $${projectedTotal.toFixed(4)} > $${this.maxCostUsd.toFixed(2)} limit`,
                this.totalCostUsd,
                record.costUsd,
                this.maxCostUsd,
            );
        }

        this.records.push(record);
        this.totalCostUsd = projectedTotal;

        // Emit warning at threshold
        if (!this.warningEmitted && this.totalCostUsd >= this.warningThreshold) {
            this.warningEmitted = true;
            return {
                warning: `Cost warning: $${this.totalCostUsd.toFixed(4)} of $${this.maxCostUsd.toFixed(2)} used (${((this.totalCostUsd / this.maxCostUsd) * 100).toFixed(0)}%)`,
            };
        }

        return {};
    }

    /**
     * Check if a projected cost would exceed the cap (without recording).
     */
    wouldExceedCap(additionalCostUsd: number): boolean {
        return this.totalCostUsd + additionalCostUsd > this.maxCostUsd;
    }

    /**
     * Get the remaining budget.
     */
    getRemainingBudget(): number {
        return Math.max(0, this.maxCostUsd - this.totalCostUsd);
    }

    /**
     * Get total accumulated cost.
     */
    getTotalCost(): number {
        return this.totalCostUsd;
    }

    /**
     * Get cost breakdown by model.
     */
    getCostByModel(): Record<string, number> {
        const breakdown: Record<string, number> = {};
        for (const record of this.records) {
            breakdown[record.modelId] = (breakdown[record.modelId] ?? 0) + record.costUsd;
        }
        return breakdown;
    }

    /**
     * Get cost breakdown by provider.
     */
    getCostByProvider(): Record<string, number> {
        const breakdown: Record<string, number> = {};
        for (const record of this.records) {
            breakdown[record.provider] = (breakdown[record.provider] ?? 0) + record.costUsd;
        }
        return breakdown;
    }

    /**
     * Get all cost records.
     */
    getRecords(): readonly CostRecord[] {
        return this.records;
    }

    /**
     * Get a summary of the cost tracking state.
     */
    getSummary(): {
        totalCostUsd: number;
        maxCostUsd: number;
        remainingUsd: number;
        utilizationPercent: number;
        totalCalls: number;
        byModel: Record<string, number>;
        byProvider: Record<string, number>;
    } {
        return {
            totalCostUsd: this.totalCostUsd,
            maxCostUsd: this.maxCostUsd,
            remainingUsd: this.getRemainingBudget(),
            utilizationPercent: (this.totalCostUsd / this.maxCostUsd) * 100,
            totalCalls: this.records.length,
            byModel: this.getCostByModel(),
            byProvider: this.getCostByProvider(),
        };
    }
}

export class CostCapError extends Error {
    constructor(
        message: string,
        public readonly currentCost: number,
        public readonly attemptedCost: number,
        public readonly maxCost: number,
    ) {
        super(message);
        this.name = 'CostCapError';
    }
}
