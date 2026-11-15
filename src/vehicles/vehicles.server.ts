import type { z } from 'zod';
import { db } from '../db.server';
import type { PrismaClient, Vehicle } from '../generated/prisma/client';
import { validateSessionInTransaction } from '../auth/session.server';
import { AuthErrorCode } from '../auth/auth-errors';
import { ResultKind } from '../common/result-kind';
import { VehicleErrorCode } from './vehicle-errors';
import { vehicleSchema, updateVehicleSchema, vehicleIdSchema, deleteVehicleSchema, vehicleListSchema } from './vehicle-schema';
import type {
    VehicleData,
    VehicleOutcome,
    VehicleResult,
    VehicleListResult,
    VehicleSaveResult,
    VehicleDeleteResult
} from './vehicle.types';

export function vehicleData(vehicle: Vehicle): VehicleData {
    return {
        id: vehicle.id,
        manufacturer: vehicle.manufacturer,
        model: vehicle.model,
        licensePlate: vehicle.licensePlate,
        vin: vehicle.vin,
        color: vehicle.color,
        registrationDate: vehicle.registrationDate?.toISOString().slice(0, 10) ?? null,
        fuelTypes: vehicle.fuelTypes,
        pictureUrl: vehicle.pictureId ? `/api/vehicle-pictures/${vehicle.id}?v=${vehicle.pictureId}` : null,
        createdAt: vehicle.createdAt.toISOString(),
        updatedAt: vehicle.updatedAt.toISOString()
    };
}

export async function listOwnedVehicles(
    token: string | undefined,
    input: z.input<typeof vehicleListSchema>,
    database: PrismaClient = db
): Promise<VehicleOutcome<VehicleListResult>> {
    const { page, pageSize } = vehicleListSchema.parse(input);

    return database.$transaction(async (tx) => {
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const where = { userId: session.user.id };
        const vehicles = await tx.vehicle.findMany({
            where,
            skip: page * pageSize,
            take: pageSize,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
        });
        const total = await tx.vehicle.count({ where });

        return {
            result: { kind: ResultKind.VEHICLES, vehicles: vehicles.map(vehicleData), page, pageSize, total },
            expiresAt: session.expiresAt
        };
    });
}

export async function getOwnedVehicle(
    token: string | undefined,
    input: z.input<typeof vehicleIdSchema>,
    database: PrismaClient = db
): Promise<VehicleOutcome<VehicleResult>> {
    const { vehicleId } = vehicleIdSchema.parse(input);

    return database.$transaction(async (tx) => {
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, userId: session.user.id } });

        return {
            result: vehicle
                ? { kind: ResultKind.VEHICLE, vehicle: vehicleData(vehicle) }
                : { kind: ResultKind.ERROR, code: VehicleErrorCode.NOT_FOUND },
            expiresAt: session.expiresAt
        };
    });
}

export async function createOwnedVehicle(
    token: string | undefined,
    input: z.input<typeof vehicleSchema>,
    database: PrismaClient = db
): Promise<VehicleOutcome<VehicleSaveResult>> {
    const data = vehicleSchema.parse(input);

    return database.$transaction(async (tx) => {
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const vehicle = await tx.vehicle.create({
            data: {
                ...data,
                userId: session.user.id,
                registrationDate: data.registrationDate ? new Date(`${data.registrationDate}T00:00:00Z`) : null
            }
        });

        return { result: { kind: ResultKind.CREATED, vehicle: vehicleData(vehicle) }, expiresAt: session.expiresAt };
    });
}

export async function updateOwnedVehicle(
    token: string | undefined,
    input: z.input<typeof updateVehicleSchema>,
    database: PrismaClient = db
): Promise<VehicleOutcome<VehicleSaveResult>> {
    const { vehicleId, ...data } = updateVehicleSchema.parse(input);

    return database.$transaction(async (tx) => {
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, userId: session.user.id } });

        if (!vehicle) return { result: { kind: ResultKind.ERROR, code: VehicleErrorCode.NOT_FOUND }, expiresAt: session.expiresAt };

        const removedFuel = await tx.fuelRecord.findFirst({
            where: { vehicleId, fuelType: { notIn: data.fuelTypes } },
            select: { id: true }
        });

        if (removedFuel) return { result: { kind: ResultKind.ERROR, code: VehicleErrorCode.FUEL_IN_USE }, expiresAt: session.expiresAt };

        const updated = await tx.vehicle.update({
            where: { id: vehicleId },
            data: { ...data, registrationDate: data.registrationDate ? new Date(`${data.registrationDate}T00:00:00Z`) : null }
        });

        return { result: { kind: ResultKind.UPDATED, vehicle: vehicleData(updated) }, expiresAt: session.expiresAt };
    });
}

export async function deleteOwnedVehicle(
    token: string | undefined,
    input: z.input<typeof deleteVehicleSchema>,
    database: PrismaClient = db
): Promise<VehicleOutcome<VehicleDeleteResult>> {
    const { vehicleId } = deleteVehicleSchema.parse(input);
    return database.$transaction(async (tx) => {
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const deleted = await tx.vehicle.deleteMany({ where: { id: vehicleId, userId: session.user.id } });

        return {
            result: deleted.count ? { kind: ResultKind.DELETED, vehicleId } : { kind: ResultKind.ERROR, code: VehicleErrorCode.NOT_FOUND },
            expiresAt: session.expiresAt
        };
    });
}
