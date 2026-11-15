import { logServerError } from '../logging.server';
import { ServerFunctionOperation } from '../server-functions/server-function-operations';
import { UserStatus } from '../generated/prisma/enums';
import type { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { db } from '../db.server';
import type { PrismaClient } from '../generated/prisma/client';
import { sendPasswordResetEmail, type VerificationSender } from '../email/verification-mail.server';
import { deliverVerification } from './email-verification.server';
import { passwordResetRequestSchema, passwordResetSchema } from './password-reset-schema';
import { hashPassword } from './password.server';
import { lockUser, tokenHash } from './session.server';

export const passwordResetLifetimeMs = 60 * 60 * 1000;

// Run lookup and SMTP after accepting the request so SMTP latency cannot reveal
// whether an identifier belongs to an eligible account.
export function startPasswordResetRequest(
    input: z.input<typeof passwordResetRequestSchema>,
    database: PrismaClient = db,
    sender: VerificationSender = sendPasswordResetEmail
): Promise<void> {
    return requestPasswordResetForIdentifier(input, database, sender).catch((error: unknown) => {
        logServerError(ServerFunctionOperation.REQUEST_PASSWORD_RESET, error);
    });
}

export async function requestPasswordResetForIdentifier(
    input: z.input<typeof passwordResetRequestSchema>,
    database: PrismaClient = db,
    sender: VerificationSender = sendPasswordResetEmail,
    now = new Date()
): Promise<void> {
    const { identifier } = passwordResetRequestSchema.parse(input);
    const message = await database.$transaction(async (tx) => {
        const found = await tx.user.findUnique({
            where: identifier.includes('@') ? { email: identifier } : { username: identifier },
            select: { id: true }
        });

        if (!found) return null;

        const user = await lockUser(tx, found.id);

        if (!user || user.status !== UserStatus.ACTIVE || !user.emailVerifiedAt) return null;
        if (identifier !== (identifier.includes('@') ? user.email : user.username)) return null;

        const token = randomBytes(32).toString('base64url');

        await tx.passwordReset.deleteMany({ where: { userId: user.id } });
        await tx.passwordReset.create({
            data: {
                userId: user.id,
                email: user.email,
                tokenHash: tokenHash(token),
                createdAt: now,
                expiresAt: new Date(now.getTime() + passwordResetLifetimeMs)
            }
        });

        return { email: user.email, token };
    });

    // Delivery errors and account eligibility must not change the public result.
    if (message) await deliverVerification(message, sender);
}

export async function completePasswordReset(
    input: z.input<typeof passwordResetSchema>,
    database: PrismaClient = db,
    now?: Date
): Promise<boolean> {
    const data = passwordResetSchema.parse(input);
    const hash = tokenHash(data.token);
    const initial = await database.passwordReset.findUnique({ where: { tokenHash: hash } });

    if (!initial || initial.expiresAt <= (now ?? new Date())) return false;

    // Expensive hashing happens outside the transaction; all authorization and
    // token checks are repeated under the user lock immediately before mutation.
    const passwordHash = await hashPassword(data.newPassword);

    return database.$transaction(async (tx) => {
        const user = await lockUser(tx, initial.userId);
        const reset = await tx.passwordReset.findUnique({ where: { tokenHash: hash } });

        if (!user || !reset) return false;

        if (
            user.status !== UserStatus.ACTIVE ||
            !user.emailVerifiedAt ||
            reset.email !== user.email ||
            reset.expiresAt <= (now ?? new Date())
        ) {
            await tx.passwordReset.deleteMany({ where: { id: reset.id } });

            return false;
        }

        await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
        await tx.passwordReset.deleteMany({ where: { userId: user.id } });
        await tx.session.deleteMany({ where: { userId: user.id } });

        return true;
    });
}
