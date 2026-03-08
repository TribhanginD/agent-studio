// ─── Agent Studio: Plugin System ──────────────────────────────────────────
// Extensible plugin interface with lifecycle hooks and dependency resolution.

/**
 * Plugin lifecycle hooks.
 */
export interface PluginHooks {
    /** Called once when the plugin is loaded. */
    onLoad?(): Promise<void>;
    /** Called before each run starts. */
    onRunStart?(runId: string, workflowId: string): Promise<void>;
    /** Called before each step executes. */
    onBeforeStep?(runId: string, nodeId: string, agentType: string): Promise<void>;
    /** Called after each step completes (success or failure). */
    onAfterStep?(runId: string, nodeId: string, result: StepHookResult): Promise<void>;
    /** Called when a run completes. */
    onRunComplete?(runId: string, summary: RunSummary): Promise<void>;
    /** Called when the plugin is unloaded. */
    onUnload?(): Promise<void>;
}

export interface StepHookResult {
    status: 'completed' | 'failed';
    costUsd: number;
    latencyMs: number;
    model: string;
    error?: string;
}

export interface RunSummary {
    totalCostUsd: number;
    totalLatencyMs: number;
    stepsCompleted: number;
    stepsFailed: number;
}

/**
 * Plugin definition.
 */
export interface PluginDefinition {
    name: string;
    version: string;
    description: string;
    author?: string;
    dependencies?: string[]; // Other plugin names this depends on
    hooks: PluginHooks;
}

/**
 * PluginRegistry: Manages plugin lifecycle and dependency resolution.
 */
export class PluginRegistry {
    private plugins: Map<string, PluginDefinition> = new Map();
    private loadOrder: string[] = [];
    private loaded: Set<string> = new Set();

    /**
     * Register a plugin.
     */
    register(plugin: PluginDefinition): void {
        if (this.plugins.has(plugin.name)) {
            throw new Error(`Plugin "${plugin.name}" is already registered`);
        }
        this.plugins.set(plugin.name, plugin);
    }

    /**
     * Load all registered plugins in dependency order.
     */
    async loadAll(): Promise<void> {
        this.loadOrder = this.resolveDependencies();

        for (const name of this.loadOrder) {
            const plugin = this.plugins.get(name)!;
            if (plugin.hooks.onLoad) {
                await plugin.hooks.onLoad();
            }
            this.loaded.add(name);
        }
    }

    /**
     * Unload all plugins in reverse order.
     */
    async unloadAll(): Promise<void> {
        for (const name of [...this.loadOrder].reverse()) {
            const plugin = this.plugins.get(name)!;
            if (plugin.hooks.onUnload) {
                await plugin.hooks.onUnload();
            }
            this.loaded.delete(name);
        }
    }

    /**
     * Emit a lifecycle hook to all loaded plugins.
     */
    async emit<K extends keyof PluginHooks>(
        hook: K,
        ...args: Parameters<NonNullable<PluginHooks[K]>>
    ): Promise<void> {
        for (const name of this.loadOrder) {
            const plugin = this.plugins.get(name)!;
            const fn = plugin.hooks[hook] as ((...a: unknown[]) => Promise<void>) | undefined;
            if (fn) {
                await fn(...args);
            }
        }
    }

    /**
     * Get a registered plugin.
     */
    get(name: string): PluginDefinition | undefined {
        return this.plugins.get(name);
    }

    /**
     * List all registered plugins.
     */
    list(): PluginDefinition[] {
        return [...this.plugins.values()];
    }

    // ─── Private ──────────────────────────────────────────────────────────

    /**
     * Topological sort of plugins by dependencies.
     */
    private resolveDependencies(): string[] {
        const resolved: string[] = [];
        const resolving = new Set<string>();

        const resolve = (name: string) => {
            if (resolved.includes(name)) return;
            if (resolving.has(name)) {
                throw new Error(`Circular plugin dependency detected involving "${name}"`);
            }
            resolving.add(name);

            const plugin = this.plugins.get(name);
            if (!plugin) throw new Error(`Plugin "${name}" not found`);

            for (const dep of plugin.dependencies ?? []) {
                if (!this.plugins.has(dep)) {
                    throw new Error(`Plugin "${name}" depends on "${dep}" which is not registered`);
                }
                resolve(dep);
            }

            resolving.delete(name);
            resolved.push(name);
        };

        for (const name of this.plugins.keys()) {
            resolve(name);
        }

        return resolved;
    }
}
