#!/usr/bin/env node

// ─── Agent Studio: CLI ────────────────────────────────────────────────────
// Scaffolding, validation, and execution from the command line.

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { runCommand } from './commands/run.js';
import { validateCommand } from './commands/validate.js';
import { benchmarkCommand } from './commands/benchmark.js';

const program = new Command();

program
    .name('agent-studio')
    .description('Agent Studio — Multi-Agent Orchestration Platform CLI')
    .version('0.1.0');

program
    .command('init')
    .description('Scaffold a new Agent Studio project')
    .option('-n, --name <name>', 'Project name')
    .option('-t, --template <template>', 'Template: basic, research, code-review', 'basic')
    .option('--no-install', 'Skip dependency installation')
    .action(initCommand);

program
    .command('run <workflow>')
    .description('Execute a workflow from a JSON file')
    .option('-i, --input <json>', 'Initial input as JSON string')
    .option('--cost-cap <usd>', 'Maximum cost in USD', '5.0')
    .option('--dry-run', 'Validate and show execution plan without running')
    .option('--verbose', 'Enable detailed logging')
    .action(runCommand);

program
    .command('validate <workflow>')
    .description('Validate a workflow DAG')
    .option('--strict', 'Enable strict validation (require prompts on all nodes)')
    .action(validateCommand);

program
    .command('benchmark <workflow>')
    .description('A/B test a workflow with different model configurations')
    .option('-a, --config-a <json>', 'Model config A (JSON string)')
    .option('-b, --config-b <json>', 'Model config B (JSON string)')
    .option('-n, --iterations <n>', 'Number of iterations per config', '3')
    .action(benchmarkCommand);

program.parse();
