import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { afterAll, expect, test, vi } from 'vitest';
import { db } from '../src/db.server';
import { createSession, validateSession } from '../src/auth/session.server';
import { FuelType, UserStatus } from '../src/generated/prisma/enums';
import { beginExport, transferStatus, downloadExport, receiveImport } from '../src/transfer/transfer.server';
import { archiveColumns, csvBytes, packArchive, readArchive } from '../src/transfer/archive.server';
import { stagePicture, pictureDirectory } from '../src/vehicles/picture-storage.server';
import { ExportState, TransferError } from '../src/transfer/transfer-values';

const current = vi.hoisted(() => ({ token: '' }));
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: vi.fn() }));
vi.mock('../src/auth/session-cookie.server', () => ({
    getSessionToken: () => current.token,
    getCurrentSession: () => validateSession(current.token)
}));
const users: string[] = [];
const files: string[] = [];

async function account() {
    const username = `transfer${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const user = await db.user.create({
        data: { username, email: `${username}@example.test`, passwordHash: 'synthetic-unused', status: UserStatus.ACTIVE }
    });
    users.push(user.id);
    const session = await createSession(user.id, user.passwordHash);
    return { userId: user.id, token: session!.token };
}

afterAll(async () => {
    for (const userId of users) {
        const transfer = await db.dataTransfer.findUnique({ where: { userId } });
        if (transfer?.exportKey) await rm(resolve(pictureDirectory(), 'exports', transfer.exportKey), { force: true });
        const pictures = await db.pictureFile.findMany({ where: { key: { startsWith: `${userId}/` } } });
        await db.user.delete({ where: { id: userId } });
        for (const picture of pictures) {
            files.push(picture.key);
            await db.pictureFile.delete({ where: { id: picture.id } });
        }
    }
    for (const key of files) await rm(resolve(pictureDirectory(), key), { force: true });
});

test('exports only owned data, imports fresh IDs and derived consumption atomically, enforces empty accounts and download expiry', async () => {
    const owner = await account();
    const target = await account();
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
        .jpeg()
        .toBuffer();
    const picture = await stagePicture(owner.userId, image);
    const vehicle = await db.vehicle.create({
        data: { userId: owner.userId, manufacturer: 'Synthetic', model: 'Export test', fuelTypes: [FuelType.PETROL], pictureId: picture.id }
    });
    const category = await db.expenseCategory.create({
        data: { userId: owner.userId, name: 'Synthetic service', serviceIntervalKm: 5000, isArchived: true }
    });
    await db.expense.create({
        data: {
            userId: owner.userId,
            vehicleId: vehicle.id,
            categoryId: category.id,
            totalPrice: 99.95,
            odometer: 1234,
            occurredAt: new Date('2026-01-01T12:00:00Z'),
            comment: 'Synthetic comment'
        }
    });
    for (const [day, odometer] of [
        [1, 1000],
        [2, 1500]
    ])
        await db.fuelRecord.create({
            data: {
                vehicleId: vehicle.id,
                fuelType: FuelType.PETROL,
                occurredAt: new Date(`2026-01-0${day}T12:00:00Z`),
                quantity: 40,
                totalPrice: 60,
                unitPrice: 1.5,
                odometer,
                isFull: true,
                latitude: 48.1,
                longitude: 17.1,
                locationAccuracy: 5,
                locationCapturedAt: new Date('2026-01-01T12:00:00Z')
            }
        });
    current.token = owner.token;
    await beginExport();
    await vi.waitFor(async () => expect(await transferStatus()).toMatchObject({ state: ExportState.READY }), { timeout: 10000 });
    const downloaded = await downloadExport();
    expect(downloaded.status).toBe(200);
    const bytes = new Uint8Array(await downloaded.arrayBuffer());
    const archive = readArchive(bytes);
    expect(archive.vehicles).toHaveLength(1);
    expect(archive.fuelRecords).toHaveLength(2);
    expect(Object.keys(archive.files)).toHaveLength(6);
    expect(new TextDecoder().decode(archive.files['vehicles.csv'])).not.toContain(owner.userId);
    current.token = target.token;
    expect((await downloadExport()).status).toBe(404);
    const imported = await receiveImport(Buffer.from(bytes).toString('base64'));
    expect(imported).toMatchObject({ canImport: false, importError: null });
    const importedVehicle = await db.vehicle.findFirstOrThrow({
        where: { userId: target.userId },
        include: { fuelRecords: { orderBy: { occurredAt: 'asc' } }, expenses: true, picture: true }
    });
    expect(importedVehicle.id).not.toBe(vehicle.id);
    expect(importedVehicle.pictureId).not.toBe(picture.id);
    expect(importedVehicle.fuelRecords[1].consumptionPer100Km?.toNumber()).toBe(8);
    expect(importedVehicle.fuelRecords[1].latitude).toBe(48.1);
    expect(importedVehicle.expenses[0].totalPrice.toNumber()).toBe(99.95);
    expect(importedVehicle.expenses[0].categoryId).not.toBe(category.id);
    expect(await receiveImport(Buffer.from(bytes).toString('base64'))).toMatchObject({ importError: TransferError.NOT_EMPTY });
    expect(await db.vehicle.count({ where: { userId: target.userId } })).toBe(1);
    await db.vehicle.deleteMany({ where: { userId: target.userId } });
    await db.expenseCategory.deleteMany({ where: { userId: target.userId } });
    expect(await transferStatus()).toMatchObject({ canImport: true });
    // Two differently cased category names pass archive parsing but violate the database constraint after a vehicle was created.
    archive.files['categories.csv'] = csvBytes(
        [archive.categories[0], { ...archive.categories[0], id: randomUUID(), name: archive.categories[0].name.toUpperCase() }],
        archiveColumns.categories
    );
    const invalid = await packArchive(archive.files);
    expect(await receiveImport(Buffer.from(invalid).toString('base64'))).toMatchObject({ importError: TransferError.INVALID });
    expect(await db.vehicle.count({ where: { userId: target.userId } })).toBe(0);
    expect(await db.expenseCategory.count({ where: { userId: target.userId } })).toBe(0);
    current.token = owner.token;
    const oldKey = (await db.dataTransfer.findUniqueOrThrow({ where: { userId: owner.userId } })).exportKey;
    await beginExport();
    await vi.waitFor(async () => expect(await transferStatus()).toMatchObject({ state: ExportState.READY }), { timeout: 10000 });
    expect((await db.dataTransfer.findUniqueOrThrow({ where: { userId: owner.userId } })).exportKey).not.toBe(oldKey);
    await db.dataTransfer.update({ where: { userId: owner.userId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await downloadExport()).status).toBe(404);
    expect(await transferStatus()).toMatchObject({ downloadable: false });
}, 30000);
