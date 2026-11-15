import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations'
    },
    datasource: {
        // Generation does not need a live database or credentials (for example in CI).
        url: process.env.DATABASE_URL ?? ''
    }
});
