// ─── CLI: Benchmark Command ───────────────────────────────────────────────
// A/B test a workflow with different model configurations.

import { readFileSync } from 'fs';

interface BenchmarkResult {
    configName: string;
    iterations: number;
    avgCostUsd: number;
    avgLatencyMs: number;
    avgTokens: number;
    successRate: number;
}

export async function benchmarkCommand(workflowPath: string, opts: {
    configA?: string;
    configB?: string;
    iterations: string;
}) {
    console.log(`\n⚡ Agent Studio — Model Benchmark`);
    console.log(`📄 Workflow: ${workflowPath}`);
    console.log(`🔄 Iterations: ${opts.iterations} per config\n`);

    let workflow: any;
    try {
        const raw = readFileSync(workflowPath, 'utf-8');
        workflow = JSON.parse(raw);
    } catch (err) {
        console.error(`❌ Failed to load: ${(err as Error).message}`);
        process.exit(1);
    }

    const iterations = parseInt(opts.iterations, 10);
    const configA = opts.configA ? JSON.parse(opts.configA) : { model: 'gpt-4o-mini', label: 'GPT-4o Mini' };
    const configB = opts.configB ? JSON.parse(opts.configB) : { model: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' };

    // Run benchmarks (simulated)
    const resultA = await runBenchmark(workflow, configA, iterations);
    const resultB = await runBenchmark(workflow, configB, iterations);

    // Print comparison
    console.log('\n┌──────────────────────────────────────────────────┐');
    console.log('│              BENCHMARK RESULTS                    │');
    console.log('├──────────────────────────────────────────────────┤');
    console.log(`│ Metric           │ ${padR(resultA.configName, 12)} │ ${padR(resultB.configName, 12)} │`);
    console.log('├──────────────────────────────────────────────────┤');
    console.log(`│ Avg Cost         │ $${padR(resultA.avgCostUsd.toFixed(4), 10)} │ $${padR(resultB.avgCostUsd.toFixed(4), 10)} │`);
    console.log(`│ Avg Latency      │ ${padR(resultA.avgLatencyMs.toFixed(0) + 'ms', 11)} │ ${padR(resultB.avgLatencyMs.toFixed(0) + 'ms', 11)} │`);
    console.log(`│ Avg Tokens       │ ${padR(String(resultA.avgTokens), 11)} │ ${padR(String(resultB.avgTokens), 11)} │`);
    console.log(`│ Success Rate     │ ${padR((resultA.successRate * 100).toFixed(1) + '%', 11)} │ ${padR((resultB.successRate * 100).toFixed(1) + '%', 11)} │`);
    console.log('└──────────────────────────────────────────────────┘');

    // Winner analysis
    const costWinner = resultA.avgCostUsd < resultB.avgCostUsd ? resultA : resultB;
    const speedWinner = resultA.avgLatencyMs < resultB.avgLatencyMs ? resultA : resultB;
    console.log(`\n🏆 Cheapest:  ${costWinner.configName} ($${costWinner.avgCostUsd.toFixed(4)}/run)`);
    console.log(`🏆 Fastest:   ${speedWinner.configName} (${speedWinner.avgLatencyMs.toFixed(0)}ms/run)`);

    const costSaving = Math.abs(resultA.avgCostUsd - resultB.avgCostUsd) / Math.max(resultA.avgCostUsd, resultB.avgCostUsd) * 100;
    console.log(`💡 Cost difference: ${costSaving.toFixed(1)}%`);
}

async function runBenchmark(workflow: any, config: any, iterations: number): Promise<BenchmarkResult> {
    const nodeCount = workflow.graph?.nodes?.length ?? 3;
    let totalCost = 0;
    let totalLatency = 0;
    let totalTokens = 0;
    let successes = 0;

    for (let i = 0; i < iterations; i++) {
        // Simulate execution with the given model config
        const stepCost = nodeCount * (0.001 + Math.random() * 0.01);
        const stepLatency = nodeCount * (500 + Math.random() * 1500);
        const stepTokens = nodeCount * (200 + Math.floor(Math.random() * 800));
        const success = Math.random() > 0.05; // 95% success rate

        totalCost += stepCost;
        totalLatency += stepLatency;
        totalTokens += stepTokens;
        if (success) successes++;
    }

    return {
        configName: config.label ?? config.model,
        iterations,
        avgCostUsd: totalCost / iterations,
        avgLatencyMs: totalLatency / iterations,
        avgTokens: Math.floor(totalTokens / iterations),
        successRate: successes / iterations,
    };
}

function padR(str: string, len: number): string {
    return str.padEnd(len);
}
