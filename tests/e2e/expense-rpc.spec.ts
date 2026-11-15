import { ServerFunctionOperation } from '../../src/server-functions/server-function-operations';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { UserRole, UserStatus, FuelType } from '../../src/generated/prisma/enums';
import { ResultKind } from '../../src/common/result-kind';
import { AuthErrorCode } from '../../src/auth/auth-errors';
import { ExpenseErrorCode } from '../../src/expenses/expense-errors';
import type { ExpenseOperationResult, ExpenseValidationFailure } from '../../src/expenses/expense.types';
import { HttpMethod, HttpStatus } from '../../src/common/http';

// Exercise generated RPC URLs and their real transport policies independently of the GUI.
test('expense and category RPCs enforce validation, sessions, methods and CSRF over HTTP', async ({ context, request }) => {
    const baseURL = test.info().project.use.baseURL!;
    const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.E2E_DATABASE_URL! }) });
    const names = [
        ServerFunctionOperation.LIST_EXPENSES,
        ServerFunctionOperation.GET_EXPENSE,
        ServerFunctionOperation.CREATE_EXPENSE,
        ServerFunctionOperation.UPDATE_EXPENSE,
        ServerFunctionOperation.DELETE_EXPENSE,
        ServerFunctionOperation.LIST_EXPENSE_CATEGORIES,
        ServerFunctionOperation.CREATE_EXPENSE_CATEGORY,
        ServerFunctionOperation.UPDATE_EXPENSE_CATEGORY,
        ServerFunctionOperation.DELETE_EXPENSE_CATEGORY
    ];
    const urls: Record<string, string> = {};

    try {
        if (process.env.E2E_PRODUCTION === 'true') {
            for (const name of await readdir('.output/server/_ssr')) {
                if (!name.endsWith('.mjs')) continue;

                const source = await readFile(`.output/server/_ssr/${name}`, 'utf8');

                for (const method of names) {
                    const id = source.match(new RegExp(`id: "([^"]+)",\\s*name: "${method}"`))?.[1];

                    if (id) urls[method] = `${baseURL}/_serverFn/${id}`;
                }
            }
        } else {
            const source = await (await request.get('/src/expenses/expenses.ts')).text();

            for (const method of names) {
                const start = source.search(new RegExp(`\\b(?:const|let|var)\\s+${method}\\s*=`));
                const id = source.slice(start).match(/createClientRpc\(\s*["']([^"']+)/)?.[1];

                if (id) urls[method] = `${baseURL}/_serverFn/${id}`;
            }

            for (const privateMarker of ['PrismaClient', 'calculateFuelConsumption', 'PASSWORD_PEPPER', 'db.$transaction']) {
                expect(source).not.toContain(privateMarker);
            }
        }

        expect(Object.keys(urls)).toHaveLength(names.length);

        // The framework client serializer is needed for the Start RPC request/response envelope.
        const { createClientRpc } = await import('@tanstack/start-client-core/client-rpc');
        const { runWithStartContext } = await import('@tanstack/start-storage-context');

        process.env.TSS_SERVER_FN_BASE = `${baseURL}/_serverFn/`;

        let status = 0;
        let cacheControl: string | undefined;

        async function call(
            name: string,
            method: typeof HttpMethod.GET | typeof HttpMethod.POST,
            data: object,
            client: APIRequestContext = context.request
        ): Promise<{ result: ExpenseOperationResult | ExpenseValidationFailure }> {
            const rpc = createClientRpc(urls[name].slice(process.env.TSS_SERVER_FN_BASE!.length));

            return runWithStartContext(
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
                        method,
                        data,
                        headers: { Origin: baseURL },
                        fetch: async (url: string, init: RequestInit) => {
                            const response = await client.fetch(String(url), {
                                method: init?.method,
                                headers: Object.fromEntries(new Headers(init?.headers)),
                                data: typeof init?.body === 'string' ? init.body : undefined
                            });

                            status = response.status();
                            cacheControl = response.headers()['cache-control'];

                            return new Response(new Uint8Array(await response.body()), { status, headers: response.headers() });
                        }
                    })
            );
        }

        const username = `httpexpense${randomUUID().replaceAll('-', '').slice(0, 14)}`;
        const user = await database.user.create({
            data: {
                username,
                email: `${username}@example.test`,
                passwordHash: 'synthetic-unused',
                role: UserRole.USER,
                status: UserStatus.ACTIVE
            }
        });
        const vehicle = await database.vehicle.create({
            data: { userId: user.id, manufacturer: 'Synthetic', model: 'RPC', fuelTypes: [FuelType.PETROL] }
        });
        const token = randomBytes(32).toString('base64url');

        await database.session.create({
            data: {
                userId: user.id,
                tokenHash: createHash('sha256').update(token).digest('hex'),
                expiresAt: new Date(Date.now() + 86_400_000)
            }
        });
        expect((await call(ServerFunctionOperation.LIST_EXPENSE_CATEGORIES, HttpMethod.GET, {})).result).toMatchObject({
            code: AuthErrorCode.AUTH_REQUIRED
        });
        expect(status).toBe(HttpStatus.UNAUTHORIZED);
        await context.addCookies([{ name: 'car_log_session', value: token, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);

        const createdCategory = await call(ServerFunctionOperation.CREATE_EXPENSE_CATEGORY, HttpMethod.POST, { name: 'Service' });

        expect(createdCategory.result.kind).toBe(ResultKind.CREATED);
        if (!('category' in createdCategory.result)) throw new Error('Expected category.');

        const categoryId = createdCategory.result.category.id;
        const input = { vehicleId: vehicle.id, categoryId, occurredAt: '2026-07-15T12:00:00Z', odometer: 12300, totalPrice: 12.34 };
        const invalid = await call(ServerFunctionOperation.CREATE_EXPENSE, HttpMethod.POST, { ...input, comment: 'x'.repeat(1001) });

        expect(invalid.result).toMatchObject({
            kind: ResultKind.INVALID,
            code: ExpenseErrorCode.INVALID,
            fields: { comment: ['validation.comment'] }
        });
        expect(status).toBe(HttpStatus.BAD_REQUEST);
        const oversized = await context.request.post(urls[ServerFunctionOperation.CREATE_EXPENSE], {
            headers: { Origin: baseURL },
            data: { data: { ...input, comment: 'x'.repeat(9000) } }
        });

        expect(oversized.status()).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
        const created = await call(ServerFunctionOperation.CREATE_EXPENSE, HttpMethod.POST, input);

        expect(created.result.kind).toBe(ResultKind.CREATED);
        expect(cacheControl).toBe('no-store');
        if (!('expense' in created.result)) throw new Error('Expected expense.');

        const expenseId = created.result.expense.id;

        expect((await call(ServerFunctionOperation.LIST_EXPENSES, HttpMethod.GET, { vehicleId: vehicle.id })).result).toMatchObject({
            kind: ResultKind.EXPENSES,
            total: 1,
            page: 0
        });
        expect((await call(ServerFunctionOperation.GET_EXPENSE, HttpMethod.GET, { expenseId })).result).toMatchObject({
            kind: ResultKind.EXPENSE,
            expense: { totalPrice: 12.34 }
        });
        expect(
            (await call(ServerFunctionOperation.UPDATE_EXPENSE, HttpMethod.POST, { ...input, expenseId, totalPrice: 0.1 })).result
        ).toMatchObject({ kind: ResultKind.UPDATED, expense: { totalPrice: 0.1 } });
        expect(
            (
                await call(ServerFunctionOperation.UPDATE_EXPENSE_CATEGORY, HttpMethod.POST, {
                    categoryId,
                    name: 'Corrected',
                    isArchived: true
                })
            ).result.kind
        ).toBe(ResultKind.UPDATED);
        expect(
            (await call(ServerFunctionOperation.DELETE_EXPENSE_CATEGORY, HttpMethod.POST, { categoryId, confirmed: true })).result
        ).toMatchObject({ code: ExpenseErrorCode.CATEGORY_IN_USE });
        expect(status).toBe(HttpStatus.CONFLICT);

        const csrf = await context.request.post(urls[ServerFunctionOperation.DELETE_EXPENSE], {
            headers: { Origin: 'https://invalid.example.test' },
            data: { data: { expenseId, confirmed: true } }
        });

        expect(csrf.status()).toBe(HttpStatus.FORBIDDEN);
        expect((await context.request.get(urls[ServerFunctionOperation.DELETE_EXPENSE], { headers: { Origin: baseURL } })).status()).toBe(
            HttpStatus.METHOD_NOT_ALLOWED
        );
        expect(await database.expense.count({ where: { id: expenseId } })).toBe(1);
        expect((await call(ServerFunctionOperation.DELETE_EXPENSE, HttpMethod.POST, { expenseId, confirmed: true })).result.kind).toBe(
            ResultKind.DELETED
        );
        expect(
            (await call(ServerFunctionOperation.DELETE_EXPENSE_CATEGORY, HttpMethod.POST, { categoryId, confirmed: true })).result.kind
        ).toBe(ResultKind.DELETED);
    } finally {
        await database.$disconnect();
    }
});
