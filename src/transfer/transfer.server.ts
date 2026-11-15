import { mkdir, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { strToU8 } from 'fflate';
import { setResponseHeader } from '@tanstack/react-start/server';
import { db } from '../db.server';
import type { Prisma } from '../generated/prisma/client';
import { getCurrentSession, getSessionToken } from '../auth/session-cookie.server';
import { validateSessionInTransaction } from '../auth/session.server';
import { pictureDirectory, readPicture, stagePicture } from '../vehicles/picture-storage.server';
import { processPicture } from '../vehicles/picture-image.server';
import { calculateFuelConsumption } from '../fuel/fuel-calculations';
import { archiveColumns, csvBytes, packArchive, readArchive } from './archive.server';
import { ExportState, TransferError, type TransferStatus } from './transfer-values';

const lifetime = 72 * 60 * 60 * 1000;
const directory = () => resolve(pictureDirectory(), 'exports');
const path = (key: string) => {
    if (!/^[0-9a-f-]{36}\.zip$/.test(key)) throw new Error('Invalid export key');
    return resolve(directory(), key);
};

async function empty(tx: Prisma.TransactionClient, userId: string): Promise<boolean> {
    return (
        !(await tx.vehicle.count({ where: { userId } })) &&
        !(await tx.expenseCategory.count({ where: { userId } })) &&
        !(await tx.expense.count({ where: { userId } }))
    );
}

export async function transferStatus(): Promise<TransferStatus> {
    setResponseHeader('Cache-Control', 'no-store');
    const session = await getCurrentSession();
    if (!session) return { error: TransferError.AUTH };
    const userId = session.user.id;
    const [transfer, isEmpty] = await db.$transaction(
        async (tx) => [await tx.dataTransfer.findUnique({ where: { userId } }), await empty(tx, userId)] as const
    );
    return {
        state: transfer?.exportState ?? ExportState.IDLE,
        expiresAt: transfer?.expiresAt?.toISOString() ?? null,
        downloadable: transfer?.exportState === ExportState.READY && !!transfer.expiresAt && transfer.expiresAt.getTime() > Date.now(),
        canImport: isEmpty,
        importedAt: transfer?.importedAt?.toISOString() ?? null,
        importError: transfer?.importError ?? null
    };
}

export async function beginExport(): Promise<TransferStatus> {
    setResponseHeader('Cache-Control', 'no-store');
    const token = getSessionToken();
    const job = await db.$transaction(async (tx) => {
        const session = token ? await validateSessionInTransaction(token, tx) : null;
        if (!session) return null;
        const userId = session.user.id;
        const previous = await tx.dataTransfer.findUnique({ where: { userId } });
        if (previous?.exportState === ExportState.RUNNING) return null;
        const key = `${randomUUID()}.zip`;
        await tx.dataTransfer.upsert({
            where: { userId },
            create: { userId, exportState: ExportState.RUNNING, exportKey: key },
            update: { exportState: ExportState.RUNNING, exportKey: key, expiresAt: null }
        });
        return { userId, key, previousKey: previous?.exportKey };
    });
    if (job) void buildExport(job).catch(() => {});
    return transferStatus();
}

async function buildExport(job: { userId: string; key: string; previousKey?: string | null }): Promise<void> {
    try {
        if (job.previousKey) await rm(path(job.previousKey), { force: true });
        const files = await db.$transaction(
            async (tx) => {
                // The owner lock keeps vehicle images and rows stable during the snapshot.
                await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${job.userId}::uuid FOR UPDATE`;
                const vehicles = await tx.vehicle.findMany({ where: { userId: job.userId }, include: { picture: true } });
                const categories = await tx.expenseCategory.findMany({ where: { userId: job.userId } });
                const fuel = await tx.fuelRecord.findMany({ where: { vehicle: { userId: job.userId } } });
                const expenses = await tx.expense.findMany({ where: { userId: job.userId } });
                const files: Record<string, Uint8Array> = { 'manifest.json': strToU8('{"format":"car-log","version":1}') };
                files['vehicles.csv'] = csvBytes(
                    vehicles.map((v) => ({
                        ...v,
                        registrationDate: v.registrationDate?.toISOString().slice(0, 10) ?? null,
                        picture: v.picture ? `images/${v.id}.jpg` : null
                    })),
                    archiveColumns.vehicles
                );
                files['categories.csv'] = csvBytes(categories, archiveColumns.categories);
                files['fuel.csv'] = csvBytes(
                    fuel.map((r) => ({
                        ...r,
                        odometer: r.odometer.toNumber(),
                        quantity: r.quantity.toNumber(),
                        totalPrice: r.totalPrice.toNumber(),
                        unitPrice: r.unitPrice.toNumber()
                    })),
                    archiveColumns.fuel
                );
                files['expenses.csv'] = csvBytes(
                    expenses.map((r) => ({ ...r, odometer: r.odometer.toNumber(), totalPrice: r.totalPrice.toNumber() })),
                    archiveColumns.expenses
                );
                for (const v of vehicles) if (v.picture) files[`images/${v.id}.jpg`] = await readPicture(v.picture.key);
                return files;
            },
            { timeout: 120000 }
        );
        const bytes = await packArchive(files);
        await mkdir(directory(), { recursive: true, mode: 0o700 });
        await writeFile(path(job.key), bytes, { mode: 0o600, flag: 'wx' });
        const updated = await db.dataTransfer.updateMany({
            where: { userId: job.userId, exportKey: job.key },
            data: { exportState: ExportState.READY, expiresAt: new Date(Date.now() + lifetime) }
        });
        if (!updated.count) await rm(path(job.key), { force: true });
    } catch {
        await rm(path(job.key), { force: true }).catch(() => {});
        await db.dataTransfer.updateMany({ where: { userId: job.userId, exportKey: job.key }, data: { exportState: ExportState.FAILED } });
    }
}

export async function downloadExport(): Promise<Response> {
    const session = await getCurrentSession();
    if (!session) return new Response(null, { status: 401 });
    const transfer = await db.dataTransfer.findUnique({ where: { userId: session.user.id } });
    if (
        transfer?.exportState !== ExportState.READY ||
        !transfer.exportKey ||
        !transfer.expiresAt ||
        transfer.expiresAt.getTime() <= Date.now()
    )
        return new Response(null, { status: 404 });
    try {
        const bytes = await readFile(path(transfer.exportKey));
        return new Response(bytes, {
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': 'attachment; filename="car-log.zip"',
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff'
            }
        });
    } catch {
        return new Response(null, { status: 404 });
    }
}

export async function receiveImport(base64: string): Promise<TransferStatus> {
    setResponseHeader('Cache-Control', 'no-store');
    const session = await getCurrentSession();
    if (!session) return { error: TransferError.AUTH };
    const userId = session.user.id;
    const token = getSessionToken();
    let failure: string = TransferError.INVALID;
    try {
        const archive = readArchive(Buffer.from(base64, 'base64'));
        const pictures = new Map<string, string>();
        // Staged images have durable cleanup records until the transaction attaches them.
        for (const v of archive.vehicles)
            if (v.picture) {
                const bytes = await processPicture(Buffer.from(archive.files[v.picture]));
                const picture = await stagePicture(userId, bytes);
                pictures.set(v.id, picture.id);
            }
        await db.$transaction(
            async (tx) => {
                const current = token ? await validateSessionInTransaction(token, tx) : null;
                if (!current || current.user.id !== userId) throw new Error('Session expired');
                if (!(await empty(tx, userId))) {
                    failure = TransferError.NOT_EMPTY;
                    throw new Error('Account not empty');
                }
                const vehicles = new Map<string, string>();
                const categories = new Map<string, string>();
                for (const row of archive.vehicles) {
                    const { id, registrationDate } = row;
                    const data = {
                        manufacturer: row.manufacturer,
                        model: row.model,
                        licensePlate: row.licensePlate,
                        vin: row.vin,
                        color: row.color,
                        fuelTypes: row.fuelTypes,
                        createdAt: row.createdAt,
                        updatedAt: row.updatedAt
                    };
                    const v = await tx.vehicle.create({
                        data: {
                            ...data,
                            registrationDate: registrationDate ? new Date(registrationDate) : null,
                            userId,
                            pictureId: pictures.get(id)
                        }
                    });
                    vehicles.set(id, v.id);
                    if (v.pictureId) await tx.pictureFile.update({ where: { id: v.pictureId }, data: { deleteAfter: null } });
                }
                for (const { id, ...data } of archive.categories) {
                    const c = await tx.expenseCategory.create({ data: { ...data, userId } });
                    categories.set(id, c.id);
                }
                for (const timeline of archive.timelines.values()) {
                    const calculated = calculateFuelConsumption(timeline, timeline[0].fuelType);
                    for (const { id, vehicleId, occurredAt, ...data } of timeline)
                        await tx.fuelRecord.create({
                            data: { ...data, ...calculated.get(id), vehicleId: vehicles.get(vehicleId)!, occurredAt: new Date(occurredAt) }
                        });
                }
                for (const row of archive.expenses)
                    await tx.expense.create({
                        data: {
                            userId,
                            vehicleId: vehicles.get(row.vehicleId)!,
                            categoryId: categories.get(row.categoryId)!,
                            occurredAt: new Date(row.occurredAt),
                            totalPrice: row.totalPrice,
                            odometer: row.odometer,
                            comment: row.comment,
                            createdAt: row.createdAt,
                            updatedAt: row.updatedAt
                        }
                    });
                await tx.dataTransfer.upsert({
                    where: { userId },
                    create: { userId, importedAt: new Date() },
                    update: { importedAt: new Date(), importError: null }
                });
            },
            { timeout: 120000 }
        );
    } catch {
        await db.dataTransfer.upsert({ where: { userId }, create: { userId, importError: failure }, update: { importError: failure } });
    }
    return transferStatus();
}

async function cleanupExports(): Promise<void> {
    const entries = await readdir(directory()).catch(() => [] as string[]);
    for (const key of entries) {
        if (!/^[0-9a-f-]{36}\.zip$/.test(key)) continue;
        const transfer = await db.dataTransfer.findFirst({ where: { exportKey: key } });
        const info = await stat(path(key)).catch(() => null);
        if (
            (!transfer ||
                transfer.exportState === ExportState.FAILED ||
                (transfer.expiresAt && transfer.expiresAt.getTime() <= Date.now())) &&
            info &&
            info.mtimeMs < Date.now() - 60000
        )
            await rm(path(key), { force: true });
    }
}

const runtime = globalThis as typeof globalThis & { exportCleanup?: ReturnType<typeof setInterval> };
export function startExportCleanup(): void {
    if (runtime.exportCleanup) return;
    // A process restart interrupts its in-process jobs; allow a fresh export.
    void db.dataTransfer
        .updateMany({ where: { exportState: ExportState.RUNNING }, data: { exportState: ExportState.FAILED } })
        .catch(() => {});
    void cleanupExports().catch(() => {});
    runtime.exportCleanup = setInterval(() => {
        void cleanupExports().catch(() => {});
    }, 60000);
    runtime.exportCleanup.unref();
}

export async function executeTransferOperation(operation: () => Promise<TransferStatus>): Promise<TransferStatus> {
    try {
        return await operation();
    } catch {
        return { error: TransferError.UNAVAILABLE };
    }
}
