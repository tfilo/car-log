import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { FuelType, UserRole, UserStatus } from '../src/generated/prisma/enums';
import { db } from '../src/db.server';
import { hashPassword } from '../src/auth/password.server';
import { createSession } from '../src/auth/session.server';
import { deleteOwnUserAccount } from '../src/users/users.server';
import { AuthErrorCode } from '../src/auth/auth-errors';
import { ResultKind } from '../src/common/result-kind';
import { VehicleErrorCode } from '../src/vehicles/vehicle-errors';
import { vehicleSchema, deleteVehicleSchema } from '../src/vehicles/vehicle-schema';
import {
    createOwnedVehicle,
    getOwnedVehicle,
    listOwnedVehicles,
    updateOwnedVehicle,
    deleteOwnedVehicle
} from '../src/vehicles/vehicles.server';
import { saveVehiclePicture, getVehiclePicture, removeVehiclePicture } from '../src/vehicles/pictures.server';
import { cleanupPictures, stagePicture } from '../src/vehicles/picture-storage.server';
import * as storage from '../src/vehicles/picture-storage.server';
import { processPicture, InvalidPictureError } from '../src/vehicles/picture-image.server';
import { pictureMaxBytes } from '../src/vehicles/picture-policy';

const databaseName = `car_log_vehicles_${randomUUID().replaceAll('-', '')}`;
let database: PrismaClient;
let directory: string;
let created = false;
let passwordHash: string;
let owner: { id: string; username: string; token: string };
let stranger: { id: string; username: string; token: string };

const input = {
    manufacturer: 'Synthetic',
    model: 'Vehicle',
    fuelTypes: [FuelType.PETROL, FuelType.ELECTRIC],
    registrationDate: '2020-03-29'
};

async function account(role: UserRole = UserRole.USER) {
    const username = randomUUID().replaceAll('-', '').slice(0, 20);
    const user = await database.user.create({
        data: { email: `${username}@example.test`, username, passwordHash, status: UserStatus.ACTIVE, role }
    });
    const session = await createSession(user.id, passwordHash, undefined, database);

    if (!session) throw new Error('Expected active test session.');

    return { id: user.id, username, token: session.token };
}

async function vehicle() {
    const outcome = await createOwnedVehicle(owner.token, input, database);

    if (outcome.result.kind !== ResultKind.CREATED) throw new Error('Expected created vehicle.');

    return outcome.result.vehicle;
}

async function jpeg() {
    return sharp({ create: { width: 32, height: 24, channels: 3, background: '#527d91' } })
        .jpeg()
        .toBuffer();
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
    directory = await mkdtemp(join(tmpdir(), 'car-log-pictures-'));
    vi.stubEnv('VEHICLE_IMAGE_DIR', directory);
    passwordHash = await hashPassword('Password123!');
}, 30_000);

beforeEach(async () => {
    await database.user.deleteMany();
    await cleanupPictures(database, directory);
    owner = await account();
    stranger = await account(UserRole.ADMIN);
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
    await database?.$disconnect();

    if (created) await db.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);

    await db.$disconnect();

    if (directory) await rm(directory, { recursive: true, force: true });

    vi.unstubAllEnvs();
});

test('vehicle schema normalizes optional fields and rejects empty/duplicate fuel lists and invalid dates', () => {
    expect(vehicleSchema.parse({ ...input, licensePlate: ' ab-123 ', vin: ' legacy123 ', color: ' ' }).licensePlate).toBe('AB-123');
    expect(vehicleSchema.parse({ ...input, color: '' }).color).toBeNull();
    expect(vehicleSchema.safeParse({ ...input, fuelTypes: [] }).success).toBe(false);
    expect(vehicleSchema.safeParse({ ...input, fuelTypes: [FuelType.PETROL, FuelType.PETROL] }).success).toBe(false);
    expect(vehicleSchema.safeParse({ ...input, registrationDate: '2023-02-29' }).success).toBe(false);
    expect(vehicleSchema.safeParse({ ...input, userId: stranger.id }).success).toBe(false);
    expect(deleteVehicleSchema.safeParse({ vehicleId: owner.id, confirmed: false }).success).toBe(false);
});

test('CRUD stays owner-scoped, including for administrators, with UUID v7 IDs and date-only values', async () => {
    const car = await vehicle();

    expect(car.id[14]).toBe('7');
    expect(car.registrationDate).toBe(input.registrationDate);
    expect(car.fuelTypes).toEqual(input.fuelTypes);
    expect(car).not.toHaveProperty('userId');

    const list = await listOwnedVehicles(owner.token, { page: 0, pageSize: 1 }, database);

    expect(list.result).toMatchObject({ kind: ResultKind.VEHICLES, total: 1, page: 0 });
    expect((await listOwnedVehicles(stranger.token, undefined, database)).result).toMatchObject({ kind: ResultKind.VEHICLES, total: 0 });
    expect((await getOwnedVehicle(stranger.token, { vehicleId: car.id }, database)).result).toMatchObject({
        code: VehicleErrorCode.NOT_FOUND
    });
    expect((await updateOwnedVehicle(stranger.token, { ...input, vehicleId: car.id, model: 'Other' }, database)).result).toMatchObject({
        code: VehicleErrorCode.NOT_FOUND
    });
    expect((await deleteOwnedVehicle(stranger.token, { vehicleId: car.id, confirmed: true }, database)).result).toMatchObject({
        code: VehicleErrorCode.NOT_FOUND
    });
    expect((await getOwnedVehicle(undefined, { vehicleId: car.id }, database)).result).toMatchObject({ code: AuthErrorCode.AUTH_REQUIRED });
    expect(
        (await updateOwnedVehicle(owner.token, { ...input, vehicleId: car.id, registrationDate: '', licensePlate: 'xy-1' }, database))
            .result
    ).toMatchObject({ kind: ResultKind.UPDATED, vehicle: { registrationDate: null, licensePlate: 'XY-1' } });
    expect((await deleteOwnedVehicle(owner.token, { vehicleId: car.id, confirmed: true }, database)).result.kind).toBe(ResultKind.DELETED);
});

test('pictures use owner folders and random UUID v4 filenames, and owner-only reads', async () => {
    const car = await vehicle();
    const saved = await saveVehiclePicture(owner.token, car.id, await jpeg(), database, directory);

    expect(saved.result.kind).toBe(ResultKind.UPDATED);

    const picture = await database.pictureFile.findFirstOrThrow({ where: { vehicle: { id: car.id } } });

    expect(picture.key).toMatch(new RegExp(`^${owner.id}/[0-9a-f-]{36}\\.jpg$`));
    expect(picture.key.split('/')[1][14]).toBe('4');
    expect(picture.deleteAfter).toBeNull();
    expect((await sharp(await readFile(join(directory, picture.key))).metadata()).format).toBe('jpeg');
    expect('bytes' in (await getVehiclePicture(owner.token, car.id, database, directory))).toBe(true);
    expect(await getVehiclePicture(stranger.token, car.id, database, directory)).toMatchObject({
        result: { code: VehicleErrorCode.NOT_FOUND }
    });
    expect((await saveVehiclePicture(stranger.token, car.id, await jpeg(), database, directory)).result).toMatchObject({
        code: VehicleErrorCode.NOT_FOUND
    });
});

test('picture changes and vehicle deletion commit before background file cleanup', async () => {
    const car = await vehicle();

    await saveVehiclePicture(owner.token, car.id, await jpeg(), database, directory);

    const first = await database.pictureFile.findFirstOrThrow();

    await saveVehiclePicture(owner.token, car.id, await jpeg(), database, directory);
    await expect(access(join(directory, first.key))).resolves.toBeUndefined();
    expect((await database.pictureFile.findUniqueOrThrow({ where: { id: first.id } })).deleteAfter).not.toBeNull();

    await cleanupPictures(database, directory);
    await expect(access(join(directory, first.key))).rejects.toThrow();
    expect(await database.pictureFile.count()).toBe(1);
    await removeVehiclePicture(owner.token, car.id, database);
    expect(await getVehiclePicture(owner.token, car.id, database, directory)).toMatchObject({
        result: { code: VehicleErrorCode.NOT_FOUND }
    });
    expect(await database.pictureFile.count({ where: { deleteAfter: { not: null } } })).toBe(1);

    await cleanupPictures(database, directory);
    expect(await database.pictureFile.count()).toBe(0);
    await saveVehiclePicture(owner.token, car.id, await jpeg(), database, directory);

    const last = await database.pictureFile.findFirstOrThrow();

    await deleteOwnedVehicle(owner.token, { vehicleId: car.id, confirmed: true }, database);
    expect(await database.vehicle.findUnique({ where: { id: car.id } })).toBeNull();
    await expect(access(join(directory, last.key))).resolves.toBeUndefined();
    expect((await database.pictureFile.findUniqueOrThrow({ where: { id: last.id } })).deleteAfter).not.toBeNull();

    await cleanupPictures(database, directory);
    await expect(access(join(directory, last.key))).rejects.toThrow();
    expect(await database.pictureFile.count()).toBe(0);
});

test('account deletion cascades vehicles and queues pictures without waiting for filesystem cleanup', async () => {
    const car = await vehicle();

    await saveVehiclePicture(owner.token, car.id, await jpeg(), database, directory);

    const picture = await database.pictureFile.findFirstOrThrow();

    expect((await deleteOwnUserAccount(owner.token, { confirmation: owner.username }, database)).result.kind).toBe(ResultKind.DELETED);
    expect(await database.vehicle.count()).toBe(0);
    await expect(access(join(directory, picture.key))).resolves.toBeUndefined();
    expect((await database.pictureFile.findUniqueOrThrow({ where: { id: picture.id } })).deleteAfter).not.toBeNull();

    await cleanupPictures(database, directory);
    expect(await database.pictureFile.count()).toBe(0);
    await expect(access(join(directory, picture.key))).rejects.toThrow();
});

test('staged files and failed cleanup remain retryable without dangling vehicle references', async () => {
    const staged = await stagePicture(owner.id, await jpeg(), database, directory);

    await database.pictureFile.update({ where: { id: staged.id }, data: { deleteAfter: new Date(0) } });
    await cleanupPictures(database, directory);
    await expect(access(join(directory, staged.key))).rejects.toThrow();

    const key = `${owner.id}/${randomUUID()}.jpg`;

    await database.pictureFile.create({ data: { key, deleteAfter: new Date(0) } });
    await mkdir(join(directory, key), { recursive: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await cleanupPictures(database, directory);
    expect(await database.pictureFile.count()).toBe(1);
    await rm(join(directory, key), { recursive: true });
    await cleanupPictures(database, directory);
    expect(await database.pictureFile.count()).toBe(0);
});

test('image processing strips metadata, respects orientation, and rejects non-images and oversized inputs', async () => {
    const rotated = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#527d91' } })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer();
    const output = await processPicture(rotated);
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBe(10);
    expect(metadata.height).toBe(20);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.isProgressive).toBe(true);
    await expect(processPicture(Buffer.from('<svg/>'))).rejects.toBeInstanceOf(InvalidPictureError);
    await expect(processPicture(Buffer.alloc(pictureMaxBytes + 1))).rejects.toBeInstanceOf(InvalidPictureError);

    const car = await vehicle();

    expect((await saveVehiclePicture(owner.token, car.id, Buffer.from('invalid'), database, directory)).result).toMatchObject({
        code: VehicleErrorCode.PICTURE_INVALID
    });
    expect(await database.pictureFile.count()).toBe(0);
});

test.each(['png', 'webp'] as const)('normalizes %s pictures with the same sharp pipeline', async (format) => {
    const input = await sharp({ create: { width: 32, height: 24, channels: 4, background: '#527d91' } })
        .toFormat(format)
        .toBuffer();
    const output = await processPicture(input);
    const metadata = await sharp(output).metadata();

    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(32);
    expect(metadata.height).toBe(24);
});

test('concurrent picture replacements retain one active file and clean up superseded files', async () => {
    const car = await vehicle();
    const input = await jpeg();
    const outcomes = await Promise.all([
        saveVehiclePicture(owner.token, car.id, input, database, directory),
        saveVehiclePicture(owner.token, car.id, input, database, directory)
    ]);

    expect(outcomes.every((outcome) => outcome.result.kind === ResultKind.UPDATED)).toBe(true);
    await cleanupPictures(database, directory);
    expect(await database.pictureFile.count()).toBe(1);
    expect('bytes' in (await getVehiclePicture(owner.token, car.id, database, directory))).toBe(true);
});

test('picture file reads release the account lock before filesystem work', async () => {
    const car = await vehicle();
    await saveVehiclePicture(owner.token, car.id, await jpeg(), database, directory);
    const read = storage.readPicture;

    vi.spyOn(storage, 'readPicture').mockImplementationOnce(async (key, path) => {
        const saved = await updateOwnedVehicle(owner.token, { ...input, vehicleId: car.id, model: 'Updated during read' }, database);
        expect(saved.result.kind).toBe(ResultKind.UPDATED);

        return read(key, path);
    });

    expect(await getVehiclePicture(owner.token, car.id, database, directory)).toHaveProperty('bytes');
    expect((await getOwnedVehicle(owner.token, { vehicleId: car.id }, database)).result).toMatchObject({
        vehicle: { model: 'Updated during read' }
    });
});

test('a picture deleted after authorization returns not found', async () => {
    const car = await vehicle();
    await saveVehiclePicture(owner.token, car.id, await jpeg(), database, directory);
    const read = storage.readPicture;

    vi.spyOn(storage, 'readPicture').mockImplementationOnce(async (key, path) => {
        await deleteOwnedVehicle(owner.token, { vehicleId: car.id, confirmed: true }, database);
        await cleanupPictures(database, directory);

        return read(key, path);
    });

    expect(await getVehiclePicture(owner.token, car.id, database, directory)).toMatchObject({
        result: { code: VehicleErrorCode.NOT_FOUND }
    });
});
