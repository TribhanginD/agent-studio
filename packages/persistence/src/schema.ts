// ─── Agent Studio: Drizzle ORM Schema ─────────────────────────────────────
// PostgreSQL schema for run persistence, workflow versioning, and audit logging.
// All tables use UUIDs. JSONB columns store flexible structured data.

import {
    pgTable,
    uuid,
    varchar,
    text,
    integer,
    real,
    boolean,
    timestamp,
    jsonb,
    index,
    serial,
} from 'drizzle-orm/pg-core';

// ─── Workflows ────────────────────────────────────────────────────────────

/**
 * Workflow definitions — the DAG blueprints.
 */
export const workflows = pgTable('workflows', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    version: integer('version').notNull().default(1),
    graphJson: jsonb('graph_json').notNull(),
    maxCostUsd: real('max_cost_usd').default(5.0),
    createdBy: varchar('created_by', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    isArchived: boolean('is_archived').notNull().default(false),
    metadata: jsonb('metadata').default({}),
}, (table) => [
    index('workflows_name_idx').on(table.name),
    index('workflows_created_by_idx').on(table.createdBy),
]);

/**
 * Workflow version history — stores snapshots on every save.
 */
export const workflowVersions = pgTable('workflow_versions', {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    graphJson: jsonb('graph_json').notNull(),
    changeDescription: text('change_description'),
    changedBy: varchar('changed_by', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    index('wv_workflow_id_idx').on(table.workflowId),
    index('wv_version_idx').on(table.workflowId, table.version),
]);

// ─── Runs ─────────────────────────────────────────────────────────────────

/**
 * Execution runs — one row per workflow execution.
 */
export const runs = pgTable('runs', {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id').notNull().references(() => workflows.id),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    userInput: jsonb('user_input'),
    graphSnapshot: jsonb('graph_snapshot'),
    totalCostUsd: real('total_cost_usd').notNull().default(0),
    totalTokensIn: integer('total_tokens_in').notNull().default(0),
    totalTokensOut: integer('total_tokens_out').notNull().default(0),
    totalLatencyMs: integer('total_latency_ms').notNull().default(0),
    error: text('error'),
    triggeredBy: varchar('triggered_by', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    metadata: jsonb('metadata').default({}),
}, (table) => [
    index('runs_workflow_id_idx').on(table.workflowId),
    index('runs_status_idx').on(table.status),
    index('runs_created_at_idx').on(table.createdAt),
]);

/**
 * Run steps — individual agent execution records within a run.
 * This is the core audit trail for replay and analysis.
 */
export const runSteps = pgTable('run_steps', {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
    nodeId: varchar('node_id', { length: 255 }).notNull(),
    agentType: varchar('agent_type', { length: 50 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('running'),
    prompt: text('prompt'),
    response: jsonb('response'),
    modelUsed: varchar('model_used', { length: 100 }),
    toolCalls: jsonb('tool_calls').default([]),
    toolResponses: jsonb('tool_responses').default([]),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    retryAttempt: integer('retry_attempt').notNull().default(0),
    error: text('error'),
    predecessorOutputs: jsonb('predecessor_outputs'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
    index('steps_run_id_idx').on(table.runId),
    index('steps_node_id_idx').on(table.nodeId),
    index('steps_agent_type_idx').on(table.agentType),
    index('steps_started_at_idx').on(table.startedAt),
]);

// ─── Audit Log ────────────────────────────────────────────────────────────

/**
 * Audit log — immutable record of every significant action.
 */
export const auditLog = pgTable('audit_log', {
    id: serial('id').primaryKey(),
    runId: uuid('run_id').references(() => runs.id),
    stepId: uuid('step_id'),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    eventData: jsonb('event_data').notNull(),
    userId: varchar('user_id', { length: 255 }),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    index('audit_run_id_idx').on(table.runId),
    index('audit_event_type_idx').on(table.eventType),
    index('audit_timestamp_idx').on(table.timestamp),
]);

// ─── Tool Definitions ─────────────────────────────────────────────────────

/**
 * Persisted tool registry — for versioning tool configurations.
 */
export const toolDefinitions = pgTable('tool_definitions', {
    id: varchar('id', { length: 255 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description').notNull(),
    version: varchar('version', { length: 50 }).notNull().default('1.0.0'),
    deprecated: boolean('deprecated').notNull().default(false),
    inputSchema: jsonb('input_schema').notNull(),
    outputSchema: jsonb('output_schema'),
    permissions: jsonb('permissions').default({}),
    timeoutMs: integer('timeout_ms').notNull().default(30000),
    maxMemoryBytes: integer('max_memory_bytes'),
    sandboxed: boolean('sandboxed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
