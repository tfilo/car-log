import { LogOperation } from '../log-operations.server';
import { logServerError } from '../logging.server';
import { db } from '../db.server';
import type { PrismaClient } from '../generated/prisma/client';
import type { VehicleOutcome, VehicleResult, VehicleSaveResult } from './vehicle.types';
import { getOwnedVehicle, vehicleData } from './vehicles.server';
import { validateSessionInTransaction } from '../auth/session.server';
import { AuthErrorCode } from '../auth/auth-errors';
import { ResultKind } from '../common/result-kind';
import { VehicleErrorCode } from './vehicle-errors';
import { stagePicture, readPicture, pictureDirectory } from './picture-storage.server';
import { processPicture, InvalidPictureError } from './picture-image.server';
import { pictureMaxBytes } from './picture-policy';

type PictureAccess = VehicleOutcome<VehicleResult> | { key: string; expiresAt: Date };

export async function saveVehiclePicture(
    token: string | undefined,
    vehicleId: string,
    bytes: Buffer,
    database: PrismaClient = db,
    directory = pictureDirectory()
): Promise<VehicleOutcome<VehicleSaveResult>> {
    const access = await getOwnedVehicle(token, { vehicleId }, database);

    if (access.result.kind === ResultKind.ERROR) return { ...access, result: access.result };
    if (bytes.length > pictureMaxBytes)
        return { result: { kind: ResultKind.ERROR, code: VehicleErrorCode.PICTURE_TOO_LARGE }, expiresAt: access.expiresAt };

    let image: Buffer;

    try {
        image = await processPicture(bytes);
    } catch (error) {
        if (error instanceof InvalidPictureError)
            return { result: { kind: ResultKind.ERROR, code: VehicleErrorCode.PICTURE_INVALID }, expiresAt: access.expiresAt };

        throw error;
    }

    // The storage directory uses the current owner, never a client-provided path.
    const owner = await database.vehicle.findUnique({ where: { id: vehicleId }, select: { userId: true } });

    if (!owner) return { result: { kind: ResultKind.ERROR, code: VehicleErrorCode.NOT_FOUND }, expiresAt: access.expiresAt };

    const picture = await stagePicture(owner.userId, image, database, directory);
    let attached = false;

    try {
        const outcome: VehicleOutcome<VehicleSaveResult> = await database.$transaction(async (tx) => {
            const session = token ? await validateSessionInTransaction(token, tx) : null;

            if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

            const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, userId: session.user.id } });

            if (!vehicle) return { result: { kind: ResultKind.ERROR, code: VehicleErrorCode.NOT_FOUND }, expiresAt: session.expiresAt };

            await tx.pictureFile.update({ where: { id: picture.id }, data: { deleteAfter: null } });

            const updated = await tx.vehicle.update({ where: { id: vehicleId }, data: { pictureId: picture.id } });

            return { result: { kind: ResultKind.UPDATED, vehicle: vehicleData(updated) }, expiresAt: session.expiresAt };
        });

        attached = outcome.result.kind === ResultKind.UPDATED;

        return outcome;
    } finally {
        if (!attached) await database.pictureFile.updateMany({ where: { id: picture.id }, data: { deleteAfter: new Date() } });
    }
}

export async function removeVehiclePicture(
    token: string | undefined,
    vehicleId: string,
    database: PrismaClient = db
): Promise<VehicleOutcome<VehicleSaveResult>> {
    return database.$transaction(async (tx) => {
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, userId: session.user.id } });

        if (!vehicle) return { result: { kind: ResultKind.ERROR, code: VehicleErrorCode.NOT_FOUND }, expiresAt: session.expiresAt };

        const updated = await tx.vehicle.update({ where: { id: vehicleId }, data: { pictureId: null } });

        return { result: { kind: ResultKind.UPDATED, vehicle: vehicleData(updated) }, expiresAt: session.expiresAt };
    });
}

export async function getVehiclePicture(
    token: string | undefined,
    vehicleId: string,
    database: PrismaClient = db,
    directory = pictureDirectory()
): Promise<VehicleOutcome<VehicleResult> | { bytes: Buffer; expiresAt: Date }> {
    const access = await database.$transaction(async (tx): Promise<PictureAccess> => {
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, userId: session.user.id }, include: { picture: true } });

        if (!vehicle?.picture)
            return { result: { kind: ResultKind.ERROR, code: VehicleErrorCode.NOT_FOUND }, expiresAt: session.expiresAt };

        return { key: vehicle.picture.key, expiresAt: session.expiresAt };
    });

    if ('result' in access) return access;

    // Filesystem I/O must not hold the account lock or a database connection.
    try {
        return { bytes: await readPicture(access.key, directory), expiresAt: access.expiresAt };
    } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
            logServerError(LogOperation.READ_VEHICLE_PICTURE, error);

        return { result: { kind: ResultKind.ERROR, code: VehicleErrorCode.NOT_FOUND }, expiresAt: access.expiresAt };
    }
}
