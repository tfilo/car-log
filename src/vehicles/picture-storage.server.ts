import { LogOperation } from '../log-operations.server';
import { logServerError } from '../logging.server';
import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from '../db.server';
import type { PrismaClient, PictureFile } from '../generated/prisma/client';

const keyPattern = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/;

export function pictureDirectory(): string {
    return resolve(process.env.VEHICLE_IMAGE_DIR ?? '.data/vehicle-images');
}

function filePath(key: string, directory: string): string {
    if (!keyPattern.test(key)) throw new Error('Invalid stored picture key.');

    return resolve(directory, key);
}

export async function stagePicture(
    userId: string,
    bytes: Buffer,
    database: PrismaClient = db,
    directory = pictureDirectory()
): Promise<PictureFile> {
    const key = `${userId}/${randomUUID()}.jpg`;
    const picture = await database.pictureFile.create({ data: { key, deleteAfter: new Date(Date.now() + 60 * 60_000) } });

    try {
        const path = filePath(key, directory);

        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });

        return picture;
    } catch (error) {
        await database.pictureFile.updateMany({ where: { id: picture.id }, data: { deleteAfter: new Date() } });

        throw error;
    }
}

export async function readPicture(key: string, directory = pictureDirectory()): Promise<Buffer> {
    return readFile(filePath(key, directory));
}

// Failed unlinks keep their durable record. Deletion of the DB row happens last.
export async function cleanupPictures(database: PrismaClient = db, directory = pictureDirectory()): Promise<void> {
    try {
        const pictures = await database.pictureFile.findMany({
            where: { deleteAfter: { lte: new Date() } },
            take: 100,
            orderBy: { deleteAfter: 'asc' }
        });

        for (const picture of pictures) {
            try {
                await database.$transaction(async (tx) => {
                    const [pending] = await tx.$queryRaw<
                        Array<{ key: string }>
                    >`SELECT "key" FROM "PictureFile" WHERE "id" = ${picture.id}::uuid AND "deleteAfter" <= CURRENT_TIMESTAMP FOR UPDATE`;

                    if (!pending) return;

                    const path = filePath(pending.key, directory);

                    await rm(path, { force: true });
                    await tx.pictureFile.delete({ where: { id: picture.id } });
                    await rmdir(dirname(path)).catch(() => {});
                });
            } catch (error) {
                logServerError(LogOperation.DELETE_PICTURE_FILE, error);
            }
        }
    } catch (error) {
        logServerError(LogOperation.CLEANUP_PICTURES, error);
    }
}

const cleanupRuntime = globalThis as typeof globalThis & { pictureCleanupTimer?: ReturnType<typeof setInterval> };

export function startPictureCleanup(): void {
    if (cleanupRuntime.pictureCleanupTimer) return;

    void cleanupPictures();
    cleanupRuntime.pictureCleanupTimer = setInterval(() => {
        void cleanupPictures();
    }, 60_000);
    cleanupRuntime.pictureCleanupTimer.unref();
}
