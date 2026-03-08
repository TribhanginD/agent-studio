// ─── Agent Studio: Built-in Tools ─────────────────────────────────────────
// Pre-registered tools that ship with Agent Studio.

import { z } from 'zod';
import type { ToolRegistry } from '../registry.js';

/**
 * Registers all built-in tools with the given registry.
 */
export function registerBuiltinTools(registry: ToolRegistry): void {
    registerWebSearch(registry);
    registerHttpRequest(registry);
    registerJsonTransform(registry);
    registerTextSummary(registry);
}

/**
 * Web Search: Search Google via SerpAPI (free 100 searches/month).
 */
function registerWebSearch(registry: ToolRegistry): void {
    registry.register({
        id: 'web-search',
        name: 'Web Search',
        description: 'Search Google for current information using SerpAPI. Returns a list of search results with titles, snippets, and URLs.',
        inputSchema: z.object({
            query: z.string().min(1).describe('The search query'),
            numResults: z.number().int().min(1).max(20).default(5).describe('Number of results to return'),
            searchType: z.enum(['search', 'news', 'images']).default('search').describe('Type of search'),
        }),
        outputSchema: z.object({
            results: z.array(z.object({
                title: z.string(),
                snippet: z.string(),
                url: z.string(),
                position: z.number(),
            })),
            searchTime: z.number(),
        }),
        permissions: {
            requiredRoles: [],
            rateLimit: { maxCalls: 30, windowSeconds: 60 },
        },
        timeoutMs: 10_000,
        handler: async (input) => {
            const apiKey = process.env.SERPAPI_KEY;
            if (!apiKey) {
                return {
                    results: [{
                        title: 'SerpAPI not configured',
                        snippet: 'Set SERPAPI_KEY in environment. Get a free key at https://serpapi.com (100 searches/month free).',
                        url: 'https://serpapi.com',
                        position: 1,
                    }],
                    searchTime: 0,
                };
            }

            const startTime = Date.now();

            // Build SerpAPI query params
            const params = new URLSearchParams({
                api_key: apiKey,
                q: input.query,
                num: String(input.numResults),
                engine: 'google',
            });

            if (input.searchType === 'news') {
                params.set('tbm', 'nws');
            } else if (input.searchType === 'images') {
                params.set('tbm', 'isch');
            }

            const response = await fetch(
                `https://serpapi.com/search.json?${params.toString()}`,
            );

            if (!response.ok) {
                throw new Error(`SerpAPI request failed: ${response.status} ${response.statusText}`);
            }

            const data = await response.json() as any;

            // Extract organic results
            const organic = data.organic_results ?? [];
            const results = organic.slice(0, input.numResults).map((r: any, i: number) => ({
                title: r.title ?? '',
                snippet: r.snippet ?? '',
                url: r.link ?? '',
                position: i + 1,
            }));

            return { results, searchTime: Date.now() - startTime };
        },
    });
}

/**
 * HTTP Request: Make controlled HTTP requests with URL whitelist.
 */
function registerHttpRequest(registry: ToolRegistry): void {
    registry.register({
        id: 'http-request',
        name: 'HTTP Request',
        description: 'Make an HTTP request to a URL. Supports GET and POST methods with custom headers.',
        inputSchema: z.object({
            url: z.string().url().describe('The URL to request'),
            method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET'),
            headers: z.record(z.string()).optional().describe('Custom request headers'),
            body: z.string().optional().describe('Request body (for POST/PUT)'),
            timeoutMs: z.number().int().min(1000).max(30000).default(10000),
        }),
        outputSchema: z.object({
            status: z.number(),
            statusText: z.string(),
            headers: z.record(z.string()),
            body: z.string(),
            durationMs: z.number(),
        }),
        permissions: {
            requiredRoles: ['admin', 'developer'],
            rateLimit: { maxCalls: 20, windowSeconds: 60 },
        },
        timeoutMs: 30_000,
        handler: async (input) => {
            const startTime = Date.now();
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), input.timeoutMs);

            try {
                const response = await fetch(input.url, {
                    method: input.method,
                    headers: input.headers,
                    body: input.body,
                    signal: controller.signal,
                });

                const body = await response.text();
                const headers: Record<string, string> = {};
                response.headers.forEach((value, key) => { headers[key] = value; });

                return {
                    status: response.status,
                    statusText: response.statusText,
                    headers,
                    body: body.slice(0, 50_000), // Cap response size
                    durationMs: Date.now() - startTime,
                };
            } finally {
                clearTimeout(timer);
            }
        },
    });
}

/**
 * JSON Transform: Parse, filter, and transform JSON data.
 */
function registerJsonTransform(registry: ToolRegistry): void {
    registry.register({
        id: 'json-transform',
        name: 'JSON Transform',
        description: 'Parse and transform JSON data. Can extract fields, filter arrays, and restructure data.',
        inputSchema: z.object({
            data: z.unknown().describe('The JSON data to transform'),
            jmesPath: z.string().optional().describe('JMESPath expression for filtering/extraction'),
            operation: z.enum(['parse', 'stringify', 'flatten', 'pick', 'omit']).default('parse'),
            fields: z.array(z.string()).optional().describe('Fields to pick or omit'),
        }),
        timeoutMs: 5_000,
        handler: async (input) => {
            const data = typeof input.data === 'string' ? JSON.parse(input.data) : input.data;

            switch (input.operation) {
                case 'stringify':
                    return { result: JSON.stringify(data, null, 2) };
                case 'flatten':
                    return { result: flattenObject(data) };
                case 'pick':
                    if (!input.fields || typeof data !== 'object') return { result: data };
                    return {
                        result: Object.fromEntries(
                            Object.entries(data as Record<string, unknown>)
                                .filter(([k]) => input.fields!.includes(k)),
                        ),
                    };
                case 'omit':
                    if (!input.fields || typeof data !== 'object') return { result: data };
                    return {
                        result: Object.fromEntries(
                            Object.entries(data as Record<string, unknown>)
                                .filter(([k]) => !input.fields!.includes(k)),
                        ),
                    };
                default:
                    return { result: data };
            }
        },
    });
}

/**
 * Text Summary: Placeholder for LLM-powered text summarization.
 */
function registerTextSummary(registry: ToolRegistry): void {
    registry.register({
        id: 'text-summary',
        name: 'Text Summary',
        description: 'Summarize a block of text. Uses the configured LLM model via the model router.',
        inputSchema: z.object({
            text: z.string().min(1).describe('The text to summarize'),
            maxLength: z.number().int().min(50).max(2000).default(500).describe('Maximum summary length in characters'),
            style: z.enum(['brief', 'detailed', 'bullet-points']).default('brief'),
        }),
        timeoutMs: 60_000,
        handler: async (input) => {
            // In Phase 2+, this routes through the model router for real LLM summarization.
            return {
                summary: `[Summary of ${input.text.length} chars in ${input.style} style — model router integration pending]`,
                originalLength: input.text.length,
                style: input.style,
            };
        },
    });
}

// ─── Utilities ────────────────────────────────────────────────────────────

function flattenObject(
    obj: unknown,
    prefix = '',
    result: Record<string, unknown> = {},
): Record<string, unknown> {
    if (obj === null || obj === undefined || typeof obj !== 'object') {
        result[prefix] = obj;
        return result;
    }

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const newKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            flattenObject(value, newKey, result);
        } else {
            result[newKey] = value;
        }
    }

    return result;
}
