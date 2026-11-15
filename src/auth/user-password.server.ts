import { db } from '../db.server';
import type { PrismaClient } from '../generated/prisma/client';
import { hashPassword, passwordNeedsRehash, verifyPassword } from './password.server';

// Password verification/upgrade only. The login flow must separately enforce
// account status and create the session after this succeeds.
export async function verifyUserPassword(userId: string, password: string, database: Pick<PrismaClient, 'user'> = db): Promise<boolean> {
    return (await verifyAndUpgradeUserPassword(userId, password, database)) !== null;
}

// The verified hash lets login detect a password change before issuing a session.
export async function verifyAndUpgradeUserPassword(
    userId: string,
    password: string,
    database: Pick<PrismaClient, 'user'> = db
): Promise<string | null> {
    const user = await database.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });

    if (!user || !(await verifyPassword(password, user.passwordHash))) return null;
    if (!passwordNeedsRehash(user.passwordHash)) return user.passwordHash;

    const passwordHash = await hashPassword(password);
    // Do not overwrite a password reset or another upgrade that happened while
    // hashing. A concurrent change fails this attempt; the caller can retry.
    const updated = await database.user.updateMany({
        where: { id: userId, passwordHash: user.passwordHash },
        data: { passwordHash }
    });

    return updated.count === 1 ? passwordHash : null;
}
