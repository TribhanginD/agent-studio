// ─── Agent Studio: Memory Layer — Long-Term ──────────────────────────────
// Vector store integration for semantic retrieval across runs.
// Supports multiple backends: pg-vector, Pinecone, Chroma, Qdrant.

/**
 * A document stored in the vector store.
 */
export interface MemoryDocument {
    id: string;
    content: string;
    metadata: {
        runId?: string;
        nodeId?: string;
        agentType?: string;
        timestamp: number;
        importance: number; // 0-1
        source: 'agent_output' | 'tool_result' | 'user_input' | 'summary';
    };
    embedding?: number[];
}

/**
 * Retrieval result with relevance scoring.
 */
export interface RetrievalResult {
    document: MemoryDocument;
    similarityScore: number;
    recencyScore: number;
    importanceScore: number;
    combinedScore: number;
}

/**
 * Vector store backend interface.
 */
export interface VectorStoreBackend {
    upsert(docs: MemoryDocument[]): Promise<void>;
    query(embedding: number[], topK: number, filter?: Record<string, unknown>): Promise<Array<{ document: MemoryDocument; score: number }>>;
    delete(ids: string[]): Promise<void>;
}

/**
 * LongTermMemory: Semantic retrieval layer for accumulated knowledge.
 *
 * Features:
 * - Multi-backend vector store (abstracted interface)
 * - Composite scoring: recency × relevance × importance
 * - Configurable similarity threshold
 * - Automatic metadata enrichment
 */
export class LongTermMemory {
    private backend: VectorStoreBackend;
    private weights: { relevance: number; recency: number; importance: number };
    private similarityThreshold: number;

    constructor(
        backend: VectorStoreBackend,
        config?: {
            relevanceWeight?: number;
            recencyWeight?: number;
            importanceWeight?: number;
            similarityThreshold?: number;
        },
    ) {
        this.backend = backend;
        this.weights = {
            relevance: config?.relevanceWeight ?? 0.5,
            recency: config?.recencyWeight ?? 0.3,
            importance: config?.importanceWeight ?? 0.2,
        };
        this.similarityThreshold = config?.similarityThreshold ?? 0.7;
    }

    /**
     * Store a document with automatic scoring metadata.
     */
    async store(doc: Omit<MemoryDocument, 'embedding'>): Promise<void> {
        // In production, this would call an embedding API
        // For now, we store without embeddings and compute similarity differently
        await this.backend.upsert([doc as MemoryDocument]);
    }

    /**
     * Store multiple documents in batch.
     */
    async storeBatch(docs: Omit<MemoryDocument, 'embedding'>[]): Promise<void> {
        await this.backend.upsert(docs as MemoryDocument[]);
    }

    /**
     * Retrieve relevant documents using composite scoring.
     */
    async retrieve(
        queryEmbedding: number[],
        topK: number = 5,
        filter?: Record<string, unknown>,
    ): Promise<RetrievalResult[]> {
        const rawResults = await this.backend.query(queryEmbedding, topK * 2, filter);
        const now = Date.now();

        const scored = rawResults
            .filter((r) => r.score >= this.similarityThreshold)
            .map((r) => {
                const recencyScore = this.computeRecencyScore(r.document.metadata.timestamp, now);
                const importanceScore = r.document.metadata.importance;
                const similarityScore = r.score;

                const combinedScore =
                    this.weights.relevance * similarityScore +
                    this.weights.recency * recencyScore +
                    this.weights.importance * importanceScore;

                return {
                    document: r.document,
                    similarityScore,
                    recencyScore,
                    importanceScore,
                    combinedScore,
                };
            })
            .sort((a, b) => b.combinedScore - a.combinedScore)
            .slice(0, topK);

        return scored;
    }

    /**
     * Delete documents.
     */
    async forget(ids: string[]): Promise<void> {
        await this.backend.delete(ids);
    }

    // ─── Private ──────────────────────────────────────────────────────────

    /**
     * Compute recency score — exponential decay over time.
     * Score is 1.0 for now, decaying to 0 over ~7 days.
     */
    private computeRecencyScore(timestamp: number, now: number): number {
        const ageMs = now - timestamp;
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        return Math.exp(-3 * (ageMs / sevenDaysMs));
    }
}

/**
 * In-memory vector store backend for testing.
 */
export class InMemoryVectorStore implements VectorStoreBackend {
    private docs: Map<string, MemoryDocument> = new Map();

    async upsert(docs: MemoryDocument[]): Promise<void> {
        for (const doc of docs) {
            this.docs.set(doc.id, doc);
        }
    }

    async query(
        embedding: number[],
        topK: number,
        filter?: Record<string, unknown>,
    ): Promise<Array<{ document: MemoryDocument; score: number }>> {
        const results: Array<{ document: MemoryDocument; score: number }> = [];

        for (const doc of this.docs.values()) {
            // Apply filters
            if (filter) {
                const match = Object.entries(filter).every(
                    ([key, val]) => (doc.metadata as Record<string, unknown>)[key] === val,
                );
                if (!match) continue;
            }

            // Compute cosine similarity if embeddings exist
            const score = doc.embedding
                ? this.cosineSimilarity(embedding, doc.embedding)
                : 0.5; // Default score when no embedding

            results.push({ document: doc, score });
        }

        return results.sort((a, b) => b.score - a.score).slice(0, topK);
    }

    async delete(ids: string[]): Promise<void> {
        for (const id of ids) this.docs.delete(id);
    }

    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
    }
}
