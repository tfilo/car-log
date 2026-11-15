import { UserStatus } from '../generated/prisma/enums';
import { type CreatedSession, createSession } from './session.server';
import type { z } from 'zod';
import { db } from '../db.server';
import type { PrismaClient } from '../generated/prisma/client';
import { loginSchema } from './login-schema';
import { hashPassword } from './password.server';
import { verifyAndUpgradeUserPassword } from './user-password.server';

export async function loginUser(
    input: z.input<typeof loginSchema>,
    previousToken?: string,
    database: PrismaClient = db
): Promise<CreatedSession | null> {
    const { identifier, password } = loginSchema.parse(input);
    const user = await database.user.findUnique({
        where: identifier.includes('@') ? { email: identifier } : { username: identifier },
        select: { id: true, status: true }
    });

    if (user?.status !== UserStatus.ACTIVE) {
        // Do comparable hashing work without exposing account existence/status.
        await hashPassword(password);

        return null;
    }

    const verifiedHash = await verifyAndUpgradeUserPassword(user.id, password, database);

    if (!verifiedHash) return null;

    return createSession(user.id, verifiedHash, previousToken, database);
}
