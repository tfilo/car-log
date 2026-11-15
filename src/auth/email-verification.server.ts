import { LogOperation } from '../log-operations.server';
import { logServerError } from '../logging.server';
import { ResultKind } from '../common/result-kind';
import { EmailDeliveryStatus } from '../email/email-delivery-status';
import type { EmailDelivery, VerificationRequestResult } from './auth.types';
import { randomBytes } from 'node:crypto';
import { db } from '../db.server';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { lockUser, tokenHash, validToken } from './session.server';
import { sendVerificationEmail, type VerificationMessage, type VerificationSender } from '../email/verification-mail.server';

export const verificationLifetimeMs = 24 * 60 * 60 * 1000;

export async function issueVerificationToken(
    tx: Prisma.TransactionClient,
    userId: string,
    email: string,
    now = new Date()
): Promise<VerificationMessage> {
    const token = randomBytes(32).toString('base64url');

    await tx.emailVerification.deleteMany({ where: { userId } });
    await tx.emailVerification.create({
        data: { userId, email, tokenHash: tokenHash(token), expiresAt: new Date(now.getTime() + verificationLifetimeMs), createdAt: now }
    });

    return { email, token };
}

export async function deliverVerification(
    message: { email: string; token: string },
    sender: VerificationSender = sendVerificationEmail
): Promise<EmailDelivery> {
    try {
        await sender(message);

        return EmailDeliveryStatus.SENT;
    } catch (error) {
        logServerError(LogOperation.DELIVER_ACCOUNT_EMAIL, error);

        return EmailDeliveryStatus.UNAVAILABLE;
    }
}

export async function requestVerificationForUser(
    userId: string,
    database: PrismaClient = db,
    sender: VerificationSender = sendVerificationEmail,
    now = new Date()
): Promise<VerificationRequestResult> {
    const outcome = await database.$transaction(async (tx) => {
        const user = await lockUser(tx, userId);

        if (!user || user.emailVerifiedAt) return { kind: ResultKind.ALREADY_VERIFIED };

        return { kind: ResultKind.ISSUED, message: await issueVerificationToken(tx, userId, user.email, now) };
    });

    if (outcome.kind !== ResultKind.ISSUED) return outcome;

    return { kind: ResultKind.REQUESTED, delivery: await deliverVerification(outcome.message, sender) };
}

export async function confirmEmailAddress(token: string, database: PrismaClient = db, now = new Date()): Promise<boolean> {
    if (!validToken(token)) return false;

    return database.$transaction(async (tx) => {
        const initial = await tx.emailVerification.findUnique({ where: { tokenHash: tokenHash(token) }, select: { userId: true } });

        if (!initial) return false;

        const user = await lockUser(tx, initial.userId);
        const verification = await tx.emailVerification.findUnique({ where: { tokenHash: tokenHash(token) } });

        if (!user || !verification) return false;

        if (verification.expiresAt <= now || verification.email !== user.email) {
            await tx.emailVerification.deleteMany({ where: { id: verification.id } });

            return false;
        }

        await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now } });
        await tx.emailVerification.deleteMany({ where: { userId: user.id } });

        return true;
    });
}
