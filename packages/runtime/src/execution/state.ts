// ─── Agent Studio: Execution State ────────────────────────────────────────
// Immutable execution state management using Immer for safe mutations.

import { produce } from 'immer';
import { v4 as uuid } from 'uuid';
import type {
    Run,
    StepResult,
    WorkflowDefinition,
    ExecutionStatus,
} from '@agent-studio/shared';

/**
 * Creates a fresh Run object to track an execution.
 */
export function createRunState(workflowId: string, userInput: unknown, workflow?: WorkflowDefinition): Run {
    return {
        id: uuid(),
        workflowId,
        status: 'pending',
        userInput,
        graphSnapshot: workflow,
        steps: [],
        totalCostUsd: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalLatencyMs: 0,
        createdAt: new Date().toISOString(),
    };
}

/**
 * Immutably updates run status.
 */
export function updateRunStatus(run: Run, status: ExecutionStatus, error?: string): Run {
    return produce(run, (draft) => {
        draft.status = status;
        if (error) draft.error = error;
        if (status === 'completed' || status === 'failed') {
            draft.completedAt = new Date().toISOString();
        }
    });
}

/**
 * Creates a fresh StepResult for a node about to execute.
 */
export function createStepState(runId: string, nodeId: string, agentType: string): StepResult {
    return {
        stepId: uuid(),
        runId,
        nodeId,
        agentType: agentType as StepResult['agentType'],
        status: 'running',
        toolCalls: [],
        toolResponses: [],
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: 0,
        retryAttempt: 0,
        startedAt: new Date().toISOString(),
    };
}

/**
 * Immutably appends a completed step to the run and updates aggregates.
 */
export function recordStepInRun(run: Run, step: StepResult): Run {
    return produce(run, (draft) => {
        draft.steps.push(step);
        draft.totalCostUsd += step.costUsd;
        draft.totalTokensIn += step.tokensIn;
        draft.totalTokensOut += step.tokensOut;
        draft.totalLatencyMs += step.latencyMs;
    });
}

/**
 * Marks a step as complete with timing and token data.
 */
export function completeStep(
    step: StepResult,
    result: {
        output: unknown;
        tokensIn: number;
        tokensOut: number;
        costUsd: number;
        modelUsed?: string;
        prompt?: string;
        toolCalls?: StepResult['toolCalls'];
        toolResponses?: StepResult['toolResponses'];
    },
): StepResult {
    return produce(step, (draft) => {
        draft.status = 'completed';
        draft.response = result.output;
        draft.tokensIn = result.tokensIn;
        draft.tokensOut = result.tokensOut;
        draft.costUsd = result.costUsd;
        draft.modelUsed = result.modelUsed;
        draft.prompt = result.prompt;
        draft.toolCalls = result.toolCalls ?? [];
        draft.toolResponses = result.toolResponses ?? [];
        draft.completedAt = new Date().toISOString();
        draft.latencyMs = Date.now() - new Date(draft.startedAt).getTime();
    });
}

/**
 * Marks a step as failed with error details.
 */
export function failStep(step: StepResult, error: string, retryAttempt: number): StepResult {
    return produce(step, (draft) => {
        draft.status = 'failed';
        draft.error = error;
        draft.retryAttempt = retryAttempt;
        draft.completedAt = new Date().toISOString();
        draft.latencyMs = Date.now() - new Date(draft.startedAt).getTime();
    });
}
