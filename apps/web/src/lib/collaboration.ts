'use client';

// ─── Agent Studio: Yjs Collaborative Editing ──────────────────────────────
// Shared document for workflow graph state, synced across users in real-time.
// Supports awareness (cursor/selection visibility) and offline persistence.

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';

/**
 * User awareness state shown on the canvas.
 */
export interface UserAwareness {
    userId: string;
    name: string;
    color: string;
    cursor?: { x: number; y: number };
    selectedNodeId?: string;
    lastActive: number;
}

/**
 * Collaboration session managing Yjs document sync.
 */
export class CollaborationSession {
    public doc: Y.Doc;
    public wsProvider: WebsocketProvider | null = null;
    public idbPersistence: IndexeddbPersistence | null = null;

    private nodesMap: Y.Map<unknown>;
    private edgesMap: Y.Map<unknown>;
    private metadataMap: Y.Map<unknown>;

    constructor(
        private workflowId: string,
        private user: { userId: string; name: string; color: string },
    ) {
        this.doc = new Y.Doc();
        this.nodesMap = this.doc.getMap('nodes');
        this.edgesMap = this.doc.getMap('edges');
        this.metadataMap = this.doc.getMap('metadata');
    }

    /**
     * Connect to the collaboration server and initialize offline persistence.
     */
    connect(wsUrl?: string): void {
        const url = wsUrl ?? process.env.NEXT_PUBLIC_COLLAB_WS_URL ?? 'ws://localhost:1234';

        // WebSocket sync provider
        this.wsProvider = new WebsocketProvider(url, `workflow-${this.workflowId}`, this.doc);

        // Set awareness info
        this.wsProvider.awareness.setLocalStateField('user', {
            ...this.user,
            lastActive: Date.now(),
        } satisfies UserAwareness);

        // IndexedDB offline persistence
        this.idbPersistence = new IndexeddbPersistence(`agent-studio-${this.workflowId}`, this.doc);

        this.idbPersistence.on('synced', () => {
            console.info(`[Collab] Offline store synced for workflow ${this.workflowId}`);
        });

        this.wsProvider.on('status', (event: { status: string }) => {
            console.info(`[Collab] WebSocket ${event.status}`);
        });
    }

    /**
     * Disconnect and cleanup.
     */
    disconnect(): void {
        this.wsProvider?.disconnect();
        this.idbPersistence?.destroy();
        this.doc.destroy();
    }

    // ─── Node Operations ──────────────────────────────────────────────────

    /**
     * Set a node in the shared document.
     */
    setNode(nodeId: string, data: Record<string, unknown>): void {
        this.doc.transact(() => {
            this.nodesMap.set(nodeId, { id: nodeId, ...data, updatedAt: Date.now() });
        });
    }

    /**
     * Delete a node from the shared document.
     */
    deleteNode(nodeId: string): void {
        this.doc.transact(() => {
            this.nodesMap.delete(nodeId);
            // Also remove associated edges
            this.edgesMap.forEach((val, key) => {
                const edge = val as Record<string, unknown>;
                if (edge.source === nodeId || edge.target === nodeId) {
                    this.edgesMap.delete(key);
                }
            });
        });
    }

    /**
     * Move a node (update position only).
     */
    moveNode(nodeId: string, position: { x: number; y: number }): void {
        const existing = this.nodesMap.get(nodeId) as Record<string, unknown> | undefined;
        if (existing) {
            this.nodesMap.set(nodeId, { ...existing, position, updatedAt: Date.now() });
        }
    }

    /**
     * Get all nodes.
     */
    getNodes(): Record<string, unknown>[] {
        const nodes: Record<string, unknown>[] = [];
        this.nodesMap.forEach((val) => nodes.push(val as Record<string, unknown>));
        return nodes;
    }

    // ─── Edge Operations ──────────────────────────────────────────────────

    /**
     * Add or update an edge.
     */
    setEdge(edgeId: string, data: Record<string, unknown>): void {
        this.edgesMap.set(edgeId, { id: edgeId, ...data });
    }

    /**
     * Delete an edge.
     */
    deleteEdge(edgeId: string): void {
        this.edgesMap.delete(edgeId);
    }

    /**
     * Get all edges.
     */
    getEdges(): Record<string, unknown>[] {
        const edges: Record<string, unknown>[] = [];
        this.edgesMap.forEach((val) => edges.push(val as Record<string, unknown>));
        return edges;
    }

    // ─── Awareness ────────────────────────────────────────────────────────

    /**
     * Update local user's cursor position.
     */
    updateCursor(x: number, y: number): void {
        this.wsProvider?.awareness.setLocalStateField('user', {
            ...this.user,
            cursor: { x, y },
            lastActive: Date.now(),
        });
    }

    /**
     * Update selected node.
     */
    updateSelectedNode(nodeId: string | undefined): void {
        this.wsProvider?.awareness.setLocalStateField('user', {
            ...this.user,
            selectedNodeId: nodeId,
            lastActive: Date.now(),
        });
    }

    /**
     * Get all connected users' awareness states.
     */
    getConnectedUsers(): UserAwareness[] {
        if (!this.wsProvider) return [];
        const states = this.wsProvider.awareness.getStates();
        const users: UserAwareness[] = [];
        states.forEach((state) => {
            if (state.user) users.push(state.user as UserAwareness);
        });
        return users;
    }

    /**
     * Subscribe to awareness changes.
     */
    onAwarenessChange(callback: (users: UserAwareness[]) => void): void {
        this.wsProvider?.awareness.on('change', () => {
            callback(this.getConnectedUsers());
        });
    }

    /**
     * Subscribe to document changes.
     */
    onDocumentChange(callback: () => void): void {
        this.nodesMap.observe(callback);
        this.edgesMap.observe(callback);
    }
}
