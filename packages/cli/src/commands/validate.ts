// ─── CLI: Validate Command ────────────────────────────────────────────────
// Validates a workflow DAG for structural and semantic correctness.

import { readFileSync } from 'fs';

export async function validateCommand(workflowPath: string, opts: { strict?: boolean }) {
    console.log(`\n🔍 Agent Studio — Workflow Validation`);
    console.log(`📄 File: ${workflowPath}\n`);

    let workflow: any;
    try {
        const raw = readFileSync(workflowPath, 'utf-8');
        workflow = JSON.parse(raw);
    } catch (err) {
        console.error(`❌ Failed to load: ${(err as Error).message}`);
        process.exit(1);
    }

    const graph = workflow.graph;
    if (!graph?.nodes || !graph?.edges) {
        console.error('❌ Invalid workflow: missing graph.nodes or graph.edges');
        process.exit(1);
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const nodeIds = new Set(graph.nodes.map((n: any) => n.id));

    // 1. Orphan edges
    for (const edge of graph.edges) {
        if (!nodeIds.has(edge.source)) errors.push(`Edge references missing source: ${edge.source}`);
        if (!nodeIds.has(edge.target)) errors.push(`Edge references missing target: ${edge.target}`);
    }

    // 2. Cycle detection
    const adj = new Map<string, string[]>();
    for (const node of graph.nodes) adj.set(node.id, []);
    for (const edge of graph.edges) adj.get(edge.source)?.push(edge.target);

    const visited = new Set<string>();
    const stack = new Set<string>();
    let hasCycle = false;

    function dfs(id: string) {
        visited.add(id);
        stack.add(id);
        for (const n of adj.get(id) ?? []) {
            if (!visited.has(n)) dfs(n);
            else if (stack.has(n)) hasCycle = true;
        }
        stack.delete(id);
    }

    for (const node of graph.nodes) {
        if (!visited.has(node.id)) dfs(node.id);
    }
    if (hasCycle) errors.push('Graph contains a cycle — must be a DAG');

    // 3. Disconnected nodes
    for (const node of graph.nodes) {
        const hasIn = graph.edges.some((e: any) => e.target === node.id);
        const hasOut = graph.edges.some((e: any) => e.source === node.id);
        if (!hasIn && !hasOut) warnings.push(`Node "${node.data?.label ?? node.id}" is disconnected`);
    }

    // 4. No entry points
    const targets = new Set(graph.edges.map((e: any) => e.target));
    const entryPoints = graph.nodes.filter((n: any) => !targets.has(n.id));
    if (entryPoints.length === 0 && graph.nodes.length > 0) {
        errors.push('No entry points found — at least one node must have no incoming edges');
    }

    // 5. Strict mode: check prompts and models
    if (opts.strict) {
        for (const node of graph.nodes) {
            if (!node.data?.prompt || node.data.prompt.trim() === '') {
                errors.push(`Node "${node.data?.label ?? node.id}" has no prompt configured`);
            }
            if (!node.data?.model) {
                warnings.push(`Node "${node.data?.label ?? node.id}" has no model specified (will use auto-routing)`);
            }
        }
    }

    // Output
    if (errors.length === 0 && warnings.length === 0) {
        console.log('✅ Workflow is valid!');
        console.log(`   ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${entryPoints.length} entry point(s)`);
    } else {
        if (errors.length > 0) {
            console.log(`❌ ${errors.length} error(s):`);
            errors.forEach((e) => console.log(`   • ${e}`));
        }
        if (warnings.length > 0) {
            console.log(`⚠️  ${warnings.length} warning(s):`);
            warnings.forEach((w) => console.log(`   • ${w}`));
        }

        if (errors.length > 0) process.exit(1);
    }
}
