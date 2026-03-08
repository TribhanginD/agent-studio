// ─── Agent Studio: Database Connection ────────────────────────────────────
// PostgreSQL connection setup using Drizzle ORM with the postgres.js driver.

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDatabase>;

/**
 * Create a database connection with Drizzle ORM.
 *
 * @param connectionString - PostgreSQL connection string
 * @param options - postgres.js connection options
 */
export function createDatabase(
    connectionString?: string,
    options?: { maxConnections?: number; idleTimeout?: number },
) {
    const url = connectionString ?? process.env.DATABASE_URL ?? 'postgresql://agent_studio:agent_studio@localhost:5432/agent_studio';

    const client = postgres(url, {
        max: options?.maxConnections ?? 10,
        idle_timeout: options?.idleTimeout ?? 30,
        prepare: false, // Required for some PG extensions
    });

    return drizzle(client, { schema });
}

/**
 * Create a connection for migrations (single connection, not pooled).
 */
export function createMigrationConnection(connectionString?: string) {
    const url = connectionString ?? process.env.DATABASE_URL ?? 'postgresql://agent_studio:agent_studio@localhost:5432/agent_studio';
    return postgres(url, { max: 1 });
}
