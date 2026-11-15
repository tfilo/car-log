import { ServerFunctionOperation } from '../../src/server-functions/server-function-operations';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { UserRole, UserStatus, FuelType } from '../../src/generated/prisma/enums';
import { ResultKind } from '../../src/common/result-kind';
import { AuthErrorCode } from '../../src/auth/auth-errors';
import { FuelErrorCode } from '../../src/fuel/fuel-errors';
import { FuelPriceInput } from '../../src/fuel/fuel-values';
import type { FuelOperationResult, FuelValidationFailure } from '../../src/fuel/fuel.types';
import { HttpMethod, HttpStatus } from '../../src/common/http';

// Exercise generated RPC URLs and their real transport policies independently of the GUI.
test('fuel RPCs validate, authorize, calculate, paginate and reject CSRF over HTTP', async ({ context, request }) => {
    const baseURL = test.info().project.use.baseURL!;
    const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.E2E_DATABASE_URL! }) });
    const names = [
        ServerFunctionOperation.LIST_FUEL_RECORDS,
        ServerFunctionOperation.GET_FUEL_RECORD,
        ServerFunctionOperation.CREATE_FUEL_RECORD,
        ServerFunctionOperation.UPDATE_FUEL_RECORD,
        ServerFunctionOperation.DELETE_FUEL_RECORD
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
            const source = await (await request.get('/src/fuel/fuel.ts')).text();

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
        ): Promise<{ result: FuelOperationResult | FuelValidationFailure }> {
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

        const username = `httpfuel${randomUUID().replaceAll('-', '').slice(0, 16)}`;
        const user = await database.user.create({
            data: {
                email: `${username}@example.test`,
                username,
                passwordHash: 'synthetic-not-for-login',
                role: UserRole.USER,
                status: UserStatus.ACTIVE
            }
        });
        const token = randomBytes(32).toString('base64url');

        await database.session.create({
            data: {
                userId: user.id,
                tokenHash: createHash('sha256').update(token).digest('hex'),
                expiresAt: new Date(Date.now() + 86_400_000)
            }
        });

        const vehicle = await database.vehicle.create({
            data: { userId: user.id, manufacturer: 'Synthetic', model: 'RPC', fuelTypes: [FuelType.PETROL, FuelType.ELECTRIC] }
        });
        const input = {
            vehicleId: vehicle.id,
            fuelType: FuelType.PETROL,
            occurredAt: '2026-01-01T12:00:00.000Z',
            odometer: 1000,
            quantity: 40,
            price: { type: FuelPriceInput.UNIT, unitPrice: 1.799 },
            isFull: true
        };

        const anonymous = await call(ServerFunctionOperation.CREATE_FUEL_RECORD, HttpMethod.POST, input);

        expect(anonymous.result).toMatchObject({ kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED });
        expect(status).toBe(HttpStatus.UNAUTHORIZED);

        await context.addCookies([{ name: 'car_log_session', value: token, url: baseURL, httpOnly: true, sameSite: 'Lax' }]);

        const invalid = await call(ServerFunctionOperation.CREATE_FUEL_RECORD, HttpMethod.POST, { ...input, quantity: 0 });

        expect(invalid.result).toMatchObject({
            kind: ResultKind.INVALID,
            code: FuelErrorCode.INVALID,
            fields: { quantity: ['validation.quantity'] }
        });
        expect(status).toBe(HttpStatus.BAD_REQUEST);

        const oversizedField = await call(ServerFunctionOperation.CREATE_FUEL_RECORD, HttpMethod.POST, {
            ...input,
            quantity: ' '.repeat(64) + '40'
        });

        expect(oversizedField.result).toMatchObject({
            kind: ResultKind.INVALID,
            code: FuelErrorCode.INVALID,
            fields: { quantity: ['validation.decimal'] }
        });
        expect(status).toBe(HttpStatus.BAD_REQUEST);
        expect(await database.fuelRecord.count({ where: { vehicleId: vehicle.id } })).toBe(0);

        const oversizedRequest = await context.request.post(urls[ServerFunctionOperation.CREATE_FUEL_RECORD], {
            headers: { Origin: baseURL },
            data: { data: { ...input, quantity: '1'.repeat(9000) } }
        });
        expect(oversizedRequest.status()).toBe(HttpStatus.PAYLOAD_TOO_LARGE);

        const created = await call(ServerFunctionOperation.CREATE_FUEL_RECORD, HttpMethod.POST, input);

        expect(created.result).toMatchObject({ kind: ResultKind.CREATED, record: { totalPrice: 71.96, consumptionPer100Km: null } });
        expect(cacheControl).toBe('no-store');

        if (created.result.kind !== ResultKind.CREATED && created.result.kind !== ResultKind.UPDATED)
            throw new Error('Expected created fuel record.');

        const recordId = created.result.record.id;

        expect((await call(ServerFunctionOperation.GET_FUEL_RECORD, HttpMethod.GET, { recordId })).result).toMatchObject({
            kind: ResultKind.FUEL_RECORD,
            record: { id: recordId }
        });
        expect((await call(ServerFunctionOperation.CREATE_FUEL_RECORD, HttpMethod.POST, input)).result).toMatchObject({
            code: FuelErrorCode.TIMESTAMP_CONFLICT
        });
        expect(status).toBe(HttpStatus.CONFLICT);
        expect(
            (await call(ServerFunctionOperation.LIST_FUEL_RECORDS, HttpMethod.GET, { vehicleId: vehicle.id, page: 0, pageSize: 1 })).result
        ).toMatchObject({
            kind: ResultKind.FUEL_RECORDS,
            page: 0,
            total: 1
        });

        const next = await call(ServerFunctionOperation.CREATE_FUEL_RECORD, HttpMethod.POST, {
            ...input,
            occurredAt: '2026-01-02T12:00:00.000Z',
            odometer: 1500
        });

        expect(next.result).toMatchObject({ record: { consumptionPer100Km: 8.0 } });

        if (next.result.kind !== ResultKind.CREATED && next.result.kind !== ResultKind.UPDATED)
            throw new Error('Expected created interval.');

        expect(
            (await call(ServerFunctionOperation.UPDATE_FUEL_RECORD, HttpMethod.POST, { ...input, recordId, quantity: 20 })).result
        ).toMatchObject({
            kind: ResultKind.UPDATED
        });

        const nextInput = { ...input, recordId: next.result.record.id, occurredAt: '2026-01-02T12:00:00.000Z', odometer: 1500 };

        expect(
            (await call(ServerFunctionOperation.UPDATE_FUEL_RECORD, HttpMethod.POST, { ...nextInput, isFull: false })).result
        ).toMatchObject({ record: { consumptionPer100Km: null } });
        expect((await call(ServerFunctionOperation.UPDATE_FUEL_RECORD, HttpMethod.POST, nextInput)).result).toMatchObject({
            record: { consumptionPer100Km: 8.0 }
        });

        const wrongMethod = await context.request.post(urls[ServerFunctionOperation.LIST_FUEL_RECORDS], {
            headers: { Origin: baseURL },
            data: { data: { vehicleId: vehicle.id } }
        });

        expect(wrongMethod.status()).toBe(HttpStatus.METHOD_NOT_ALLOWED);

        const forbidden = await context.request.post(urls.deleteFuelRecord, {
            headers: { Origin: 'https://invalid.example.test' },
            data: { data: { recordId, confirmed: true } }
        });

        expect(forbidden.status()).toBe(HttpStatus.FORBIDDEN);
        expect(await database.fuelRecord.count({ where: { vehicleId: vehicle.id } })).toBe(2);
        expect(
            (await call(ServerFunctionOperation.DELETE_FUEL_RECORD, HttpMethod.POST, { recordId, confirmed: true })).result
        ).toMatchObject({
            kind: ResultKind.DELETED
        });
        expect(
            (await call(ServerFunctionOperation.GET_FUEL_RECORD, HttpMethod.GET, { recordId: next.result.record.id })).result
        ).toMatchObject({
            record: { consumptionPer100Km: null }
        });
    } finally {
        await database.$disconnect();
    }
});
