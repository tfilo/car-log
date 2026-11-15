import { ResultKind } from '../common/result-kind';
import { ConfigurationError } from '../logging.server';
import { UserRole, UserStatus } from '../generated/prisma/enums';
import type { z } from 'zod';
import { db } from '../db.server';
import type { PrismaClient } from '../generated/prisma/client';
import { registrationSchema } from './registration-schema';
import { hashPassword } from './password.server';

export type RegistrationResult =
    | { kind: typeof ResultKind.CREATED; status: typeof UserStatus.ACTIVE | typeof UserStatus.PENDING }
    | { kind: typeof ResultKind.DUPLICATE };

export class RegistrationDisabledError extends Error {
    constructor() {
        super('New user registration is disabled.');
        this.name = 'RegistrationDisabledError';
    }
}

export function isRegistrationEnabled(): boolean {
    return process.env.DISABLE_REGISTRATION !== 'true';
}

// One permanent application-wide row, independent of user IDs and user count.
const registrationStateId = 1;

export async function registerUser(input: z.input<typeof registrationSchema>, database: PrismaClient = db): Promise<RegistrationResult> {
    if (!isRegistrationEnabled()) throw new RegistrationDisabledError();

    const { password, ...profile } = registrationSchema.parse(input);
    // Keep expensive hashing outside the transaction and its bootstrap lock.
    const passwordHash = await hashPassword(password);

    try {
        return await database.$transaction(async (tx) => {
            const [state] = await tx.$queryRaw<Array<{ completedAt: Date | null }>>`
                SELECT "completedAt" FROM "RegistrationState" WHERE "id" = ${registrationStateId} FOR UPDATE
            `;

            if (!state) {
                throw new ConfigurationError('Registration bootstrap state is missing. Apply the database migrations.');
            }

            // Also fail safe if a user was inserted outside registration after migration.
            const firstUser = state.completedAt === null && !(await tx.user.findFirst({ select: { id: true } }));
            const status = firstUser ? UserStatus.ACTIVE : UserStatus.PENDING;

            await tx.user.create({
                data: { ...profile, passwordHash, role: firstUser ? UserRole.ADMIN : UserRole.USER, status }
            });

            if (state.completedAt === null) {
                await tx.registrationState.update({ where: { id: registrationStateId }, data: { completedAt: new Date() } });
            }

            return { kind: ResultKind.CREATED, status };
        });
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
            return { kind: ResultKind.DUPLICATE };
        }

        throw error;
    }
}
