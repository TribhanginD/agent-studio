// ─── CLI: Init Command ────────────────────────────────────────────────────
// Scaffolds a new Agent Studio project with template selection.

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const templates: Record<string, object> = {
    basic: {
        nodes: [
            { id: 'planner-1', type: 'planner', data: { label: 'Planner', agentType: 'planner', prompt: 'Decompose the task into steps.', model: 'gpt-4o-mini' } },
            { id: 'executor-1', type: 'executor', data: { label: 'Executor', agentType: 'executor', prompt: 'Execute the assigned step.', model: 'gpt-4o-mini' } },
            { id: 'validator-1', type: 'validator', data: { label: 'Validator', agentType: 'validator', prompt: 'Validate the output quality.', model: 'gpt-4o-mini' } },
        ],
        edges: [
            { source: 'planner-1', target: 'executor-1' },
            { source: 'executor-1', target: 'validator-1' },
        ],
    },
    research: {
        nodes: [
            { id: 'planner-1', type: 'planner', data: { label: 'Research Planner', agentType: 'planner', prompt: 'Plan a research strategy.', model: 'gpt-4o' } },
            { id: 'retrieval-1', type: 'retrieval', data: { label: 'Source Gatherer', agentType: 'retrieval', prompt: 'Search and retrieve relevant sources.', model: 'gemini-2.5-flash', tools: ['web-search'] } },
            { id: 'executor-1', type: 'executor', data: { label: 'Analyst', agentType: 'executor', prompt: 'Analyze and synthesize findings.', model: 'claude-4-sonnet' } },
            { id: 'validator-1', type: 'validator', data: { label: 'Fact Checker', agentType: 'validator', prompt: 'Verify claims and check for accuracy.', model: 'gpt-4o' } },
        ],
        edges: [
            { source: 'planner-1', target: 'retrieval-1' },
            { source: 'retrieval-1', target: 'executor-1' },
            { source: 'executor-1', target: 'validator-1' },
        ],
    },
    'code-review': {
        nodes: [
            { id: 'planner-1', type: 'planner', data: { label: 'Review Planner', agentType: 'planner', prompt: 'Identify files and areas to review.', model: 'gpt-4o' } },
            { id: 'executor-1', type: 'executor', data: { label: 'Security Reviewer', agentType: 'executor', prompt: 'Check for security vulnerabilities.', model: 'claude-4-sonnet', tools: ['http-request'] } },
            { id: 'executor-2', type: 'executor', data: { label: 'Style Reviewer', agentType: 'executor', prompt: 'Check code style and best practices.', model: 'gpt-4o-mini' } },
            { id: 'validator-1', type: 'validator', data: { label: 'Review Compiler', agentType: 'validator', prompt: 'Compile all review findings into a structured report.', model: 'gpt-4o' } },
        ],
        edges: [
            { source: 'planner-1', target: 'executor-1' },
            { source: 'planner-1', target: 'executor-2' },
            { source: 'executor-1', target: 'validator-1' },
            { source: 'executor-2', target: 'validator-1' },
        ],
    },
};

export async function initCommand(opts: { name?: string; template: string; install: boolean }) {
    const name = opts.name ?? 'my-agent-workflow';
    const template = opts.template;

    console.log(`\n🏗️  Scaffolding Agent Studio project: ${name}`);
    console.log(`📋 Template: ${template}\n`);

    const dir = join(process.cwd(), name);
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, 'workflows'), { recursive: true });

    // Write workflow file
    const workflow = templates[template] ?? templates.basic;
    writeFileSync(
        join(dir, 'workflows', 'main.json'),
        JSON.stringify({ name: `${name} — Main Workflow`, version: 1, graph: workflow }, null, 2),
    );

    // Write package.json
    writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
            name,
            version: '0.1.0',
            private: true,
            scripts: {
                validate: 'agent-studio validate workflows/main.json',
                run: 'agent-studio run workflows/main.json',
            },
            dependencies: { '@agent-studio/cli': 'workspace:*' },
        }, null, 2),
    );

    // Write .env template
    writeFileSync(
        join(dir, '.env'),
        [
            '# Agent Studio Configuration',
            'OPENAI_API_KEY=',
            'ANTHROPIC_API_KEY=',
            'GOOGLE_API_KEY=',
            'DATABASE_URL=postgres://localhost:5432/agent_studio',
            'COST_CAP_USD=5.00',
            '',
        ].join('\n'),
    );

    // Write README
    writeFileSync(
        join(dir, 'README.md'),
        [
            `# ${name}`,
            '',
            '> Built with [Agent Studio](https://github.com/agent-studio) — Multi-Agent Orchestration Platform',
            '',
            '## Quick Start',
            '',
            '```bash',
            '# Validate your workflow',
            'npm run validate',
            '',
            '# Execute the workflow',
            'npm run run',
            '```',
            '',
            '## Workflow',
            '',
            `Template: **${template}**`,
            '',
            `See \`workflows/main.json\` for the workflow definition.`,
            '',
        ].join('\n'),
    );

    console.log('✅ Created:');
    console.log(`   ${name}/`);
    console.log('   ├── workflows/main.json');
    console.log('   ├── package.json');
    console.log('   ├── .env');
    console.log('   └── README.md');
    console.log('\n🚀 Next: cd', name, '&& edit .env with your API keys\n');
}
