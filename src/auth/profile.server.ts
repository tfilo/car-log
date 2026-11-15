import { AuthErrorCode } from './auth-errors';
import { ResultKind } from '../common/result-kind';
import type { ProfileResult, SessionOutcome } from './auth.types';
import type { z } from 'zod';
import { db } from '../db.server';
import type { PrismaClient } from '../generated/prisma/client';
import { profileSchema } from './profile-schema';
import { hashPassword, verifyPassword } from './password.server';
import { createSessionInTransaction, publicUser, validateSession, validateSessionInTransaction } from './session.server';
import { deliverVerification, issueVerificationToken } from './email-verification.server';
import { sendVerificationEmail, type VerificationMessage, type VerificationSender } from '../email/verification-mail.server';

type ProfileOutcome = SessionOutcome<ProfileResult> & { sessionToken?: string };

type ProfileTransactionOutcome = ProfileOutcome & { verification?: VerificationMessage };

export async function updateUserProfile(
    token: string | undefined,
    input: z.input<typeof profileSchema>,
    database: PrismaClient = db,
    sender: VerificationSender = sendVerificationEmail
): Promise<ProfileOutcome> {
    const data = profileSchema.parse(input);
    const session = token ? await validateSession(token, database) : null;

    if (!session || !token) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

    const original = await database.user.findUnique({ where: { id: session.user.id } });

    if (!original) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

    const sensitive = Boolean(
        data.newPassword ||
        (data.email !== undefined && data.email !== original.email) ||
        (data.username !== undefined && data.username !== original.username)
    );

    if (sensitive && !data.currentPassword)
        return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.CURRENT_PASSWORD_REQUIRED }, expiresAt: session.expiresAt };

    if (sensitive && !(await verifyPassword(data.currentPassword!, original.passwordHash))) {
        return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.CURRENT_PASSWORD_INVALID }, expiresAt: session.expiresAt };
    }

    const newHash = data.newPassword ? await hashPassword(data.newPassword) : undefined;

    try {
        const outcome = await database.$transaction(async (tx): Promise<ProfileTransactionOutcome> => {
            const currentSession = await validateSessionInTransaction(token, tx);

            if (currentSession?.user.id !== original.id)
                return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

            const current = await tx.user.findUniqueOrThrow({ where: { id: original.id } });
            const emailChanged = data.email !== undefined && data.email !== current.email;
            const sensitiveNow = Boolean(newHash || emailChanged || (data.username !== undefined && data.username !== current.username));

            if (sensitiveNow && (!sensitive || current.passwordHash !== original.passwordHash)) {
                return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.PROFILE_CHANGED }, expiresAt: currentSession.expiresAt };
            }

            const user = await tx.user.update({
                where: { id: current.id },
                data: {
                    firstName: data.firstName,
                    storeFuelLocation: data.storeFuelLocation,
                    lastName: data.lastName,
                    email: data.email,
                    username: data.username,
                    passwordHash: newHash,
                    emailVerifiedAt: emailChanged ? null : undefined
                }
            });
            const verification = emailChanged ? await issueVerificationToken(tx, user.id, user.email) : undefined;

            if (sensitiveNow) {
                await tx.session.deleteMany({ where: { userId: user.id } });

                const fresh = await createSessionInTransaction(user.id, user.passwordHash, undefined, tx);

                if (!fresh) throw new Error('Cannot issue a session after a verified profile update.');

                return {
                    result: { kind: ResultKind.UPDATED, user: fresh.user },
                    sessionToken: fresh.token,
                    expiresAt: fresh.expiresAt,
                    verification
                };
            }

            return { result: { kind: ResultKind.UPDATED, user: publicUser(user) }, expiresAt: currentSession.expiresAt, verification };
        });
        const { verification, ...response } = outcome;
        const delivery = verification ? await deliverVerification(verification, sender) : undefined;

        // Raw verification/session tokens stay in server-only metadata, never in the RPC result.
        if (response.result.kind === ResultKind.UPDATED) {
            return { ...response, result: { ...response.result, verificationDelivery: delivery } };
        }

        return response;
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
            return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.IDENTIFIER_ALREADY_EXISTS }, expiresAt: session.expiresAt };
        }

        throw error;
    }
}
