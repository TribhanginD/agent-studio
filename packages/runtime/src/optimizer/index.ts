// ─── Agent Studio: Graph Auto-Optimizer ───────────────────────────────────
// Heuristic optimizer that analyzes topological generations and suggests
// optimizations: merge sequential same-model nodes, parallelize independent
// branches, suggest model downgrades for simple steps.

export interface OptimizationSuggestion {
    type: 'merge' | 'parallelize' | 'downgrade' | 'remove_redundant';
    description: string;
    nodeIds: string[];
    estimatedSavings: {
        costReductionPercent?: number;
        latencyReductionPercent?: number;
    };
    confidence: number; // 0-1
}

interface NodeInfo {
    id: string;
    type: string;
    model?: string;
    prompt?: string;
    tools?: string[];
}

interface EdgeInfo {
    source: string;
    target: string;
}

/**
 * GraphOptimizer: Analyzes workflow graphs and suggests optimizations.
 */
export class GraphOptimizer {

    /**
     * Analyze a graph and return optimization suggestions.
     */
    analyze(nodes: NodeInfo[], edges: EdgeInfo[]): OptimizationSuggestion[] {
        const suggestions: OptimizationSuggestion[] = [];

        suggestions.push(...this.findMergeOpportunities(nodes, edges));
        suggestions.push(...this.findParallelizationOpportunities(nodes, edges));
        suggestions.push(...this.findDowngradeOpportunities(nodes, edges));
        suggestions.push(...this.findRedundantNodes(nodes, edges));

        // Sort by confidence descending
        return suggestions.sort((a, b) => b.confidence - a.confidence);
    }

    // ─── Merge Sequential Same-Model Nodes ────────────────────────────────

    private findMergeOpportunities(nodes: NodeInfo[], edges: EdgeInfo[]): OptimizationSuggestion[] {
        const suggestions: OptimizationSuggestion[] = [];
        const outDegree = new Map<string, string[]>();
        const inDegree = new Map<string, string[]>();

        for (const node of nodes) {
            outDegree.set(node.id, []);
            inDegree.set(node.id, []);
        }
        for (const edge of edges) {
            outDegree.get(edge.source)?.push(edge.target);
            inDegree.get(edge.target)?.push(edge.source);
        }

        // Find sequential pairs (A → B where A has 1 out and B has 1 in)
        for (const node of nodes) {
            const successors = outDegree.get(node.id) ?? [];
            if (successors.length !== 1) continue;

            const successor = nodes.find((n) => n.id === successors[0]);
            if (!successor) continue;

            const predecessors = inDegree.get(successor.id) ?? [];
            if (predecessors.length !== 1) continue;

            // Same model and same type = merge candidate
            if (node.model === successor.model && node.type === successor.type) {
                suggestions.push({
                    type: 'merge',
                    description: `Merge sequential "${node.id}" and "${successor.id}" (both use ${node.model})`,
                    nodeIds: [node.id, successor.id],
                    estimatedSavings: { costReductionPercent: 15, latencyReductionPercent: 20 },
                    confidence: 0.85,
                });
            }
        }

        return suggestions;
    }

    // ─── Parallelize Independent Branches ─────────────────────────────────

    private findParallelizationOpportunities(nodes: NodeInfo[], edges: EdgeInfo[]): OptimizationSuggestion[] {
        const suggestions: OptimizationSuggestion[] = [];
        const outDegree = new Map<string, string[]>();
        const inDegree = new Map<string, string[]>();

        for (const node of nodes) {
            outDegree.set(node.id, []);
            inDegree.set(node.id, []);
        }
        for (const edge of edges) {
            outDegree.get(edge.source)?.push(edge.target);
            inDegree.get(edge.target)?.push(edge.source);
        }

        // Find nodes that are sequential but could be parallel
        // (share a common predecessor but don't depend on each other)
        for (const node of nodes) {
            const successors = outDegree.get(node.id) ?? [];
            if (successors.length < 2) continue;

            // Check if any pair of successors are chained (A→B→C instead of A→B, A→C)
            for (let i = 0; i < successors.length; i++) {
                for (let j = i + 1; j < successors.length; j++) {
                    const a = successors[i];
                    const b = successors[j];

                    // Already parallel — good
                    // Check if one depends on the other
                    if (this.hasPath(a, b, outDegree) || this.hasPath(b, a, outDegree)) {
                        // Not truly independent — skip
                    }
                }
            }
        }

        // Find sequential pairs that share no data dependency
        for (const node of nodes) {
            const preds = inDegree.get(node.id) ?? [];
            if (preds.length !== 1) continue;

            const pred = preds[0];
            const predSuccessors = outDegree.get(pred) ?? [];
            if (predSuccessors.length !== 1) continue;

            // This is a strict chain: pred → node
            // Check if pred and node's successor could be connected directly
            const nodeSuccessors = outDegree.get(node.id) ?? [];
            if (nodeSuccessors.length === 1) {
                const grandSucc = nodeSuccessors[0];
                const grandPreds = inDegree.get(grandSucc) ?? [];
                if (grandPreds.length >= 2) {
                    // grandSucc already has parallel inputs — node could potentially be parallelized too
                    suggestions.push({
                        type: 'parallelize',
                        description: `Node "${node.id}" could potentially run in parallel with siblings of "${grandSucc}"`,
                        nodeIds: [node.id, grandSucc],
                        estimatedSavings: { latencyReductionPercent: 30 },
                        confidence: 0.5,
                    });
                }
            }
        }

        return suggestions;
    }

    // ─── Suggest Model Downgrades ─────────────────────────────────────────

    private findDowngradeOpportunities(nodes: NodeInfo[], edges: EdgeInfo[]): OptimizationSuggestion[] {
        const suggestions: OptimizationSuggestion[] = [];

        const expensiveModels = ['gpt-4o', 'claude-4-sonnet', 'gemini-2.5-pro'];
        const cheapModels: Record<string, string> = {
            'gpt-4o': 'gpt-4o-mini',
            'claude-4-sonnet': 'claude-4-haiku',
            'gemini-2.5-pro': 'gemini-2.5-flash',
        };

        for (const node of nodes) {
            if (!node.model || !expensiveModels.includes(node.model)) continue;

            // Simple heuristic: short prompts with no tools = simple task
            const promptLength = node.prompt?.length ?? 0;
            const hasTools = (node.tools?.length ?? 0) > 0;
            const isSimple = promptLength < 200 && !hasTools;

            if (isSimple) {
                const cheaper = cheapModels[node.model];
                suggestions.push({
                    type: 'downgrade',
                    description: `Node "${node.id}" uses ${node.model} for a simple task — consider ${cheaper}`,
                    nodeIds: [node.id],
                    estimatedSavings: { costReductionPercent: 60 },
                    confidence: 0.7,
                });
            }
        }

        return suggestions;
    }

    // ─── Find Redundant Nodes ─────────────────────────────────────────────

    private findRedundantNodes(nodes: NodeInfo[], edges: EdgeInfo[]): OptimizationSuggestion[] {
        const suggestions: OptimizationSuggestion[] = [];

        // Find nodes with identical prompts and models
        const seen = new Map<string, string>();
        for (const node of nodes) {
            const key = `${node.model}:${node.prompt}`;
            const existing = seen.get(key);
            if (existing && node.prompt && node.prompt.length > 10) {
                suggestions.push({
                    type: 'remove_redundant',
                    description: `Nodes "${existing}" and "${node.id}" have identical prompts and models`,
                    nodeIds: [existing, node.id],
                    estimatedSavings: { costReductionPercent: 50 },
                    confidence: 0.9,
                });
            }
            if (node.prompt) seen.set(key, node.id);
        }

        return suggestions;
    }

    // ─── Utilities ────────────────────────────────────────────────────────

    private hasPath(from: string, to: string, adj: Map<string, string[]>): boolean {
        const visited = new Set<string>();
        const queue = [from];
        while (queue.length > 0) {
            const current = queue.shift()!;
            if (current === to) return true;
            if (visited.has(current)) continue;
            visited.add(current);
            for (const n of adj.get(current) ?? []) queue.push(n);
        }
        return false;
    }
}
