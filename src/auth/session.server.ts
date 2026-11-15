import { type UserRole, UserStatus } from '../generated/prisma/enums';
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db.server';
import type { Prisma, PrismaClient } from '../generated/prisma/client';

export const sessionLifetimeSeconds = 14 * 24 * 60 * 60;

export type SessionUser = {
    storeFuelLocation: boolean;
    id: string;
    email: string;
    username: string;
    firstName: string | null;
    lastName: string | null;
    emailVerifiedAt: Date | null;
    role: UserRole;
};

export type ValidSession = { expiresAt: Date; user: SessionUser };

export type CreatedSession = ValidSession & { token: string };

type LockedUser = SessionUser & { status: UserStatus; passwordHash: string };

export function validToken(token: string): boolean {
    return token.length === 43 && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

export function publicUser(user: LockedUser): SessionUser {
    return {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        storeFuelLocation: user.storeFuelLocation,
        lastName: user.lastName,
        role: user.role,
        emailVerifiedAt: user.emailVerifiedAt
    };
}

export async function lockUser(tx: Prisma.TransactionClient, userId: string): Promise<LockedUser | undefined> {
    const [user] = await tx.$queryRaw<LockedUser[]>`
        SELECT "id", "email", "username", "firstName", "lastName", "emailVerifiedAt", "role", "status", "passwordHash", "storeFuelLocation"
        FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE
    `;

    return user;
}

export async function createSession(
    userId: string,
    verifiedHash: string,
    previousToken?: string,
    database: PrismaClient = db
): Promise<CreatedSession | null> {
    return database.$transaction((tx) => createSessionInTransaction(userId, verifiedHash, previousToken, tx));
}

export async function createSessionInTransaction(
    userId: string,
    verifiedHash: string,
    previousToken: string | undefined,
    tx: Prisma.TransactionClient
): Promise<CreatedSession | null> {
    const token = randomBytes(32).toString('base64url');
    const user = await lockUser(tx, userId);

    if (user?.status !== UserStatus.ACTIVE || user.passwordHash !== verifiedHash) return null;

    if (previousToken && validToken(previousToken)) {
        await tx.session.deleteMany({ where: { tokenHash: tokenHash(previousToken) } });
    }

    const expiresAt = new Date(Date.now() + sessionLifetimeSeconds * 1000);

    await tx.session.create({ data: { userId, tokenHash: tokenHash(token), expiresAt } });

    return { token, expiresAt, user: publicUser(user) };
}

export async function validateSession(token: string, database: PrismaClient = db, now = new Date()): Promise<ValidSession | null> {
    if (!validToken(token)) return null;

    return database.$transaction((tx) => validateSessionInTransaction(token, tx, now));
}

export async function validateSessionInTransaction(
    token: string,
    tx: Prisma.TransactionClient,
    now = new Date()
): Promise<ValidSession | null> {
    if (!validToken(token)) return null;

    const hash = tokenHash(token);
    const initial = await tx.session.findUnique({ where: { tokenHash: hash }, select: { userId: true } });

    if (!initial) return null;

    // Always lock the user before touching its sessions, matching login and
    // the blocking trigger. Concurrent renewal cannot resurrect deleted rows.
    const user = await lockUser(tx, initial.userId);

    if (user?.status !== UserStatus.ACTIVE) {
        await tx.session.deleteMany({ where: { userId: initial.userId } });

        return null;
    }

    const session = await tx.session.findUnique({ where: { tokenHash: hash } });

    if (!session) return null;

    if (session.expiresAt <= now) {
        await tx.session.deleteMany({ where: { id: session.id, expiresAt: { lte: now } } });

        return null;
    }

    const expiresAt = new Date(now.getTime() + sessionLifetimeSeconds * 1000);
    const updated = await tx.session.updateMany({
        where: { id: session.id, tokenHash: hash, expiresAt: { gt: now } },
        data: { expiresAt }
    });

    return updated.count === 1 ? { expiresAt, user: publicUser(user) } : null;
}

export async function revokeSession(token: string, database: PrismaClient = db): Promise<void> {
    if (validToken(token)) await database.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
}
