import type { z } from 'zod';
import { db } from '../db.server';
import { type Prisma, type PrismaClient, type FuelRecord } from '../generated/prisma/client';
import { FuelType } from '../generated/prisma/enums';
import { validateSessionInTransaction } from '../auth/session.server';
import { AuthErrorCode } from '../auth/auth-errors';
import { ResultKind } from '../common/result-kind';
import { FuelErrorCode } from './fuel-errors';
import { fuelCurrency, fuelUnits } from './fuel-values';
import { fuelRecordSchema, updateFuelRecordSchema, fuelRecordIdSchema, deleteFuelRecordSchema, fuelRecordListSchema } from './fuel-schema';
import { calculateFuelPrice, calculateFuelConsumption } from './fuel-calculations';
import type { FuelRecordData, FuelOutcome, FuelReadResult, FuelListResult, FuelSaveResult, FuelDeleteResult } from './fuel.types';

function recordData(record: FuelRecord): FuelRecordData {
    return {
        id: record.id,
        location:
            record.latitude !== null && record.longitude !== null && record.locationAccuracy !== null && record.locationCapturedAt !== null
                ? {
                      manuallyAdjusted: record.locationManuallyAdjusted,
                      latitude: record.latitude,
                      longitude: record.longitude,
                      accuracy: record.locationAccuracy,
                      capturedAt: record.locationCapturedAt.toISOString()
                  }
                : null,
        vehicleId: record.vehicleId,
        fuelType: record.fuelType,
        occurredAt: record.occurredAt.toISOString(),
        odometer: record.odometer.toNumber(),
        quantity: record.quantity.toNumber(),
        quantityUnit: fuelUnits[record.fuelType],
        totalPrice: record.totalPrice.toNumber(),
        unitPrice: record.unitPrice.toNumber(),
        currency: fuelCurrency,
        isFull: record.isFull,
        previousRecordMissing: record.previousRecordMissing,
        consumptionPer100Km: record.consumptionPer100Km?.toNumber() ?? null,
        consumptionDistance: record.consumptionDistance?.toNumber() ?? null,
        consumptionQuantity: record.consumptionQuantity?.toNumber() ?? null,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString()
    };
}

async function recalculateTimeline(tx: Prisma.TransactionClient, vehicleId: string, fuelType: FuelType, occurredAt: Date): Promise<void> {
    if (fuelType === FuelType.ELECTRIC) return;

    const before = await tx.fuelRecord.findFirst({
        where: { vehicleId, fuelType, isFull: true, occurredAt: { lt: occurredAt } },
        orderBy: { occurredAt: 'desc' },
        select: { id: true, occurredAt: true }
    });
    const after = await tx.fuelRecord.findFirst({
        where: { vehicleId, fuelType, isFull: true, occurredAt: { gt: occurredAt } },
        orderBy: { occurredAt: 'asc' },
        select: { occurredAt: true }
    });
    const records = await tx.fuelRecord.findMany({
        where: {
            vehicleId,
            fuelType,
            occurredAt: { ...(before ? { gte: before.occurredAt } : {}), ...(after ? { lte: after.occurredAt } : {}) }
        },
        orderBy: { occurredAt: 'asc' },
        select: {
            id: true,
            quantity: true,
            odometer: true,
            isFull: true,
            previousRecordMissing: true,
            consumptionPer100Km: true,
            consumptionDistance: true,
            consumptionQuantity: true
        }
    });
    const calculated = calculateFuelConsumption(
        records.map((record) => ({ ...record, quantity: record.quantity.toNumber(), odometer: record.odometer.toNumber() })),
        fuelType
    );

    for (const record of records) {
        // This full fill seeds the calculation; its own interval starts outside the window.
        if (record.id === before?.id) continue;

        const consumption = calculated.get(record.id)!;

        if (
            (record.consumptionPer100Km?.toNumber() ?? null) === consumption.consumptionPer100Km &&
            (record.consumptionDistance?.toNumber() ?? null) === consumption.consumptionDistance &&
            (record.consumptionQuantity?.toNumber() ?? null) === consumption.consumptionQuantity
        )
            continue;

        await tx.fuelRecord.update({ where: { id: record.id }, data: consumption });
    }
}

async function saveFuelRecord(
    token: string | undefined,
    input: z.output<typeof fuelRecordSchema> | Omit<z.output<typeof updateFuelRecordSchema>, 'recordId'>,
    recordId: string | undefined,
    database: PrismaClient
): Promise<FuelOutcome<FuelSaveResult>> {
    return database.$transaction(async (tx) => {
        // Session validation locks the owner row. All account/vehicle/fuel mutations share this lock.
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const expiresAt = session.expiresAt;
        const previousRecord = recordId
            ? await tx.fuelRecord.findFirst({ where: { id: recordId, vehicle: { userId: session.user.id } } })
            : null;

        if (recordId && !previousRecord) return { result: { kind: ResultKind.ERROR, code: FuelErrorCode.NOT_FOUND }, expiresAt };

        const vehicle = await tx.vehicle.findFirst({ where: { id: input.vehicleId, userId: session.user.id } });

        if (!vehicle) return { result: { kind: ResultKind.ERROR, code: FuelErrorCode.VEHICLE_NOT_FOUND }, expiresAt };
        if (!vehicle.fuelTypes.includes(input.fuelType))
            return { result: { kind: ResultKind.ERROR, code: FuelErrorCode.TYPE_UNSUPPORTED }, expiresAt };

        const occurredAt = new Date(input.occurredAt);
        const where = { vehicleId: input.vehicleId, fuelType: input.fuelType, ...(recordId ? { id: { not: recordId } } : {}) };
        const duplicate = await tx.fuelRecord.findFirst({ where: { ...where, occurredAt } });

        if (duplicate) return { result: { kind: ResultKind.ERROR, code: FuelErrorCode.TIMESTAMP_CONFLICT }, expiresAt };

        const before = await tx.fuelRecord.findFirst({
            where: { ...where, occurredAt: { lt: occurredAt } },
            orderBy: { occurredAt: 'desc' }
        });
        const after = await tx.fuelRecord.findFirst({
            where: { ...where, occurredAt: { gt: occurredAt } },
            orderBy: { occurredAt: 'asc' }
        });
        const odometer = input.odometer;

        if ((before && odometer <= before.odometer.toNumber()) || (after && odometer >= after.odometer.toNumber())) {
            return { result: { kind: ResultKind.ERROR, code: FuelErrorCode.ODOMETER_ORDER }, expiresAt };
        }

        const price = calculateFuelPrice(input);

        if (!price) return { result: { kind: ResultKind.ERROR, code: FuelErrorCode.PRICE_RANGE }, expiresAt };

        const suppliedLocation = input.location;
        if (recordId && suppliedLocation && previousRecord?.latitude === null) {
            return { result: { kind: ResultKind.ERROR, code: FuelErrorCode.INVALID }, expiresAt };
        }
        const location =
            !recordId && session.user.storeFuelLocation && suppliedLocation && 'accuracy' in suppliedLocation
                ? suppliedLocation
                : undefined;
        const data = {
            ...(location
                ? {
                      locationManuallyAdjusted: location.manuallyAdjusted ?? false,
                      latitude: location.latitude,
                      longitude: location.longitude,
                      locationAccuracy: location.accuracy,
                      locationCapturedAt: new Date(location.capturedAt)
                  }
                : {}),
            ...(recordId && suppliedLocation && previousRecord
                ? {
                      latitude: suppliedLocation.latitude,
                      longitude: suppliedLocation.longitude,
                      locationManuallyAdjusted: true
                  }
                : {}),
            vehicleId: input.vehicleId,
            fuelType: input.fuelType,
            occurredAt,
            odometer,
            quantity: input.quantity,
            ...price,
            isFull: input.isFull,
            previousRecordMissing: input.previousRecordMissing,
            ...(!input.isFull || input.fuelType === FuelType.ELECTRIC
                ? { consumptionPer100Km: null, consumptionDistance: null, consumptionQuantity: null }
                : {})
        };
        const record = recordId ? await tx.fuelRecord.update({ where: { id: recordId }, data }) : await tx.fuelRecord.create({ data });

        if (
            previousRecord &&
            (previousRecord.vehicleId !== input.vehicleId ||
                previousRecord.fuelType !== input.fuelType ||
                previousRecord.occurredAt.getTime() !== occurredAt.getTime())
        ) {
            await recalculateTimeline(tx, previousRecord.vehicleId, previousRecord.fuelType, previousRecord.occurredAt);
        }

        await recalculateTimeline(tx, input.vehicleId, input.fuelType, occurredAt);

        const saved = await tx.fuelRecord.findUniqueOrThrow({ where: { id: record.id } });

        return { result: { kind: recordId ? ResultKind.UPDATED : ResultKind.CREATED, record: recordData(saved) }, expiresAt };
    });
}

export async function createOwnedFuelRecord(
    token: string | undefined,
    input: z.input<typeof fuelRecordSchema>,
    database: PrismaClient = db
): Promise<FuelOutcome<FuelSaveResult>> {
    return saveFuelRecord(token, fuelRecordSchema.parse(input), undefined, database);
}

export async function updateOwnedFuelRecord(
    token: string | undefined,
    input: z.input<typeof updateFuelRecordSchema>,
    database: PrismaClient = db
): Promise<FuelOutcome<FuelSaveResult>> {
    const { recordId, ...data } = updateFuelRecordSchema.parse(input);

    return saveFuelRecord(token, data, recordId, database);
}

export async function getOwnedFuelRecord(
    token: string | undefined,
    input: z.input<typeof fuelRecordIdSchema>,
    database: PrismaClient = db
): Promise<FuelOutcome<FuelReadResult>> {
    const { recordId } = fuelRecordIdSchema.parse(input);

    return database.$transaction(async (tx) => {
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const record = await tx.fuelRecord.findFirst({ where: { id: recordId, vehicle: { userId: session.user.id } } });

        return {
            result: record
                ? { kind: ResultKind.FUEL_RECORD, record: recordData(record) }
                : { kind: ResultKind.ERROR, code: FuelErrorCode.NOT_FOUND },
            expiresAt: session.expiresAt
        };
    });
}

export async function listOwnedFuelRecords(
    token: string | undefined,
    input: z.input<typeof fuelRecordListSchema>,
    database: PrismaClient = db
): Promise<FuelOutcome<FuelListResult>> {
    const { vehicleId, fuelType, page, pageSize } = fuelRecordListSchema.parse(input);

    return database.$transaction(async (tx) => {
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, userId: session.user.id } });

        if (!vehicle) return { result: { kind: ResultKind.ERROR, code: FuelErrorCode.VEHICLE_NOT_FOUND }, expiresAt: session.expiresAt };

        const where = { vehicleId, ...(fuelType ? { fuelType } : {}) };
        const records = await tx.fuelRecord.findMany({
            where,
            skip: page * pageSize,
            take: pageSize,
            orderBy: [{ occurredAt: 'desc' }, { fuelType: 'asc' }, { id: 'desc' }]
        });
        const total = await tx.fuelRecord.count({ where });

        return {
            result: { kind: ResultKind.FUEL_RECORDS, records: records.map(recordData), total, page, pageSize },
            expiresAt: session.expiresAt
        };
    });
}

export async function deleteOwnedFuelRecord(
    token: string | undefined,
    input: z.input<typeof deleteFuelRecordSchema>,
    database: PrismaClient = db
): Promise<FuelOutcome<FuelDeleteResult>> {
    const { recordId } = deleteFuelRecordSchema.parse(input);

    return database.$transaction(async (tx) => {
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const record = await tx.fuelRecord.findFirst({ where: { id: recordId, vehicle: { userId: session.user.id } } });

        if (!record) return { result: { kind: ResultKind.ERROR, code: FuelErrorCode.NOT_FOUND }, expiresAt: session.expiresAt };

        await tx.fuelRecord.delete({ where: { id: recordId } });
        await recalculateTimeline(tx, record.vehicleId, record.fuelType, record.occurredAt);

        return { result: { kind: ResultKind.DELETED, recordId }, expiresAt: session.expiresAt };
    });
}
