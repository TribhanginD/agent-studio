// ─── Agent Studio: LLM Provider Adapters ──────────────────────────────────
// Normalized adapter interface across OpenAI, Anthropic, Google, and local models.
// Each adapter handles: chat completion, streaming, tool calling, and error normalization.

import type { ChatMessage, ModelResponse, ModelStreamChunk, ToolDefinition } from '@agent-studio/shared';

/**
 * Normalized request to any LLM provider.
 */
export interface ProviderRequest {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    tools?: ToolDefinition[];
    stream?: boolean;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    stop?: string[];
    /** Request structured output format ('json' enables JSON mode where available) */
    responseFormat?: 'json' | 'text';
}

/**
 * Common interface that all provider adapters must implement.
 */
export interface ProviderAdapter {
    /** Provider identifier */
    readonly providerId: string;

    /** Complete a chat request (non-streaming) */
    complete(request: ProviderRequest): Promise<ModelResponse>;

    /** Stream a chat request */
    stream(request: ProviderRequest): AsyncGenerator<ModelStreamChunk>;

    /** Check if this adapter is configured (has API key, etc.) */
    isAvailable(): boolean;
}

// ─── OpenAI Adapter ─────────────────────────────────────────────────────

export class OpenAIAdapter implements ProviderAdapter {
    readonly providerId = 'openai';
    private apiKey: string | undefined;

    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY;
    }

    isAvailable(): boolean {
        return !!this.apiKey;
    }

    async complete(request: ProviderRequest): Promise<ModelResponse> {
        if (!this.apiKey) throw new AdapterError('OpenAI API key not configured');

        const { default: OpenAI } = await import('openai');
        const client = new OpenAI({ apiKey: this.apiKey });

        const startTime = Date.now();

        const messages = request.messages.map((m) => {
            if (m.role === 'tool') {
                return {
                    role: 'tool' as const,
                    content: m.content,
                    tool_call_id: m.toolCallId ?? '',
                };
            }
            return {
                role: m.role as 'system' | 'user' | 'assistant',
                content: m.content,
                name: m.name,
                tool_calls: m.toolCalls?.map(tc => ({
                    id: tc.callId,
                    type: 'function' as const,
                    function: {
                        name: tc.toolId,
                        arguments: JSON.stringify(tc.arguments),
                    }
                })),
            };
        });

        const tools = request.tools?.map((t) => ({
            type: 'function' as const,
            function: {
                name: t.id,
                description: t.description,
                parameters: t.inputSchema as Record<string, unknown>,
            },
        }));

        const response = await client.chat.completions.create({
            model: request.model,
            messages,
            temperature: request.temperature,
            max_tokens: request.maxTokens,
            tools: tools?.length ? tools : undefined,
            top_p: request.topP,
            frequency_penalty: request.frequencyPenalty,
            presence_penalty: request.presencePenalty,
            stop: request.stop,
        });

        const choice = response.choices[0];
        const toolCalls = choice.message.tool_calls?.map((tc) => ({
            toolId: tc.function.name,
            arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
            callId: tc.id,
            timestamp: new Date().toISOString(),
        }));

        return {
            content: choice.message.content ?? '',
            toolCalls,
            tokensIn: response.usage?.prompt_tokens ?? 0,
            tokensOut: response.usage?.completion_tokens ?? 0,
            model: response.model,
            finishReason: choice.finish_reason ?? 'stop',
            latencyMs: Date.now() - startTime,
        };
    }

    async *stream(request: ProviderRequest): AsyncGenerator<ModelStreamChunk> {
        if (!this.apiKey) throw new AdapterError('OpenAI API key not configured');

        const { default: OpenAI } = await import('openai');
        const client = new OpenAI({ apiKey: this.apiKey });

        const messages = request.messages.map((m) => {
            if (m.role === 'tool') {
                return {
                    role: 'tool' as const,
                    content: m.content,
                    tool_call_id: m.toolCallId ?? '',
                };
            }
            return {
                role: m.role as 'system' | 'user' | 'assistant',
                content: m.content,
                name: m.name,
                tool_calls: m.toolCalls?.map(tc => ({
                    id: tc.callId,
                    type: 'function' as const,
                    function: {
                        name: tc.toolId,
                        arguments: JSON.stringify(tc.arguments),
                    }
                })),
            };
        });

        const stream = await client.chat.completions.create({
            model: request.model,
            messages,
            temperature: request.temperature,
            max_tokens: request.maxTokens,
            stream: true,
        });

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (delta?.content) {
                yield {
                    content: delta.content,
                    tokensOut: 1, // Approximate
                };
            }
        }
    }
}

// ─── Anthropic Adapter ──────────────────────────────────────────────────

export class AnthropicAdapter implements ProviderAdapter {
    readonly providerId = 'anthropic';
    private apiKey: string | undefined;

    constructor() {
        this.apiKey = process.env.ANTHROPIC_API_KEY;
    }

    isAvailable(): boolean {
        return !!this.apiKey;
    }

    async complete(request: ProviderRequest): Promise<ModelResponse> {
        if (!this.apiKey) throw new AdapterError('Anthropic API key not configured');

        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey: this.apiKey });

        const startTime = Date.now();

        // Separate system message from conversation
        const systemMessage = request.messages.find((m) => m.role === 'system')?.content;
        const chatMessages = request.messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            }));

        const tools = request.tools?.map((t) => ({
            name: t.id,
            description: t.description,
            input_schema: t.inputSchema as Record<string, unknown>,
        }));

        const response = await client.messages.create({
            model: request.model,
            messages: chatMessages,
            system: systemMessage,
            max_tokens: request.maxTokens ?? 4096,
            temperature: request.temperature,
            tools: tools?.length ? (tools as any) : undefined,
            top_p: request.topP,
            stop_sequences: request.stop,
        });

        let textContent = '';
        const toolCallsArr: Array<{ toolId: string; arguments: Record<string, unknown>; callId: string; timestamp: string }> = [];

        for (const block of response.content) {
            if (block.type === 'text') {
                textContent += (block as any).text ?? '';
            } else if (block.type === 'tool_use') {
                const tb = block as any;
                toolCallsArr.push({
                    toolId: tb.name,
                    arguments: tb.input as Record<string, unknown>,
                    callId: tb.id,
                    timestamp: new Date().toISOString(),
                });
            }
        }

        return {
            content: textContent,
            toolCalls: toolCallsArr.length > 0 ? toolCallsArr : undefined,
            tokensIn: response.usage.input_tokens,
            tokensOut: response.usage.output_tokens,
            model: response.model,
            finishReason: response.stop_reason ?? 'end_turn',
            latencyMs: Date.now() - startTime,
        };
    }

    async *stream(request: ProviderRequest): AsyncGenerator<ModelStreamChunk> {
        if (!this.apiKey) throw new AdapterError('Anthropic API key not configured');

        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey: this.apiKey });

        const systemMessage = request.messages.find((m) => m.role === 'system')?.content;
        const chatMessages = request.messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            }));

        const stream = client.messages.stream({
            model: request.model,
            messages: chatMessages,
            system: systemMessage,
            max_tokens: request.maxTokens ?? 4096,
            temperature: request.temperature,
        });

        for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                yield {
                    content: event.delta.text,
                    tokensOut: 1,
                };
            }
        }
    }
}

// ─── Google Gemini Adapter ──────────────────────────────────────────────

export class GoogleAdapter implements ProviderAdapter {
    readonly providerId = 'google';
    private apiKey: string | undefined;

    constructor() {
        this.apiKey = process.env.GOOGLE_AI_API_KEY;
    }

    isAvailable(): boolean {
        return !!this.apiKey;
    }

    async complete(request: ProviderRequest): Promise<ModelResponse> {
        if (!this.apiKey) throw new AdapterError('Google AI API key not configured');

        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(this.apiKey);

        const startTime = Date.now();

        const model = genAI.getGenerativeModel({ model: request.model });

        // Build content parts
        const systemInstruction = request.messages.find((m) => m.role === 'system')?.content;
        const history = request.messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }],
            }));

        const lastMessage = history.pop();
        if (!lastMessage) throw new AdapterError('No messages provided');

        const chat = model.startChat({
            history: history as any,
            generationConfig: {
                temperature: request.temperature,
                maxOutputTokens: request.maxTokens,
                topP: request.topP,
                stopSequences: request.stop,
            },
            systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } as any : undefined,
        });

        const result = await chat.sendMessage(lastMessage.parts.map((p) => p.text).join(''));
        const response = result.response;

        return {
            content: response.text(),
            tokensIn: response.usageMetadata?.promptTokenCount ?? 0,
            tokensOut: response.usageMetadata?.candidatesTokenCount ?? 0,
            model: request.model,
            finishReason: 'stop',
            latencyMs: Date.now() - startTime,
        };
    }

    async *stream(request: ProviderRequest): AsyncGenerator<ModelStreamChunk> {
        if (!this.apiKey) throw new AdapterError('Google AI API key not configured');

        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(this.apiKey);

        const model = genAI.getGenerativeModel({ model: request.model });

        const messageText = request.messages
            .filter((m) => m.role !== 'system')
            .map((m) => m.content)
            .join('\n');

        const result = await model.generateContentStream(messageText);

        for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) {
                yield { content: text, tokensOut: 1 };
            }
        }
    }
}

// ─── Local/Ollama Adapter ───────────────────────────────────────────────

export class LocalAdapter implements ProviderAdapter {
    readonly providerId = 'local';
    private baseUrl: string;

    constructor() {
        this.baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    }

    isAvailable(): boolean {
        // Local models are always "available" — actual checks happen at request time
        return true;
    }

    async complete(request: ProviderRequest): Promise<ModelResponse> {
        const startTime = Date.now();

        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: request.model,
                messages: request.messages.map((m) => ({
                    role: m.role,
                    content: m.content,
                })),
                stream: false,
                options: {
                    temperature: request.temperature,
                    num_predict: request.maxTokens,
                    top_p: request.topP,
                    stop: request.stop,
                },
            }),
        });

        if (!response.ok) {
            throw new AdapterError(`Ollama request failed: ${response.statusText}`);
        }

        const data = await response.json() as any;

        return {
            content: data.message?.content ?? '',
            tokensIn: data.eval_count ?? 0,
            tokensOut: data.prompt_eval_count ?? 0,
            model: data.model ?? request.model,
            finishReason: data.done ? 'stop' : 'length',
            latencyMs: Date.now() - startTime,
        };
    }

    async *stream(request: ProviderRequest): AsyncGenerator<ModelStreamChunk> {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: request.model,
                messages: request.messages.map((m) => ({
                    role: m.role,
                    content: m.content,
                })),
                stream: true,
                options: {
                    temperature: request.temperature,
                    num_predict: request.maxTokens,
                },
            }),
        });

        if (!response.ok || !response.body) {
            throw new AdapterError(`Ollama stream failed: ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value, { stream: true });
            for (const line of text.split('\n').filter(Boolean)) {
                try {
                    const data = JSON.parse(line);
                    if (data.message?.content) {
                        yield { content: data.message.content, tokensOut: 1 };
                    }
                } catch {
                    // Skip unparseable lines
                }
            }
        }
    }
}

// ─── Groq Adapter ───────────────────────────────────────────────────────

export class GroqAdapter implements ProviderAdapter {
    readonly providerId = 'groq';
    private apiKey: string | undefined;

    constructor() {
        this.apiKey = process.env.GROQ_API_KEY;
    }

    isAvailable(): boolean {
        return !!this.apiKey;
    }

    async complete(request: ProviderRequest): Promise<ModelResponse> {
        if (!this.apiKey) throw new AdapterError('GROQ_API_KEY not configured');

        const startTime = Date.now();

        // Groq uses an OpenAI-compatible REST API
        const body: Record<string, unknown> = {
            model: request.model,
            messages: request.messages.map((m) => {
                if (m.role === 'tool') {
                    return {
                        role: 'tool' as const,
                        content: m.content,
                        tool_call_id: m.toolCallId ?? '',
                    };
                }
                return {
                    role: m.role as 'system' | 'user' | 'assistant',
                    content: m.content,
                    name: m.name,
                    tool_calls: m.toolCalls?.map(tc => ({
                        id: tc.callId,
                        type: 'function' as const,
                        function: {
                            name: tc.toolId,
                            arguments: JSON.stringify(tc.arguments),
                        }
                    })),
                };
            }),
            temperature: request.temperature ?? 0.7,
            max_tokens: request.maxTokens ?? 4096,
            top_p: request.topP,
            stop: request.stop,
            stream: false,
        };

        // Add tools if provided
        if (request.tools && request.tools.length > 0) {
            body.tools = request.tools.map((t) => ({
                type: 'function' as const,
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.inputSchema,
                },
            }));
        }

        // Force JSON output mode if requested (Groq supports this)
        if (request.responseFormat === 'json') {
            body.response_format = { type: 'json_object' };
        }

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new AdapterError(`Groq API error (${response.status}): ${err}`);
        }

        const data = await response.json() as any;
        const choice = data.choices?.[0];

        // Extract tool calls
        const toolCalls = choice?.message?.tool_calls?.map((tc: any) => ({
            toolId: tc.function.name,
            arguments: JSON.parse(tc.function.arguments ?? '{}'),
            callId: tc.id,
        })) ?? [];

        return {
            content: choice?.message?.content ?? '',
            tokensIn: data.usage?.prompt_tokens ?? 0,
            tokensOut: data.usage?.completion_tokens ?? 0,
            model: data.model ?? request.model,
            finishReason: choice?.finish_reason ?? 'stop',
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            latencyMs: Date.now() - startTime,
        };
    }

    async *stream(request: ProviderRequest): AsyncGenerator<ModelStreamChunk> {
        if (!this.apiKey) throw new AdapterError('GROQ_API_KEY not configured');

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: request.model,
                messages: request.messages.map((m) => {
                    if (m.role === 'tool') {
                        return {
                            role: 'tool' as const,
                            content: m.content,
                            tool_call_id: m.toolCallId ?? '',
                        };
                    }
                    return {
                        role: m.role as 'system' | 'user' | 'assistant',
                        content: m.content,
                        name: m.name,
                        tool_calls: m.toolCalls?.map(tc => ({
                            id: tc.callId,
                            type: 'function' as const,
                            function: {
                                name: tc.toolId,
                                arguments: JSON.stringify(tc.arguments),
                            }
                        })),
                    };
                }),
                temperature: request.temperature ?? 0.7,
                max_tokens: request.maxTokens ?? 4096,
                stream: true,
            }),
        });

        if (!response.ok || !response.body) {
            throw new AdapterError(`Groq stream failed: ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value, { stream: true });
            for (const line of text.split('\n')) {
                if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
                try {
                    const data = JSON.parse(line.slice(6));
                    const delta = data.choices?.[0]?.delta;
                    if (delta?.content) {
                        yield {
                            content: delta.content,
                            tokensOut: 1,
                        };
                    }
                } catch {
                    // Skip unparseable chunks
                }
            }
        }
    }
}

// ─── Adapter Manager ────────────────────────────────────────────────────

/**
 * ProviderAdapterManager: Creates and caches provider adapters.
 */
export class ProviderAdapterManager {
    private adapters = new Map<string, ProviderAdapter>();

    constructor() {
        // Register all built-in adapters
        const openai = new OpenAIAdapter();
        const anthropic = new AnthropicAdapter();
        const google = new GoogleAdapter();
        const groq = new GroqAdapter();
        const local = new LocalAdapter();

        this.adapters.set('openai', openai);
        this.adapters.set('anthropic', anthropic);
        this.adapters.set('google', google);
        this.adapters.set('groq', groq);
        this.adapters.set('local', local);
    }

    /**
     * Get a provider adapter by ID.
     */
    get(providerId: string): ProviderAdapter | undefined {
        return this.adapters.get(providerId);
    }

    /**
     * Get all available (configured) adapters.
     */
    getAvailable(): ProviderAdapter[] {
        return [...this.adapters.values()].filter((a) => a.isAvailable());
    }

    /**
     * Register a custom adapter.
     */
    register(adapter: ProviderAdapter): void {
        this.adapters.set(adapter.providerId, adapter);
    }

    /**
     * List all provider IDs (available or not).
     */
    listProviders(): string[] {
        return [...this.adapters.keys()];
    }
}

export class AdapterError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AdapterError';
    }
}
