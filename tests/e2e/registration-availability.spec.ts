import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { UserRole, UserStatus } from '../../src/generated/prisma/enums';
import { hashPassword } from '../../src/auth/password.server';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { AuthErrorCode } from '../../src/auth/auth-errors';
import type { RegistrationResponse } from '../../src/auth/auth.types';
import { HttpMethod, HttpStatus } from '../../src/common/http';
import { ResultKind } from '../../src/common/result-kind';
import { ServerFunctionOperation } from '../../src/server-functions/server-function-operations';
import { i18n } from '../../src/i18n';

const disabled = process.env.DISABLE_REGISTRATION === 'true';
const t = i18n.getFixedT('sk', 'auth');

test('registration navigation follows the runtime setting', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' });
    await expect(page.getByRole('link', { name: t('login.register'), exact: true })).toHaveCount(disabled ? 0 : 1);

    await page.goto('/register', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(disabled ? /\/login$/ : /\/register$/);
    await expect(page.getByRole('heading', { name: t(disabled ? 'login.heading' : 'registration.heading'), exact: true })).toBeVisible();
});

test('registration RPC enforces the runtime setting without relying on navigation', async ({ request }) => {
    const baseURL = test.info().project.use.baseURL!;
    const name = ServerFunctionOperation.REGISTER;
    let id: string | undefined;

    if (process.env.E2E_PRODUCTION === 'true') {
        for (const file of await readdir('.output/server/_ssr')) {
            if (!file.endsWith('.mjs')) continue;

            const source = await readFile(`.output/server/_ssr/${file}`, 'utf8');
            id = source.match(new RegExp(`id: "([^"]+)",\\s*name: "${name}"`))?.[1];

            if (id) break;
        }
    } else {
        const source = await (await request.get('/src/auth/auth.ts')).text();
        const start = source.search(new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=`));
        id = source.slice(start).match(/createClientRpc\(\s*["']([^"']+)/)?.[1];
    }

    expect(id).toBeTruthy();

    const { createClientRpc } = await import('@tanstack/start-client-core/client-rpc');
    const { runWithStartContext } = await import('@tanstack/start-storage-context');
    process.env.TSS_SERVER_FN_BASE = `${baseURL}/_serverFn/`;
    const rpc = createClientRpc(id!);
    const username = `registration${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    let status = 0;
    const response: { result: RegistrationResponse } = await runWithStartContext(
        {
            startOptions: {},
            request: new Request(baseURL),
            contextAfterGlobalMiddlewares: {},
            handlerType: 'serverFn',
            getRouter: () => {
                throw new Error('This RPC test does not render a router.');
            }
        },
        () =>
            rpc({
                method: HttpMethod.POST,
                data: { username, email: `${username}@example.test`, password: 'Password123^' },
                headers: { Origin: baseURL },
                fetch: async (url: string, init: RequestInit) => {
                    const result = await fetch(url, init);
                    status = result.status;

                    return result;
                }
            })
    );

    expect(status).toBe(disabled ? HttpStatus.FORBIDDEN : HttpStatus.CREATED);
    expect(response.result).toMatchObject(
        disabled ? { kind: ResultKind.ERROR, code: AuthErrorCode.REGISTRATION_DISABLED } : { kind: ResultKind.CREATED }
    );
});

test('existing users can log in regardless of the registration setting', async ({ page }) => {
    const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.E2E_DATABASE_URL! }) });
    const username = `existing${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const password = 'Password123^';

    try {
        await database.user.create({
            data: {
                username,
                email: `${username}@example.test`,
                passwordHash: await hashPassword(password),
                role: UserRole.USER,
                status: UserStatus.ACTIVE
            }
        });

        await page.goto('/login', { waitUntil: 'networkidle' });
        await page.locator('input[name="identifier"]').fill(username);
        await page.locator('input[name="password"]').fill(password);
        await page.getByRole('button', { name: t('login.submit'), exact: true }).click();
        await expect(page).toHaveURL(/\/$/);
        await expect(page.getByRole('banner')).toBeVisible();
    } finally {
        await database.$disconnect();
    }
});
