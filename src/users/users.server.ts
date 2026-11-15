import { UserErrorCode } from './user-errors';
import type { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client';
import { UserRole, UserStatus } from '../generated/prisma/enums';
import { db } from '../db.server';
import { AuthErrorCode } from '../auth/auth-errors';
import { validateSessionInTransaction } from '../auth/session.server';
import type { SessionOutcome } from '../auth/auth.types';
import { ResultKind } from '../common/result-kind';
import { UserAction } from './user-action';
import type { UserListResult, ManageUserResult, DeleteAccountResult } from './user.types';
import { deleteMyAccountSchema, manageUserSchema, userListSchema } from './user-schema';

const userSelect = {
    id: true,
    email: true,
    username: true,
    firstName: true,
    lastName: true,
    emailVerifiedAt: true,
    role: true,
    status: true,
    createdAt: true,
    updatedAt: true
} as const;

// One application-wide lock serializes admin mutations, including demotions.
const adminManagementLock = 76100501;

export async function listManagedUsers(
    token: string | undefined,
    input?: z.input<typeof userListSchema>,
    database: PrismaClient = db
): Promise<SessionOutcome<UserListResult>> {
    const { page, pageSize } = userListSchema.parse(input);

    return database.$transaction(async (tx) => {
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        if (session.user.role !== UserRole.ADMIN) {
            return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.ADMIN_REQUIRED }, expiresAt: session.expiresAt };
        }

        const users = await tx.user.findMany({
            select: userSelect,
            skip: page * pageSize,
            take: pageSize,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
        });
        const total = await tx.user.count();

        return { result: { kind: ResultKind.USERS, users, total, page, pageSize }, expiresAt: session.expiresAt };
    });
}

export async function manageUserAccount(
    token: string | undefined,
    input: z.input<typeof manageUserSchema>,
    database: PrismaClient = db
): Promise<SessionOutcome<ManageUserResult>> {
    const command = manageUserSchema.parse(input);

    return database.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(${adminManagementLock}::bigint)`;

        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const expiresAt = session.expiresAt;

        if (session.user.role !== UserRole.ADMIN)
            return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.ADMIN_REQUIRED }, expiresAt };

        const [target] = await tx.$queryRaw<Array<{ id: string; username: string; role: UserRole; status: UserStatus }>>`
            SELECT "id", "username", "role", "status" FROM "User" WHERE "id" = ${command.userId}::uuid FOR UPDATE
        `;

        if (!target) return { result: { kind: ResultKind.ERROR, code: UserErrorCode.ADMIN_USER_NOT_FOUND }, expiresAt };

        if (command.action === UserAction.DELETE && command.confirmation !== target.username) {
            return { result: { kind: ResultKind.ERROR, code: UserErrorCode.ACCOUNT_CONFIRMATION_MISMATCH }, expiresAt };
        }

        const removesActiveAdmin =
            target.role === UserRole.ADMIN &&
            target.status === UserStatus.ACTIVE &&
            (command.action === UserAction.DELETE ||
                command.action === UserAction.BLOCK ||
                (command.action === UserAction.SET_ROLE && command.role === UserRole.USER));

        if (removesActiveAdmin && (await tx.user.count({ where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE } })) <= 1) {
            return { result: { kind: ResultKind.ERROR, code: UserErrorCode.ADMIN_LAST_ACTIVE }, expiresAt };
        }

        if (
            (command.action === UserAction.APPROVE && target.status !== UserStatus.PENDING) ||
            (command.action === UserAction.UNBLOCK && target.status !== UserStatus.BLOCKED)
        ) {
            return { result: { kind: ResultKind.ERROR, code: UserErrorCode.ADMIN_INVALID_TRANSITION }, expiresAt };
        }

        if (command.action === UserAction.DELETE) {
            await tx.user.delete({ where: { id: target.id } });

            return {
                result: { kind: ResultKind.DELETED, userId: target.id },
                expiresAt: target.id === session.user.id ? undefined : expiresAt,
                clearSession: target.id === session.user.id
            };
        }

        const data =
            command.action === UserAction.SET_ROLE
                ? { role: command.role }
                : { status: command.action === UserAction.BLOCK ? UserStatus.BLOCKED : UserStatus.ACTIVE };
        const user = await tx.user.update({ where: { id: target.id }, data, select: userSelect });
        const clearSession = user.id === session.user.id && user.status !== UserStatus.ACTIVE;

        return { result: { kind: ResultKind.UPDATED, user }, expiresAt: clearSession ? undefined : expiresAt, clearSession };
    });
}

export async function deleteOwnUserAccount(
    token: string | undefined,
    input: z.input<typeof deleteMyAccountSchema>,
    database: PrismaClient = db
): Promise<SessionOutcome<DeleteAccountResult>> {
    const { confirmation } = deleteMyAccountSchema.parse(input);

    return database.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(${adminManagementLock}::bigint)`;

        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const expiresAt = session.expiresAt;

        if (confirmation !== session.user.username) {
            return { result: { kind: ResultKind.ERROR, code: UserErrorCode.ACCOUNT_CONFIRMATION_MISMATCH }, expiresAt };
        }

        if (
            session.user.role === UserRole.ADMIN &&
            (await tx.user.count({ where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE } })) <= 1
        ) {
            return { result: { kind: ResultKind.ERROR, code: UserErrorCode.ADMIN_LAST_ACTIVE }, expiresAt };
        }

        // The target comes exclusively from the session, never from input.
        await tx.user.delete({ where: { id: session.user.id } });

        return { result: { kind: ResultKind.DELETED, userId: session.user.id }, clearSession: true };
    });
}
