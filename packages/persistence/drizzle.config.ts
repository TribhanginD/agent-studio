import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    schema: './src/schema.ts',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.DATABASE_URL ?? 'postgresql://agent_studio:agent_studio@localhost:5432/agent_studio',
    },
});
