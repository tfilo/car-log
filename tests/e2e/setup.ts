import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';

export default async function setup() {
    const source = process.env.DATABASE_URL;

    if (!source) throw new Error('Set DATABASE_URL for the PostgreSQL instance used to create disposable E2E databases.');

    const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: source }) });
    const name = `car_log_e2e_${randomUUID().replaceAll('-', '')}`;
    const url = new URL(source);

    url.pathname = `/${name}`;

    const port = process.env.E2E_PORT ?? '4370';
    const baseURL = `http://127.0.0.1:${port}`;
    // Refuse to run against an unrelated application already using the test port.
    const probe = createServer();

    await new Promise<void>((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(Number(port), '127.0.0.1', () => probe.close((error) => (error ? reject(error) : resolve())));
    });
    const pictureDirectory = await mkdtemp(join(tmpdir(), 'car-log-e2e-pictures-'));
    process.env.E2E_PICTURE_DIR = pictureDirectory;
    process.env.E2E_DATABASE_URL = url.href;
    process.env.PASSWORD_PEPPER = randomBytes(32).toString('hex');

    const args =
        process.env.E2E_PRODUCTION === 'true'
            ? ['.output/server/index.mjs']
            : ['node_modules/vite/bin/vite.js', 'dev', '--host', '127.0.0.1', '--port', port, '--strictPort'];

    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);

    let server: ReturnType<typeof spawn> | undefined;

    const cleanup = async () => {
        if (server?.pid && server.exitCode === null) {
            const stopped = once(server, 'exit');

            server.kill('SIGTERM');
            await Promise.race([stopped, delay(2000)]);

            if (server.exitCode === null) {
                server.kill('SIGKILL');
                await stopped;
            }
        }

        try {
            await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
        } finally {
            await admin.$disconnect();
            await rm(pictureDirectory, { recursive: true, force: true });
        }
    };

    try {
        execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
            env: { ...process.env, DATABASE_URL: url.href },
            stdio: 'pipe'
        });
        server = spawn(process.execPath, args, {
            env: {
                ...process.env,
                DATABASE_URL: url.href,
                VEHICLE_IMAGE_DIR: pictureDirectory,
                HOST: '127.0.0.1',
                PORT: port,
                APP_URL: baseURL,
                SMTP_HOST: '127.0.0.1',
                SMTP_PORT: '1025',
                SMTP_SECURE: 'false',
                SMTP_USER: '',
                SMTP_PASSWORD: '',
                MAIL_FROM: 'no-reply@example.test'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let output = '';

        server.stdout?.on('data', (chunk) => {
            output = (output + chunk.toString()).slice(-8000);
        });
        server.stderr?.on('data', (chunk) => {
            output = (output + chunk.toString()).slice(-8000);
        });

        let startupError: Error | undefined;

        server.on('error', (error) => {
            startupError = error;
        });

        for (let attempt = 0; attempt < 150; attempt++) {
            if (startupError) throw startupError;

            if (server.exitCode !== null) throw new Error(`E2E server stopped: ${output}`);

            try {
                if ((await fetch(`${baseURL}/login`)).ok) return cleanup;
            } catch {
                /* Wait for the local server to listen. */
            }

            await delay(200);
        }

        throw new Error(`E2E server did not start: ${output}`);
    } catch (error) {
        await cleanup();

        throw error;
    }
}
