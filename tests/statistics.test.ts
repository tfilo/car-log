import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { FuelType, UserRole, UserStatus } from '../src/generated/prisma/enums';
import { db } from '../src/db.server';
import { createSession } from '../src/auth/session.server';
import * as sessions from '../src/auth/session.server';
import { createOwnedExpense } from '../src/expenses/expenses.server';
import { AuthErrorCode } from '../src/auth/auth-errors';
import { ResultKind } from '../src/common/result-kind';
import { createOwnedFuelRecord } from '../src/fuel/fuel.server';
import { FuelPriceInput } from '../src/fuel/fuel-values';
import { StatisticsPeriod, statisticsPointLimit } from '../src/statistics/statistics-values';
import { StatisticsErrorCode } from '../src/statistics/statistics-errors';
import { getOwnedStatistics } from '../src/statistics/statistics.server';

const databaseName = `car_log_statistics_${randomUUID().replaceAll('-', '')}`;
let database: PrismaClient;
let created = false;
let owner: { id: string; token: string };
let stranger: { id: string; token: string };
let vehicleId: string;
let categoryId: string;
const february = { period: StatisticsPeriod.CUSTOM, from: '2026-02-01', to: '2026-02-28' } as const;

async function account(role: UserRole = UserRole.USER) {
    const username = `stats${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const passwordHash = 'synthetic-unused';
    const user = await database.user.create({
        data: { username, email: `${username}@example.test`, passwordHash, role, status: UserStatus.ACTIVE }
    });
    const session = await createSession(user.id, passwordHash, undefined, database);

    if (!session) throw new Error('Expected session.');

    return { id: user.id, token: session.token };
}

async function fuel(
    day: string,
    odometer: number,
    quantity: number,
    totalPrice: number,
    fuelType: FuelType = FuelType.PETROL,
    isFull = true,
    previousRecordMissing = false
) {
    const result = await createOwnedFuelRecord(
        owner.token,
        {
            vehicleId,
            fuelType,
            occurredAt: `${day}T12:00:00Z`,
            odometer,
            quantity,
            price: { type: FuelPriceInput.TOTAL, totalPrice },
            isFull,
            previousRecordMissing
        },
        database
    );

    expect(result.result.kind).toBe(ResultKind.CREATED);
}

async function report(input = february) {
    const result = await getOwnedStatistics(owner.token, { vehicleId, ...input }, database);

    if (result.result.kind !== ResultKind.STATISTICS) throw new Error('Expected statistics.');

    return result.result.statistics;
}

beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);

    url.pathname = `/${databaseName}`;
    await db.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    created = true;
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url.href },
        stdio: 'pipe'
    });
    database = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.href }) });
}, 30_000);

beforeEach(async () => {
    await database.user.deleteMany();
    owner = await account();
    stranger = await account(UserRole.ADMIN);
    const car = await database.vehicle.create({
        data: {
            userId: owner.id,
            manufacturer: 'Synthetic',
            model: 'Statistics',
            fuelTypes: [FuelType.PETROL, FuelType.CNG, FuelType.ELECTRIC]
        }
    });
    const category = await database.expenseCategory.create({ data: { userId: owner.id, name: 'Service' } });

    vehicleId = car.id;
    categoryId = category.id;
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
    await database?.$disconnect();
    if (created) await db.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await db.$disconnect();
});

test('costs, per-fuel units, weighted consumption and pre-range baselines use recorded history correctly', async () => {
    await fuel('2026-01-31', 1000, 20, 30);
    await fuel('2026-02-01', 1100, 10, 20, FuelType.PETROL, false);
    await fuel('2026-02-02', 1400, 30, 60);
    await fuel('2026-02-05', 2000, 30, 60);
    await fuel('2026-02-08', 2300, 20, 40, FuelType.PETROL, true, true);
    await fuel('2026-02-09', 2400, 5, 10, FuelType.PETROL, false);
    await fuel('2026-02-03', 1500, 25, 7.5, FuelType.ELECTRIC);
    await fuel('2026-02-04', 1300, 8, 12, FuelType.CNG);
    await fuel('2026-02-06', 1600, 10, 15, FuelType.CNG);
    await database.expense.createMany({
        data: [
            { userId: owner.id, vehicleId, categoryId, totalPrice: 0.1, odometer: 2100, occurredAt: new Date('2026-02-10T12:00:00Z') },
            { userId: owner.id, vehicleId, categoryId, totalPrice: 0.2, odometer: 2000, occurredAt: new Date('2026-02-11T12:00:00Z') },
            { userId: owner.id, vehicleId, categoryId, totalPrice: 100, odometer: 2500, occurredAt: new Date('2026-02-20T12:00:00Z') },
            { userId: owner.id, vehicleId, categoryId, totalPrice: 99, odometer: 42, occurredAt: new Date('2026-03-02T12:00:00Z') }
        ]
    });
    const result = await report();
    const petrol = result.fuels.find((fuel) => fuel.fuelType === FuelType.PETROL)!;

    expect(result).toMatchObject({
        fuelCosts: 224.5,
        otherCosts: 100.3,
        totalCosts: 324.8,
        latestOdometer: 42.0,
        fuelRecords: 8,
        expenseRecords: 3
    });
    expect(petrol).toMatchObject({
        quantity: 95.0,
        totalPrice: 190.0,
        averageUnitPrice: 2.0,
        consumptionPer100Km: 7.0,
        consumptionDistance: 1000.0,
        consumptionQuantity: 70.0,
        validIntervals: 2,
        missingRecords: 1
    });
    expect(result.fuels.find((fuel) => fuel.fuelType === FuelType.CNG)).toMatchObject({ unit: 'kg' });
    expect(result.fuels.find((fuel) => fuel.fuelType === FuelType.CNG)?.consumptionPer100Km).toBeCloseTo(3.3333333333333335, 12);
    expect(result.fuels.find((fuel) => fuel.fuelType === FuelType.ELECTRIC)).toMatchObject({
        unit: 'kWh',
        quantity: 25.0,
        totalPrice: 7.5,
        consumptionPer100Km: null,
        validIntervals: 0
    });
    expect(result.costs).toEqual([{ day: '2026-02-01', fuel: 224.5, other: 100.3, total: 324.8 }]);
    expect(result.fuelPoints.find((point) => point.fuelType === FuelType.PETROL && point.day === '2026-02-02')).toMatchObject({
        consumptionPer100Km: 10.0
    });
    expect(
        result.fuelPoints.find((point) => point.fuelType === FuelType.PETROL && point.day === '2026-02-08')?.consumptionPer100Km
    ).toBeNull();
});

test('same-day unit prices are volume weighted, and incomplete history has unavailable consumption', async () => {
    await fuel('2026-02-01', 1000, 1, 1);
    const second = await createOwnedFuelRecord(
        owner.token,
        {
            vehicleId,
            fuelType: FuelType.PETROL,
            occurredAt: '2026-02-01T15:00:00Z',
            odometer: 1100,
            quantity: 3,
            price: { type: FuelPriceInput.TOTAL, totalPrice: 9 },
            isFull: false
        },
        database
    );

    expect(second.result.kind).toBe(ResultKind.CREATED);
    const result = await report();

    expect(result.fuels.find((fuel) => fuel.fuelType === FuelType.PETROL)).toMatchObject({
        averageUnitPrice: 2.5,
        consumptionPer100Km: null,
        validIntervals: 0
    });
    expect(result.fuelPoints.find((point) => point.fuelType === FuelType.PETROL && point.day === '2026-02-01')).toMatchObject({
        unitPrice: 2.5,
        consumptionPer100Km: null
    });
});

test('custom local-day boundaries include the whole DST day and exclude both neighbours', async () => {
    await database.expense.createMany({
        data: [
            ['2026-03-28T22:59:59.999Z', 100],
            ['2026-03-28T23:00:00.000Z', 0.1],
            ['2026-03-29T21:59:59.999Z', 0.2],
            ['2026-03-29T22:00:00.000Z', 200]
        ].map(([date, totalPrice]) => ({ userId: owner.id, vehicleId, categoryId, totalPrice, odometer: 0, occurredAt: new Date(date) }))
    });
    const result = await getOwnedStatistics(
        owner.token,
        { vehicleId, period: StatisticsPeriod.CUSTOM, from: '2026-03-29', to: '2026-03-29' },
        database
    );

    expect(result.result).toMatchObject({
        kind: ResultKind.STATISTICS,
        statistics: { otherCosts: 0.3, expenseRecords: 2, costs: [{ day: '2026-03-01', other: 0.3 }] }
    });
});

test('archived category totals retain current names; charts combine only the tail and preserve exact totals', async () => {
    const categories = await Promise.all(
        Array.from({ length: 12 }, (_, index) => database.expenseCategory.create({ data: { userId: owner.id, name: `Category ${index}` } }))
    );

    await database.expense.createMany({
        data: categories.map((category) => ({
            userId: owner.id,
            vehicleId,
            categoryId: category.id,
            totalPrice: 0.1,
            odometer: 0,
            occurredAt: new Date('2026-02-01T12:00:00Z')
        }))
    });
    await database.expenseCategory.update({ where: { id: categories[0].id }, data: { name: 'Corrected category', isArchived: true } });
    const result = await report();

    expect(result.categories).toHaveLength(12);
    expect(result.categories.find((item) => item.id === categories[0].id)).toMatchObject({ name: 'Corrected category', isArchived: true });
    expect(result.categoryChart).toHaveLength(11);
    expect(result.categoryChart.at(-1)).toEqual({ id: null, name: null, totalPrice: 0.2 });
    expect(result.otherCosts).toBe(1.2);
});

test('long histories stay bounded and zero-fill costs while leaving absent fuel prices as gaps', async () => {
    await database.expense.createMany({
        data: ['0001-01-01T12:00:00Z', '9999-12-31T12:00:00Z'].map((day) => ({
            userId: owner.id,
            vehicleId,
            categoryId,
            totalPrice: 0.1,
            odometer: 0,
            occurredAt: new Date(day)
        }))
    });
    const result = await getOwnedStatistics(owner.token, { vehicleId }, database);

    if (result.result.kind !== ResultKind.STATISTICS) throw new Error('Expected report.');

    expect(result.result.statistics.otherCosts).toBe(0.2);
    expect(result.result.statistics.costs).toHaveLength(statisticsPointLimit);
    expect(result.result.statistics.costs[1]).toMatchObject({ fuel: 0.0, other: 0.0 });
    expect(result.result.statistics.fuelPoints.length).toBeLessThanOrEqual(statisticsPointLimit * 3);
    expect(result.result.statistics.fuelPoints.every((point) => point.unitPrice === null && point.consumptionPer100Km === null)).toBe(true);
});

test('empty reports distinguish absent odometer and consumption from real zero costs', async () => {
    const result = await report();

    expect(result).toMatchObject({
        latestOdometer: null,
        fuelCosts: 0.0,
        otherCosts: 0.0,
        totalCosts: 0.0,
        fuelRecords: 0,
        expenseRecords: 0,
        categories: []
    });
    expect(result.fuels.every((fuel) => fuel.consumptionPer100Km === null)).toBe(true);
});

test('vehicle ownership, invalid/blocked sessions and administrator isolation apply to statistics', async () => {
    expect((await getOwnedStatistics(stranger.token, { vehicleId }, database)).result).toMatchObject({
        code: StatisticsErrorCode.VEHICLE_NOT_FOUND
    });
    expect((await getOwnedStatistics(owner.token, { vehicleId: randomUUID() }, database)).result).toMatchObject({
        code: StatisticsErrorCode.VEHICLE_NOT_FOUND
    });
    expect((await getOwnedStatistics(undefined, { vehicleId }, database)).result).toMatchObject({ code: AuthErrorCode.AUTH_REQUIRED });
    await database.user.update({ where: { id: owner.id }, data: { status: UserStatus.BLOCKED } });
    expect((await getOwnedStatistics(owner.token, { vehicleId }, database)).result).toMatchObject({ code: AuthErrorCode.AUTH_REQUIRED });
});

test('a selected consumption interval includes partial fuel bought before the range, without counting its cost in-range', async () => {
    await fuel('2026-01-29', 1000, 20, 30);
    await fuel('2026-01-31', 1100, 10, 20, FuelType.PETROL, false);
    await fuel('2026-02-02', 1400, 30, 60);

    const result = await report();

    expect(result.fuelCosts).toBe(60.0);
    expect(result.fuels.find((fuel) => fuel.fuelType === FuelType.PETROL)).toMatchObject({
        quantity: 30.0,
        consumptionQuantity: 40.0,
        consumptionDistance: 400.0,
        consumptionPer100Km: 10.0
    });
});

test('summary and chart ratios remain numeric and unrounded until display', async () => {
    await fuel('2026-02-01', 1000, 100000, 123499.96);
    const result = await report();

    expect(result.fuels.find((fuel) => fuel.fuelType === FuelType.PETROL)?.averageUnitPrice).toBe(1.2349996);
    expect(result.fuelPoints[0].unitPrice).toBe(1.2349996);
});

test('a paused report allows saves and retains one consistent snapshot', async () => {
    const expense = { vehicleId, categoryId, totalPrice: 10, odometer: 1000, occurredAt: '2026-02-01T12:00:00Z' };
    await createOwnedExpense(owner.token, expense, database);
    let pendingReport!: ReturnType<typeof getOwnedStatistics>;

    // Pause the report's first fuel query after its authorization snapshot exists.
    await database.$transaction(async (blocker) => {
        await blocker.$executeRaw`LOCK TABLE "FuelRecord" IN ACCESS EXCLUSIVE MODE`;
        pendingReport = getOwnedStatistics(owner.token, { vehicleId, ...february }, database);

        await vi.waitFor(async () => {
            const [state] = await database.$queryRaw<Array<{ waiting: boolean }>>`
                SELECT EXISTS (
                    SELECT 1 FROM pg_stat_activity
                    WHERE datname = current_database() AND pid <> pg_backend_pid()
                        AND wait_event_type = 'Lock' AND query LIKE '%FROM "FuelRecord"%'
                ) AS waiting
            `;
            expect(state.waiting).toBe(true);
        });

        const saved = await createOwnedExpense(owner.token, { ...expense, totalPrice: 20 }, database);
        expect(saved.result.kind).toBe(ResultKind.CREATED);
    });

    const snapshot = await pendingReport;
    if (snapshot.result.kind !== ResultKind.STATISTICS) throw new Error('Expected statistics.');

    expect(snapshot.result.statistics).toMatchObject({ otherCosts: 10, expenseRecords: 1 });
    expect(snapshot.result.statistics.categories[0]).toMatchObject({ totalPrice: 10, records: 1 });
    expect(snapshot.result.statistics.costs[0].other).toBe(10);
    expect(await report()).toMatchObject({ otherCosts: 30, expenseRecords: 2 });
});

test.each([true, false])('report rechecks session revocation after renewal (blocked=%s)', async (blocked) => {
    const validate = sessions.validateSession;
    vi.spyOn(sessions, 'validateSession').mockImplementationOnce(async (...args) => {
        const session = await validate(...args);

        if (blocked) await database.user.update({ where: { id: owner.id }, data: { status: UserStatus.BLOCKED } });
        else await sessions.revokeSession(owner.token, database);

        return session;
    });

    expect(await getOwnedStatistics(owner.token, { vehicleId }, database)).toMatchObject({
        result: { code: AuthErrorCode.AUTH_REQUIRED },
        clearSession: true
    });
});

test('map locations follow the vehicle, date range and ownership and exclude records without GPS', async () => {
    const other = await database.vehicle.create({
        data: { userId: owner.id, manufacturer: 'Synthetic', model: 'Other places', fuelTypes: [FuelType.PETROL] }
    });
    const foreign = await database.vehicle.create({
        data: { userId: stranger.id, manufacturer: 'Synthetic', model: 'Private places', fuelTypes: [FuelType.PETROL] }
    });
    const location = { latitude: 51.505, longitude: -0.09, locationAccuracy: 12, locationCapturedAt: new Date('2026-01-01T12:00:00Z') };
    await database.fuelRecord.createMany({
        data: [
            { vehicleId, occurredAt: new Date('2026-01-01T12:00:00Z'), odometer: 1000, ...location },
            { vehicleId, occurredAt: new Date('2026-02-01T12:00:00Z'), odometer: 1500, ...location },
            { vehicleId, occurredAt: new Date('2026-02-02T12:00:00Z'), odometer: 2000 },
            { vehicleId: other.id, occurredAt: new Date('2026-02-01T12:00:00Z'), odometer: 1000, ...location },
            { vehicleId: foreign.id, occurredAt: new Date('2026-02-01T12:00:00Z'), odometer: 1000, ...location }
        ].map((record) => ({ ...record, fuelType: FuelType.PETROL, quantity: 30, totalPrice: 45, unitPrice: 1.5, isFull: true }))
    });
    const filtered = await report();
    expect(filtered.fuelPlaces).toHaveLength(1);
    expect(filtered.fuelPlaces[0]).toMatchObject({
        latitude: 51.505,
        longitude: -0.09,
        occurredAt: '2026-02-01T12:00:00.000Z',
        quantity: 30,
        totalPrice: 45
    });
    const all = await getOwnedStatistics(owner.token, { vehicleId, period: StatisticsPeriod.ALL }, database);
    if (all.result.kind !== ResultKind.STATISTICS) throw new Error('Expected own statistics.');
    expect(all.result.statistics.fuelPlaces).toHaveLength(2);
    expect((await getOwnedStatistics(owner.token, { vehicleId: foreign.id, period: StatisticsPeriod.ALL }, database)).result).toMatchObject(
        { kind: ResultKind.ERROR, code: StatisticsErrorCode.VEHICLE_NOT_FOUND }
    );
});
