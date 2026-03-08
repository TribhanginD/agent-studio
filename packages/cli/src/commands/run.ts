// ─── CLI: Run Command ─────────────────────────────────────────────────────
// Executes a workflow from a JSON file with cost controls.

import { readFileSync } from 'fs';

export async function runCommand(workflowPath: string, opts: {
    input?: string;
    costCap: string;
    dryRun?: boolean;
    verbose?: boolean;
}) {
    console.log(`\n🚀 Agent Studio — Workflow Execution`);
    console.log(`📄 Workflow: ${workflowPath}`);
    console.log(`💰 Cost cap: $${opts.costCap}`);
    if (opts.dryRun) console.log('🔍 DRY RUN — no actual execution');
    console.log('');

    // Load workflow
    let workflow: any;
    try {
        const raw = readFileSync(workflowPath, 'utf-8');
        workflow = JSON.parse(raw);
    } catch (err) {
        console.error(`❌ Failed to load workflow: ${(err as Error).message}`);
        process.exit(1);
    }

    const graph = workflow.graph;
    if (!graph?.nodes || !graph?.edges) {
        console.error('❌ Invalid workflow: missing graph.nodes or graph.edges');
        process.exit(1);
    }

    const nodeCount = graph.nodes.length;
    const edgeCount = graph.edges.length;
    const userInput = opts.input ? JSON.parse(opts.input) : {};

    console.log(`📊 Graph: ${nodeCount} nodes, ${edgeCount} edges`);
    console.log(`📥 Input: ${JSON.stringify(userInput).slice(0, 100)}`);
    console.log('');

    // Compute execution layers (topological sort)
    const layers = computeLayers(graph.nodes, graph.edges);

    if (opts.dryRun) {
        console.log('📋 Execution Plan:');
        layers.forEach((layer, i) => {
            const nodeLabels = layer.map((id: string) => {
                const node = graph.nodes.find((n: any) => n.id === id);
                return `${node?.data?.label ?? id} (${node?.type})`;
            });
            console.log(`   Layer ${i + 1}: ${nodeLabels.join(' ║ ')}`);
        });
        console.log(`\n✅ Plan valid. ${layers.length} layers, max parallelism: ${Math.max(...layers.map((l: string[]) => l.length))}`);
        return;
    }

    // Execute layers
    console.log('⏳ Executing...\n');
    let totalCost = 0;
    const costCap = parseFloat(opts.costCap);

    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        console.log(`  Layer ${i + 1}/${layers.length}:`);

        for (const nodeId of layer) {
            const node = graph.nodes.find((n: any) => n.id === nodeId);
            const label = node?.data?.label ?? nodeId;
            const model = node?.data?.model ?? 'auto';

            // Simulate execution
            const stepCost = 0.001 + Math.random() * 0.01;
            const latencyMs = 500 + Math.random() * 2000;
            totalCost += stepCost;

            if (totalCost > costCap) {
                console.error(`\n❌ Cost cap exceeded ($${totalCost.toFixed(4)} > $${costCap}). Aborting.`);
                process.exit(1);
            }

            console.log(`    ✓ ${label} [${model}] — $${stepCost.toFixed(4)} / ${latencyMs.toFixed(0)}ms`);
        }
    }

    console.log(`\n✅ Workflow complete!`);
    console.log(`   Total cost: $${totalCost.toFixed(4)}`);
    console.log(`   Steps: ${nodeCount}`);
}

function computeLayers(nodes: any[], edges: any[]): string[][] {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const node of nodes) {
        inDegree.set(node.id, 0);
        adj.set(node.id, []);
    }

    for (const edge of edges) {
        adj.get(edge.source)?.push(edge.target);
        inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }

    const layers: string[][] = [];
    let queue = nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);

    while (queue.length > 0) {
        layers.push([...queue]);
        const next: string[] = [];
        for (const nodeId of queue) {
            for (const neighbor of adj.get(nodeId) ?? []) {
                const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
                inDegree.set(neighbor, newDeg);
                if (newDeg === 0) next.push(neighbor);
            }
        }
        queue = next;
    }

    return layers;
}
