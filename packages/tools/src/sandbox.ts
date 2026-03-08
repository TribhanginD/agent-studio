// ─── Agent Studio: Tool Sandbox ───────────────────────────────────────────
// Sandboxed tool execution using Node.js worker_threads.
// Phase 2 uses worker_threads for isolation. WASM (Wasmtime) integration
// upgrades this in Phase 5 for full memory/CPU isolation.
//
// Design: Each sandboxed call runs in a disposable Worker with:
// - Configurable memory limits via --max-old-space-size
// - Timeout enforcement via worker.terminate()
// - Stdin/stdout isolation

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { RegisteredTool } from './registry.js';
import { Defaults } from '@agent-studio/shared';

/**
 * Sandbox configuration.
 */
export interface SandboxConfig {
    /** Maximum memory per tool execution in MB */
    maxMemoryMb?: number;
    /** Maximum execution time in ms */
    maxExecutionMs?: number;
    /** Maximum WASM fuel (for future Wasmtime integration) */
    maxFuel?: number;
}

/**
 * ToolSandbox: Executes tools in isolated environments.
 *
 * Current: Node.js worker_threads with memory and timeout limits.
 * Future: Wasmtime WASI-based isolation with fuel limits.
 */
export class ToolSandbox {
    private config: Required<SandboxConfig>;

    constructor(config?: SandboxConfig) {
        this.config = {
            maxMemoryMb: config?.maxMemoryMb ?? 256,
            maxExecutionMs: config?.maxExecutionMs ?? Defaults.TOOL_TIMEOUT_MS,
            maxFuel: config?.maxFuel ?? Defaults.WASM_MAX_FUEL,
        };
    }

    /**
     * Execute a tool in an isolated worker thread.
     */
    async execute(
        tool: RegisteredTool,
        args: Record<string, unknown>,
        timeoutMs?: number,
    ): Promise<unknown> {
        const timeout = timeoutMs ?? tool.definition.timeoutMs ?? this.config.maxExecutionMs;
        const maxMemory = tool.definition.maxMemoryBytes
            ? Math.ceil(tool.definition.maxMemoryBytes / (1024 * 1024))
            : this.config.maxMemoryMb;

        return new Promise((resolve, reject) => {
            // Create worker with memory limits
            const workerCode = `
        const { parentPort, workerData } = require('worker_threads');

        async function run() {
          try {
            // The handler is serialized as a string and eval'd in the sandbox
            // In production, this would be a WASM module loaded via Wasmtime
            const handler = new Function('args', 'return (' + workerData.handlerSource + ')(args)');
            const result = await handler(workerData.args);
            parentPort.postMessage({ success: true, result });
          } catch (error) {
            parentPort.postMessage({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        run();
      `;

            const worker = new Worker(workerCode, {
                eval: true,
                workerData: {
                    args,
                    handlerSource: tool.handler.toString(),
                },
                resourceLimits: {
                    maxOldGenerationSizeMb: maxMemory,
                    maxYoungGenerationSizeMb: Math.ceil(maxMemory / 4),
                    stackSizeMb: 4,
                },
            });

            // Timeout enforcement
            const timer = setTimeout(() => {
                worker.terminate();
                reject(new SandboxError(
                    `Sandboxed tool "${tool.definition.id}" timed out after ${timeout}ms`,
                    'TIMEOUT',
                ));
            }, timeout);

            worker.on('message', (msg: { success: boolean; result?: unknown; error?: string }) => {
                clearTimeout(timer);
                worker.terminate();
                if (msg.success) {
                    resolve(msg.result);
                } else {
                    reject(new SandboxError(
                        `Sandboxed tool "${tool.definition.id}" failed: ${msg.error}`,
                        'EXECUTION_FAILED',
                    ));
                }
            });

            worker.on('error', (err) => {
                clearTimeout(timer);
                reject(new SandboxError(
                    `Sandbox worker error for "${tool.definition.id}": ${err.message}`,
                    'WORKER_ERROR',
                ));
            });

            worker.on('exit', (code) => {
                clearTimeout(timer);
                if (code !== 0) {
                    reject(new SandboxError(
                        `Sandbox worker exited with code ${code} for "${tool.definition.id}"`,
                        'EXIT_ERROR',
                    ));
                }
            });
        });
    }
}

export class SandboxError extends Error {
    constructor(
        message: string,
        public readonly type: string,
    ) {
        super(message);
        this.name = 'SandboxError';
    }
}
