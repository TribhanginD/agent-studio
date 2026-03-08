// ─── Agent Studio: OpenTelemetry SDK Setup ────────────────────────────────
// Initializes the OpenTelemetry SDK with OTLP exporter for distributed tracing.

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | null = null;

/**
 * Initialize the OpenTelemetry SDK for Agent Studio.
 *
 * @param options - Configuration options
 * @returns The initialized SDK instance
 */
export function initTelemetry(options?: {
    serviceName?: string;
    otlpEndpoint?: string;
    enabled?: boolean;
}): NodeSDK | null {
    const enabled = options?.enabled ?? (process.env.OTEL_ENABLED === 'true');
    if (!enabled) {
        console.info('[Telemetry] OpenTelemetry disabled. Set OTEL_ENABLED=true to enable.');
        return null;
    }

    const endpoint = options?.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';

    sdk = new NodeSDK({
        resource: new Resource({
            [ATTR_SERVICE_NAME]: options?.serviceName ?? 'agent-studio',
            [ATTR_SERVICE_VERSION]: '0.1.0',
        }),
        traceExporter: new OTLPTraceExporter({
            url: `${endpoint}/v1/traces`,
        }),
    });

    sdk.start();
    console.info(`[Telemetry] OpenTelemetry initialized. Exporting to ${endpoint}`);

    // Graceful shutdown
    process.on('SIGTERM', () => {
        sdk?.shutdown().then(
            () => console.info('[Telemetry] OpenTelemetry shut down cleanly'),
            (err) => console.error('[Telemetry] Shutdown error:', err),
        );
    });

    return sdk;
}

/**
 * Shutdown the OpenTelemetry SDK.
 */
export async function shutdownTelemetry(): Promise<void> {
    if (sdk) {
        await sdk.shutdown();
        sdk = null;
    }
}
