import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import type { z } from 'zod';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { FuelType, UserRole, UserStatus } from '../src/generated/prisma/enums';
import { db } from '../src/db.server';
import { createSession } from '../src/auth/session.server';
import { deleteOwnUserAccount } from '../src/users/users.server';
import { AuthErrorCode } from '../src/auth/auth-errors';
import { ResultKind } from '../src/common/result-kind';
import { FuelErrorCode } from '../src/fuel/fuel-errors';
import { FuelPriceInput } from '../src/fuel/fuel-values';
import { fuelRecordSchema } from '../src/fuel/fuel-schema';
import {
    createOwnedFuelRecord,
    updateOwnedFuelRecord,
    getOwnedFuelRecord,
    listOwnedFuelRecords,
    deleteOwnedFuelRecord
} from '../src/fuel/fuel.server';
import { updateOwnedVehicle, deleteOwnedVehicle } from '../src/vehicles/vehicles.server';
import { VehicleErrorCode } from '../src/vehicles/vehicle-errors';

const databaseName = `car_log_fuel_${randomUUID().replaceAll('-', '')}`;
let database: PrismaClient;
let created = false;
let owner: { id: string; username: string; token: string };
let stranger: { id: string; username: string; token: string };
let vehicleId: string;

async function account(role: UserRole = UserRole.USER) {
    const username = `fuel${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const passwordHash = 'synthetic-not-used-for-login';
    const user = await database.user.create({
        data: { username, email: `${username}@example.test`, passwordHash, status: UserStatus.ACTIVE, role }
    });
    const session = await createSession(user.id, passwordHash, undefined, database);

    if (!session) throw new Error('Expected active synthetic session.');

    return { id: user.id, username, token: session.token };
}

function input(day: number, odometer: number, overrides: Partial<z.input<typeof fuelRecordSchema>> = {}): z.input<typeof fuelRecordSchema> {
    return {
        vehicleId,
        fuelType: FuelType.PETROL,
        occurredAt: `2026-01-${String(day).padStart(2, '0')}T12:00:00Z`,
        odometer,
        quantity: 40,
        price: { type: FuelPriceInput.TOTAL, totalPrice: 60 },
        isFull: true,
        ...overrides
    };
}

async function create(day: number, odometer: number, overrides: Partial<z.input<typeof fuelRecordSchema>> = {}) {
    const outcome = await createOwnedFuelRecord(owner.token, input(day, odometer, overrides), database);

    if (outcome.result.kind !== ResultKind.CREATED) throw new Error('Expected created fuel record.');

    return outcome.result.record;
}

async function read(recordId: string) {
    const outcome = await getOwnedFuelRecord(owner.token, { recordId }, database);

    if (outcome.result.kind !== ResultKind.FUEL_RECORD) throw new Error('Expected owned fuel record.');

    return outcome.result.record;
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

    const vehicle = await database.vehicle.create({
        data: {
            userId: owner.id,
            manufacturer: 'Synthetic',
            model: 'Hybrid',
            fuelTypes: [FuelType.PETROL, FuelType.ELECTRIC, FuelType.CNG]
        }
    });

    vehicleId = vehicle.id;
});

afterAll(async () => {
    await database?.$disconnect();

    if (created) await db.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);

    await db.$disconnect();
});

test('fuel CRUD enforces ownership even for administrators, with numeric responses', async () => {
    const first = await create(1, 1000);
    const next = await create(2, 1500);

    expect(first.id[14]).toBe('7');
    expect(first.quantity).toBe(40.0);
    expect(first.totalPrice).toBe(60.0);
    expect(first.unitPrice).toBe(1.5);
    expect(first).not.toHaveProperty('userId');
    expect(next.consumptionPer100Km).toBe(8.0);
    expect((await getOwnedFuelRecord(undefined, { recordId: first.id }, database)).result).toMatchObject({
        code: AuthErrorCode.AUTH_REQUIRED
    });
    expect((await getOwnedFuelRecord(stranger.token, { recordId: first.id }, database)).result).toMatchObject({
        code: FuelErrorCode.NOT_FOUND
    });
    expect((await updateOwnedFuelRecord(stranger.token, { ...input(1, 1000), recordId: first.id }, database)).result).toMatchObject({
        code: FuelErrorCode.NOT_FOUND
    });
    expect((await deleteOwnedFuelRecord(stranger.token, { recordId: first.id, confirmed: true }, database)).result).toMatchObject({
        code: FuelErrorCode.NOT_FOUND
    });
    expect((await createOwnedFuelRecord(stranger.token, input(3, 2000), database)).result).toMatchObject({
        code: FuelErrorCode.VEHICLE_NOT_FOUND
    });
    expect((await listOwnedFuelRecords(stranger.token, { vehicleId }, database)).result).toMatchObject({
        code: FuelErrorCode.VEHICLE_NOT_FOUND
    });
});

test('different fuels share a timestamp and odometer but never share their histories', async () => {
    await create(1, 1000);
    await create(1, 1000, { fuelType: FuelType.ELECTRIC });
    await create(2, 1500, { fuelType: FuelType.ELECTRIC });

    const gas = await create(2, 1400);

    expect(gas.consumptionPer100Km).toBe(10.0);

    const list = await listOwnedFuelRecords(owner.token, { vehicleId, fuelType: FuelType.ELECTRIC, page: 0, pageSize: 1 }, database);

    expect(list.result).toMatchObject({ kind: ResultKind.FUEL_RECORDS, total: 2, page: 0, records: [{ consumptionPer100Km: null }] });
    expect((await listOwnedFuelRecords(owner.token, { vehicleId, page: 1, pageSize: 3 }, database)).result).toMatchObject({
        total: 4,
        page: 1
    });
    expect((await createOwnedFuelRecord(owner.token, input(1, 1100), database)).result).toMatchObject({
        code: FuelErrorCode.TIMESTAMP_CONFLICT
    });
    expect(
        (await createOwnedFuelRecord(owner.token, { ...input(1, 1100), occurredAt: '2026-01-01T13:00:00+01:00' }, database)).result
    ).toMatchObject({ code: FuelErrorCode.TIMESTAMP_CONFLICT });
});

test('insertion and editing require odometers strictly between chronological neighbours of the same fuel', async () => {
    await create(1, 1000);

    const end = await create(4, 2000);

    for (const odometer of [999, 1000, 2000, 2001]) {
        expect((await createOwnedFuelRecord(owner.token, input(2, odometer), database)).result).toMatchObject({
            code: FuelErrorCode.ODOMETER_ORDER
        });
    }

    expect((await updateOwnedFuelRecord(owner.token, { ...input(2, 1000), recordId: end.id }, database)).result).toMatchObject({
        code: FuelErrorCode.ODOMETER_ORDER
    });
    expect((await read(end.id)).odometer).toBe(2000.0);
    expect(await database.fuelRecord.count()).toBe(2);
});

test('backdated partial fills affect the next full record; edits/deletion refresh only changed caches', async () => {
    await create(1, 1000);

    const end = await create(4, 1500);
    const later = await create(5, 2000);
    const original = await database.fuelRecord.findUniqueOrThrow({ where: { id: later.id } });
    const partial = await create(2, 1200, { quantity: 10, isFull: false });

    expect((await read(end.id)).consumptionPer100Km).toBe(10.0);
    expect((await read(later.id)).consumptionPer100Km).toBe(8.0);
    expect((await database.fuelRecord.findUniqueOrThrow({ where: { id: later.id } })).updatedAt).toEqual(original.updatedAt);
    await updateOwnedFuelRecord(owner.token, { ...input(2, 1200, { quantity: 20, isFull: false }), recordId: partial.id }, database);
    expect((await read(end.id)).consumptionPer100Km).toBe(12.0);
    await deleteOwnedFuelRecord(owner.token, { recordId: partial.id, confirmed: true }, database);
    expect((await read(end.id)).consumptionPer100Km).toBe(8.0);
});

test('moving a record recalculates both its old and new positions atomically', async () => {
    await create(1, 1000);

    const moved = await create(2, 1200, { quantity: 10, isFull: false });
    const firstEnd = await create(3, 1500);
    const secondEnd = await create(5, 2000);

    await updateOwnedFuelRecord(owner.token, { ...input(4, 1700, { quantity: 10, isFull: false }), recordId: moved.id }, database);
    expect((await read(firstEnd.id)).consumptionPer100Km).toBe(8.0);
    expect((await read(secondEnd.id)).consumptionPer100Km).toBe(10.0);
});

test('editing full and missing-history flags invalidates affected intervals and restores them on correction', async () => {
    await create(1, 1000);

    const partial = await create(2, 1200, { quantity: 10, isFull: false });
    const end = await create(3, 1500);
    const later = await create(4, 2000);

    await updateOwnedFuelRecord(
        owner.token,
        { ...input(2, 1200, { quantity: 10, isFull: false, previousRecordMissing: true }), recordId: partial.id },
        database
    );
    expect((await read(end.id)).consumptionPer100Km).toBeNull();
    expect((await read(later.id)).consumptionPer100Km).toBe(8.0);
    await updateOwnedFuelRecord(owner.token, { ...input(2, 1200, { quantity: 10, isFull: true }), recordId: partial.id }, database);
    expect((await read(partial.id)).consumptionPer100Km).toBe(5.0);
    expect((await read(end.id)).consumptionPer100Km).toBe(13.333333);
    await updateOwnedFuelRecord(owner.token, { ...input(2, 1200, { quantity: 10, isFull: false }), recordId: partial.id }, database);
    expect((await read(partial.id)).consumptionPer100Km).toBeNull();
    expect((await read(end.id)).consumptionPer100Km).toBe(10.0);
    await updateOwnedFuelRecord(owner.token, { ...input(3, 1500, { fuelType: FuelType.ELECTRIC }), recordId: end.id }, database);
    expect((await read(end.id)).consumptionPer100Km).toBeNull();
    expect((await read(later.id)).consumptionPer100Km).toBe(5.0);
});

test('changing vehicle or fuel refreshes both timelines and cannot move to another owner', async () => {
    await create(1, 1000);

    const moved = await create(2, 1200, { quantity: 10, isFull: false });
    const end = await create(3, 1500);

    await updateOwnedFuelRecord(owner.token, { ...input(2, 1200, { fuelType: FuelType.ELECTRIC }), recordId: moved.id }, database);
    expect((await read(end.id)).consumptionPer100Km).toBe(8.0);
    expect((await read(moved.id)).consumptionPer100Km).toBeNull();

    const other = await database.vehicle.create({
        data: { userId: owner.id, manufacturer: 'Synthetic', model: 'Second', fuelTypes: [FuelType.PETROL] }
    });

    await updateOwnedFuelRecord(owner.token, { ...input(2, 1200, { vehicleId: other.id }), recordId: moved.id }, database);
    expect((await read(moved.id)).vehicleId).toBe(other.id);
    expect((await read(moved.id)).consumptionPer100Km).toBeNull();
    await database.vehicle.update({ where: { id: other.id }, data: { userId: stranger.id } });
    expect(
        (await updateOwnedFuelRecord(owner.token, { ...input(2, 1200, { vehicleId: other.id }), recordId: end.id }, database)).result
    ).toMatchObject({ code: FuelErrorCode.VEHICLE_NOT_FOUND });
    expect((await read(end.id)).vehicleId).toBe(vehicleId);
});

test('unsupported fuels and oversized calculated totals cannot write records', async () => {
    expect((await createOwnedFuelRecord(owner.token, input(1, 1000, { fuelType: FuelType.DIESEL }), database)).result).toMatchObject({
        code: FuelErrorCode.TYPE_UNSUPPORTED
    });
    expect(
        (
            await createOwnedFuelRecord(
                owner.token,
                input(1, 1000, { quantity: 999999.999, price: { type: FuelPriceInput.UNIT, unitPrice: 999999.999999 } }),
                database
            )
        ).result
    ).toMatchObject({ code: FuelErrorCode.PRICE_RANGE });
    expect(await database.fuelRecord.count()).toBe(0);
});

test('concurrent inserts cannot create duplicate timestamps or violate odometer ordering', async () => {
    await create(1, 1000);

    const secondSession = await createSession(owner.id, 'synthetic-not-used-for-login', undefined, database);

    if (!secondSession) throw new Error('Expected second session.');

    const duplicate = await Promise.all(
        [owner.token, secondSession.token].map((token) => createOwnedFuelRecord(token, input(2, 1500), database))
    );

    expect(duplicate.filter((outcome) => outcome.result.kind === ResultKind.CREATED)).toHaveLength(1);
    expect(duplicate.find((outcome) => outcome.result.kind === ResultKind.ERROR)?.result).toMatchObject({
        code: FuelErrorCode.TIMESTAMP_CONFLICT
    });

    const crossed = await Promise.all([
        createOwnedFuelRecord(owner.token, input(3, 1700), database),
        createOwnedFuelRecord(secondSession.token, input(4, 1600), database)
    ]);

    expect(crossed.filter((outcome) => outcome.result.kind === ResultKind.CREATED)).toHaveLength(1);
    expect(crossed.find((outcome) => outcome.result.kind === ResultKind.ERROR)?.result).toMatchObject({
        code: FuelErrorCode.ODOMETER_ORDER
    });
});

test('vehicle fuel types remain available while records use them; vehicle/account deletion cascades', async () => {
    await create(1, 1000);

    const edit = { vehicleId, manufacturer: 'Synthetic', model: 'Hybrid', fuelTypes: [FuelType.ELECTRIC] };

    expect((await updateOwnedVehicle(owner.token, edit, database)).result).toMatchObject({ code: VehicleErrorCode.FUEL_IN_USE });
    await deleteOwnedVehicle(owner.token, { vehicleId, confirmed: true }, database);
    expect(await database.fuelRecord.count()).toBe(0);

    const vehicle = await database.vehicle.create({
        data: { userId: owner.id, manufacturer: 'Synthetic', model: 'Second', fuelTypes: [FuelType.CNG] }
    });

    await create(1, 1000, { vehicleId: vehicle.id, fuelType: FuelType.CNG });
    await deleteOwnUserAccount(owner.token, { confirmation: owner.username }, database);
    expect(await database.fuelRecord.count()).toBe(0);
});

test('stored decimal pricing rounds once; EV charging can be free', async () => {
    const fuel = await create(1, 1000, { quantity: 1.005, price: { type: FuelPriceInput.UNIT, unitPrice: 1 } });
    const charge = await create(1, 1000, { fuelType: FuelType.ELECTRIC, price: { type: FuelPriceInput.TOTAL, totalPrice: 0 } });

    expect(fuel.totalPrice).toBe(1.01);
    expect(fuel.unitPrice).toBe(1.004975);
    expect(charge.totalPrice).toBe(0.0);
    expect(charge.unitPrice).toBe(0.0);
    expect(charge.consumptionPer100Km).toBeNull();
});

test('odometer corrections and deleting the baseline recalculate adjoining full intervals', async () => {
    const first = await create(1, 1000);
    const middle = await create(2, 1500);
    const end = await create(3, 2000);

    await updateOwnedFuelRecord(owner.token, { ...input(2, 1600), recordId: middle.id }, database);
    expect((await read(middle.id)).consumptionPer100Km).toBe(6.666667);
    expect((await read(end.id)).consumptionPer100Km).toBe(10.0);
    await deleteOwnedFuelRecord(owner.token, { recordId: first.id, confirmed: true }, database);
    expect((await read(middle.id)).consumptionPer100Km).toBeNull();
    expect((await read(end.id)).consumptionPer100Km).toBe(10.0);
});

test('GPS storage honors the profile preference and remains private to the record owner', async () => {
    const location = { latitude: 51.505, longitude: -0.09, accuracy: 12, capturedAt: '2026-01-01T12:00:00.000Z' };
    const ignored = await create(1, 1000, { location });
    expect(ignored.location).toBeNull();
    await database.user.update({ where: { id: owner.id }, data: { storeFuelLocation: true } });
    const saved = await create(2, 1500, { location });
    expect(saved.location).toEqual({ ...location, manuallyAdjusted: false });
    expect((await getOwnedFuelRecord(stranger.token, { recordId: saved.id }, database)).result).toMatchObject({
        kind: ResultKind.ERROR,
        code: FuelErrorCode.NOT_FOUND
    });
    await database.user.update({ where: { id: owner.id }, data: { storeFuelLocation: false } });
    expect((await read(saved.id)).location).toEqual({ ...location, manuallyAdjusted: false });
    expect((await create(3, 2000, { location })).location).toBeNull();
});

test('manual corrections work with capture disabled and preserve the original GPS metadata', async () => {
    const location = { latitude: 51.505, longitude: -0.09, accuracy: 12, capturedAt: '2026-01-01T12:00:00.000Z' };
    await database.user.update({ where: { id: owner.id }, data: { storeFuelLocation: true } });
    const saved = await create(1, 1000, { location });
    await database.user.update({ where: { id: owner.id }, data: { storeFuelLocation: false } });
    const command = { ...input(1, 1000), recordId: saved.id, location: { latitude: 51.506, longitude: -0.08 } };
    const moved = await updateOwnedFuelRecord(owner.token, command, database);
    expect(moved.result.kind).toBe(ResultKind.UPDATED);
    expect((await read(saved.id)).location).toEqual({ ...location, ...command.location, manuallyAdjusted: true });
    expect((await updateOwnedFuelRecord(stranger.token, command, database)).result).toMatchObject({
        kind: ResultKind.ERROR,
        code: FuelErrorCode.NOT_FOUND
    });
    await updateOwnedFuelRecord(owner.token, { ...input(1, 1000), recordId: saved.id }, database);
    expect((await read(saved.id)).location?.manuallyAdjusted).toBe(true);
    const noLocation = await create(2, 1500);
    expect(
        (await updateOwnedFuelRecord(owner.token, { ...input(2, 1500), recordId: noLocation.id, location: command.location }, database))
            .result
    ).toMatchObject({ kind: ResultKind.ERROR, code: FuelErrorCode.INVALID });
});
