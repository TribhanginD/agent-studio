// ─── Agent Studio: Workflow Store ─────────────────────────────────────────
// Data access layer for workflow definitions and version history.

import { eq, desc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import type { Database } from './connection.js';
import { workflows, workflowVersions } from './schema.js';

/**
 * WorkflowStore: CRUD operations for workflow definitions.
 */
export class WorkflowStore {
    constructor(private db: Database) { }

    /**
     * Save a workflow definition (insert or update with version bump).
     */
    async saveWorkflow(params: {
        id?: string;
        name: string;
        description?: string;
        graphJson: unknown;
        maxCostUsd?: number;
        createdBy?: string;
        changeDescription?: string;
    }): Promise<{ id: string; version: number }> {
        const existing = params.id
            ? await this.db.query.workflows.findFirst({ where: eq(workflows.id, params.id) })
            : null;

        if (existing) {
            // Update existing — bump version
            const newVersion = existing.version + 1;

            await this.db.update(workflows).set({
                name: params.name,
                description: params.description,
                version: newVersion,
                graphJson: params.graphJson,
                maxCostUsd: params.maxCostUsd,
                updatedAt: new Date(),
            }).where(eq(workflows.id, existing.id));

            // Store version snapshot
            await this.db.insert(workflowVersions).values({
                workflowId: existing.id,
                version: newVersion,
                graphJson: params.graphJson,
                changeDescription: params.changeDescription,
                changedBy: params.createdBy,
            });

            return { id: existing.id, version: newVersion };
        }

        // Insert new
        const id = params.id ?? uuid();
        await this.db.insert(workflows).values({
            id,
            name: params.name,
            description: params.description,
            graphJson: params.graphJson,
            maxCostUsd: params.maxCostUsd,
            createdBy: params.createdBy,
        });

        // Store initial version
        await this.db.insert(workflowVersions).values({
            workflowId: id,
            version: 1,
            graphJson: params.graphJson,
            changeDescription: 'Initial version',
            changedBy: params.createdBy,
        });

        return { id, version: 1 };
    }

    /**
     * Get a workflow by ID.
     */
    async getWorkflow(id: string) {
        return this.db.query.workflows.findFirst({ where: eq(workflows.id, id) });
    }

    /**
     * List all non-archived workflows.
     */
    async listWorkflows() {
        return this.db.query.workflows.findMany({
            where: eq(workflows.isArchived, false),
            orderBy: desc(workflows.updatedAt),
        });
    }

    /**
     * Get version history for a workflow.
     */
    async getVersionHistory(workflowId: string) {
        return this.db.query.workflowVersions.findMany({
            where: eq(workflowVersions.workflowId, workflowId),
            orderBy: desc(workflowVersions.version),
        });
    }

    /**
     * Get a specific version of a workflow.
     */
    async getVersion(workflowId: string, version: number) {
        return this.db.query.workflowVersions.findFirst({
            where: (wv, { and, eq }) => and(
                eq(wv.workflowId, workflowId),
                eq(wv.version, version),
            ),
        });
    }

    /**
     * Archive a workflow (soft delete).
     */
    async archiveWorkflow(id: string): Promise<void> {
        await this.db.update(workflows).set({
            isArchived: true,
            updatedAt: new Date(),
        }).where(eq(workflows.id, id));
    }
}
