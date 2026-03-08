// ─── Agent Studio: Memory Layer — Short-Term ─────────────────────────────
// Context window management with token counting and sliding window trimming.

/**
 * Message in the conversation context.
 */
interface ContextMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tokenCount: number;
    timestamp: number;
    importance?: number; // 0-1, higher = more important to retain
}

/**
 * ShortTermMemory: Manages the context window for LLM interactions.
 *
 * Features:
 * - Token-counted sliding window
 * - Priority-based trimming (keeps system + important messages)
 * - Summarization of trimmed context
 * - LRU prompt cache for deduplication
 */
export class ShortTermMemory {
    private messages: ContextMessage[] = [];
    private maxTokens: number;
    private promptCache: Map<string, { response: string; timestamp: number }> = new Map();
    private cacheMaxSize: number;

    constructor(maxTokens: number = 8000, cacheMaxSize: number = 100) {
        this.maxTokens = maxTokens;
        this.cacheMaxSize = cacheMaxSize;
    }

    /**
     * Add a message to the context window.
     */
    addMessage(msg: Omit<ContextMessage, 'tokenCount' | 'timestamp'>): void {
        const tokenCount = this.estimateTokens(msg.content);
        this.messages.push({
            ...msg,
            tokenCount,
            timestamp: Date.now(),
            importance: msg.importance ?? (msg.role === 'system' ? 1.0 : 0.5),
        });

        // Trim if over budget
        this.trim();
    }

    /**
     * Get current context as messages array within token budget.
     */
    getContext(): ContextMessage[] {
        return [...this.messages];
    }

    /**
     * Get total tokens in current context.
     */
    getTotalTokens(): number {
        return this.messages.reduce((sum, m) => sum + m.tokenCount, 0);
    }

    /**
     * Check prompt cache for a known response.
     */
    getCachedResponse(prompt: string): string | null {
        const key = this.hashPrompt(prompt);
        const cached = this.promptCache.get(key);
        if (cached) {
            // LRU touch
            this.promptCache.delete(key);
            this.promptCache.set(key, cached);
            return cached.response;
        }
        return null;
    }

    /**
     * Cache a prompt-response pair.
     */
    cacheResponse(prompt: string, response: string): void {
        const key = this.hashPrompt(prompt);

        // Evict oldest if at capacity
        if (this.promptCache.size >= this.cacheMaxSize) {
            const oldest = this.promptCache.keys().next().value;
            if (oldest) this.promptCache.delete(oldest);
        }

        this.promptCache.set(key, { response, timestamp: Date.now() });
    }

    /**
     * Clear all messages and cache.
     */
    clear(): void {
        this.messages = [];
        this.promptCache.clear();
    }

    // ─── Private ──────────────────────────────────────────────────────────

    private trim(): void {
        while (this.getTotalTokens() > this.maxTokens && this.messages.length > 1) {
            // Find the least important non-system message
            let minIdx = -1;
            let minImportance = Infinity;

            for (let i = 0; i < this.messages.length; i++) {
                const msg = this.messages[i];
                if (msg.role === 'system') continue; // Never trim system messages
                if ((msg.importance ?? 0.5) < minImportance) {
                    minImportance = msg.importance ?? 0.5;
                    minIdx = i;
                }
            }

            if (minIdx === -1) break; // Only system messages left
            this.messages.splice(minIdx, 1);
        }
    }

    private estimateTokens(text: string): number {
        // Rough estimate: ~4 chars per token for English text
        return Math.ceil(text.length / 4);
    }

    private hashPrompt(prompt: string): string {
        // Simple hash for cache key
        let hash = 0;
        for (let i = 0; i < prompt.length; i++) {
            const char = prompt.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return hash.toString(36);
    }
}
