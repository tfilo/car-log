import { ServerFunctionOperation } from '../../src/server-functions/server-function-operations';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { UserRole, UserStatus, FuelType } from '../../src/generated/prisma/enums';
import { ResultKind } from '../../src/common/result-kind';
import { AuthErrorCode } from '../../src/auth/auth-errors';
import { StatisticsErrorCode } from '../../src/statistics/statistics-errors';
import { StatisticsPeriod } from '../../src/statistics/statistics-values';
import type { StatisticsResult, StatisticsValidationFailure } from '../../src/statistics/statistics.types';
import { HttpMethod, HttpStatus } from '../../src/common/http';

// Exercise generated RPC URLs and their real transport policies independently of the GUI.
test('statistics RPC validates filters and enforces ownership, method, CSRF and session policies', async ({ context, request }) => {
    const baseURL = test.info().project.use.baseURL!;
    const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.E2E_DATABASE_URL! }) });
    const names = [ServerFunctionOperation.GET_STATISTICS];
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
            const source = await (await request.get('/src/statistics/statistics.ts')).text();

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
        ): Promise<{ result: StatisticsResult | StatisticsValidationFailure }> {
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

        const username = `httpstats${randomUUID().replaceAll('-', '').slice(0, 14)}`;
        const user = await database.user.create({
            data: {
                username,
                email: `${username}@example.test`,
                passwordHash: 'synthetic-unused',
                role: UserRole.USER,
                status: UserStatus.ACTIVE
            }
        });
        const car = await database.vehicle.create({
            data: { userId: user.id, manufacturer: 'Synthetic', model: 'Report', fuelTypes: [FuelType.PETROL] }
        });
        const token = randomBytes(32).toString('base64url');

        await database.session.create({
            data: {
                userId: user.id,
                tokenHash: createHash('sha256').update(token).digest('hex'),
                expiresAt: new Date(Date.now() + 86_400_000)
            }
        });
        expect((await call(ServerFunctionOperation.GET_STATISTICS, HttpMethod.GET, { vehicleId: car.id })).result).toMatchObject({
            code: AuthErrorCode.AUTH_REQUIRED
        });
        expect(status).toBe(HttpStatus.UNAUTHORIZED);

        await context.addCookies([{ name: 'car_log_session', value: token, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);
        const result = await call(ServerFunctionOperation.GET_STATISTICS, HttpMethod.GET, { vehicleId: car.id });

        expect(result.result).toMatchObject({ kind: ResultKind.STATISTICS, statistics: { totalCosts: 0.0, latestOdometer: null } });
        expect(cacheControl).toBe('no-store');

        expect(
            (
                await call(ServerFunctionOperation.GET_STATISTICS, HttpMethod.GET, {
                    vehicleId: car.id,
                    period: StatisticsPeriod.CUSTOM,
                    from: '2026-02-01',
                    to: '2026-01-01'
                })
            ).result
        ).toMatchObject({
            kind: ResultKind.INVALID,
            code: StatisticsErrorCode.INVALID,
            fields: { to: ['validation.dateOrder'] }
        });
        expect(status).toBe(HttpStatus.BAD_REQUEST);
        expect((await call(ServerFunctionOperation.GET_STATISTICS, HttpMethod.GET, { vehicleId: randomUUID() })).result).toMatchObject({
            code: StatisticsErrorCode.VEHICLE_NOT_FOUND
        });
        expect(status).toBe(HttpStatus.NOT_FOUND);
        expect(
            (
                await context.request.post(urls[ServerFunctionOperation.GET_STATISTICS], {
                    headers: { Origin: baseURL },
                    data: { data: { vehicleId: car.id } }
                })
            ).status()
        ).toBe(HttpStatus.METHOD_NOT_ALLOWED);
        expect(
            (
                await context.request.get(urls[ServerFunctionOperation.GET_STATISTICS], {
                    headers: { Origin: 'https://invalid.example.test' }
                })
            ).status()
        ).toBe(HttpStatus.FORBIDDEN);
    } finally {
        await database.$disconnect();
    }
});
