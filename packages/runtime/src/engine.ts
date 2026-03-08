// ─── Agent Studio: DAG Engine ──────────────────────────────────────────────
// Graph-based execution engine using graphology-dag for structure analysis
// and LangGraph.js patterns for stateful agent orchestration.

import DirectedGraph from 'graphology';
import { hasCycle, topologicalSort, topologicalGenerations } from 'graphology-dag';
import { v4 as uuid } from 'uuid';
import type { WorkflowDefinition, AgentNode, WorkflowEdge } from '@agent-studio/shared';
import { ErrorCode } from '@agent-studio/shared';

/**
 * Represents a parallel execution layer — all nodes in a generation
 * can execute concurrently because they have no interdependencies.
 */
export interface ExecutionLayer {
    /** Layer index (0 = root nodes, increases toward leaf nodes) */
    index: number;
    /** Node IDs in this layer that can run in parallel */
    nodeIds: string[];
}

/**
 * Validated and analyzed DAG ready for execution.
 * This is the output of the DAGEngine.compile() method.
 */
export interface CompiledDAG {
    /** The underlying graphology directed graph */
    graph: DirectedGraph;
    /** Execution layers for parallel scheduling */
    layers: ExecutionLayer[];
    /** Topologically sorted node IDs */
    sortedNodeIds: string[];
    /** Entry node ID */
    entryNodeId: string;
    /** Leaf node IDs (nodes with no successors) */
    exitNodeIds: string[];
    /** Node lookup map */
    nodeMap: Map<string, AgentNode>;
    /** Edge lookup map (keyed by edge ID) */
    edgeMap: Map<string, WorkflowEdge>;
    /** Predecessor map: nodeId → [predecessor node IDs] */
    predecessors: Map<string, string[]>;
}

/**
 * DAGEngine: Compiles a WorkflowDefinition into a validated, analyzable
 * directed acyclic graph. Handles cycle detection, topological sorting,
 * and parallel layer computation.
 */
export class DAGEngine {
    /**
     * Compiles a workflow definition into a validated execution DAG.
     * Throws if the graph is invalid (cycles, missing nodes, etc).
     */
    compile(workflow: WorkflowDefinition): CompiledDAG {
        const graph = new DirectedGraph();
        const nodeMap = new Map<string, AgentNode>();
        const edgeMap = new Map<string, WorkflowEdge>();
        const predecessors = new Map<string, string[]>();

        // ── Add nodes ──────────────────────────────────────────────────────
        for (const node of workflow.nodes) {
            if (graph.hasNode(node.id)) {
                throw new DAGValidationError(
                    ErrorCode.VALIDATION_ERROR,
                    `Duplicate node ID: "${node.id}"`,
                );
            }
            graph.addNode(node.id, { ...node });
            nodeMap.set(node.id, node);
            predecessors.set(node.id, []);
        }

        // ── Validate entry node exists ─────────────────────────────────────
        if (!graph.hasNode(workflow.entryNodeId)) {
            throw new DAGValidationError(
                ErrorCode.NODE_NOT_FOUND,
                `Entry node "${workflow.entryNodeId}" not found in workflow nodes`,
            );
        }

        // ── Add edges ──────────────────────────────────────────────────────
        for (const edge of workflow.edges) {
            if (!graph.hasNode(edge.source)) {
                throw new DAGValidationError(
                    ErrorCode.NODE_NOT_FOUND,
                    `Edge source "${edge.source}" not found in workflow nodes`,
                );
            }
            if (!graph.hasNode(edge.target)) {
                throw new DAGValidationError(
                    ErrorCode.NODE_NOT_FOUND,
                    `Edge target "${edge.target}" not found in workflow nodes`,
                );
            }

            const edgeKey = graph.addDirectedEdge(edge.source, edge.target, { ...edge });
            edgeMap.set(edge.id, edge);

            // Track predecessors
            const preds = predecessors.get(edge.target) ?? [];
            preds.push(edge.source);
            predecessors.set(edge.target, preds);
        }

        // ── Cycle detection ────────────────────────────────────────────────
        if (hasCycle(graph)) {
            throw new DAGValidationError(
                ErrorCode.CYCLE_DETECTED,
                'Workflow graph contains a cycle — DAG execution requires an acyclic graph',
            );
        }

        // ── Topological analysis ───────────────────────────────────────────
        const sortedNodeIds = topologicalSort(graph);
        const generations = topologicalGenerations(graph);

        const layers: ExecutionLayer[] = generations.map((gen, index) => ({
            index,
            nodeIds: gen,
        }));

        // ── Find exit nodes (no outgoing edges) ────────────────────────────
        const exitNodeIds = graph
            .nodes()
            .filter((nodeId) => graph.outDegree(nodeId) === 0);

        return {
            graph,
            layers,
            sortedNodeIds,
            entryNodeId: workflow.entryNodeId,
            exitNodeIds,
            nodeMap,
            edgeMap,
            predecessors,
        };
    }

    /**
     * Returns the predecessor node IDs for a given node in the compiled DAG.
     */
    getPredecessors(dag: CompiledDAG, nodeId: string): string[] {
        return dag.predecessors.get(nodeId) ?? [];
    }

    /**
     * Returns the outgoing edges from a node, optionally filtered by a predicate.
     */
    getOutgoingEdges(dag: CompiledDAG, nodeId: string): WorkflowEdge[] {
        const edges: WorkflowEdge[] = [];
        dag.graph.forEachOutEdge(nodeId, (_edge, attributes) => {
            edges.push(attributes as unknown as WorkflowEdge);
        });
        return edges;
    }

    /**
     * Evaluates edge conditions to determine which target nodes should execute next.
     * Returns node IDs of all valid targets.
     */
    evaluateEdges(
        dag: CompiledDAG,
        nodeId: string,
        nodeOutput: unknown,
    ): { nextNodeIds: string[]; fallbackNodeIds: string[] } {
        const outEdges = this.getOutgoingEdges(dag, nodeId);
        const nextNodeIds: string[] = [];
        const fallbackNodeIds: string[] = [];

        for (const edge of outEdges) {
            if (edge.isFallback) {
                fallbackNodeIds.push(edge.target);
                continue;
            }

            if (!edge.condition) {
                // Unconditional edge — always follow
                nextNodeIds.push(edge.target);
                continue;
            }

            // Evaluate condition
            if (this.evaluateCondition(edge.condition, nodeOutput)) {
                nextNodeIds.push(edge.target);
            }
        }

        return { nextNodeIds, fallbackNodeIds };
    }

    /**
     * Evaluates a single edge predicate against a node's output.
     */
    private evaluateCondition(
        condition: { field: string; operator: string; value?: unknown },
        output: unknown,
    ): boolean {
        const fieldValue = this.getNestedValue(output, condition.field);

        switch (condition.operator) {
            case 'eq':
                return fieldValue === condition.value;
            case 'neq':
                return fieldValue !== condition.value;
            case 'gt':
                return (fieldValue as number) > (condition.value as number);
            case 'lt':
                return (fieldValue as number) < (condition.value as number);
            case 'gte':
                return (fieldValue as number) >= (condition.value as number);
            case 'lte':
                return (fieldValue as number) <= (condition.value as number);
            case 'contains':
                return String(fieldValue).includes(String(condition.value));
            case 'exists':
                return fieldValue !== undefined && fieldValue !== null;
            default:
                return false;
        }
    }

    /**
     * Safely accesses a nested value via dot-notation path (e.g., "result.status").
     */
    private getNestedValue(obj: unknown, path: string): unknown {
        return path.split('.').reduce((current: unknown, key: string) => {
            if (current === null || current === undefined) return undefined;
            return (current as Record<string, unknown>)[key];
        }, obj);
    }
}

/**
 * Structured error for DAG validation failures.
 */
export class DAGValidationError extends Error {
    constructor(
        public readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = 'DAGValidationError';
    }
}
