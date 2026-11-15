import { UserStatus } from '../src/generated/prisma/enums';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, expect, test, vi } from 'vitest';
import { db } from '../src/db.server';
import type { Prisma } from '../src/generated/prisma/client';
import { hashPassword, passwordNeedsRehash, verifyPassword } from '../src/auth/password.server';
import * as passwordHelpers from '../src/auth/password.server';
import { verifyUserPassword } from '../src/auth/user-password.server';

const password = 'Password123!';

async function withUser(run: (tx: Prisma.TransactionClient, user: { id: string; passwordHash: string }) => Promise<void>) {
    const passwordHash = await hashPassword(password);
    const rollback = new Error('Roll back test records');

    try {
        await db.$transaction(
            async (tx) => {
                const unique = randomUUID().replaceAll('-', '');
                const user = await tx.user.create({
                    data: { email: `${unique}@example.test`, username: unique.slice(0, 30), passwordHash, status: UserStatus.ACTIVE }
                });

                await run(tx, user);

                throw rollback;
            },
            { timeout: 15000 }
        );
    } catch (error) {
        if (error !== rollback) throw error;
    }
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

afterAll(async () => {
    await db.$disconnect();
});

test.each([
    ['ARGON2_MEMORY', '32768'],
    ['ARGON2_PASSES', '2'],
    ['ARGON2_PARALLELISM', '2']
])('successful verification upgrades the stored hash after changing %s', async (name, value) => {
    await withUser(async (tx, user) => {
        vi.stubEnv(name, value);
        expect(await verifyUserPassword(user.id, password, tx)).toBe(true);

        const updated = await tx.user.findUniqueOrThrow({ where: { id: user.id } });

        expect(updated.passwordHash).not.toBe(user.passwordHash);
        expect(passwordNeedsRehash(updated.passwordHash)).toBe(false);
        expect(await verifyPassword(password, updated.passwordHash)).toBe(true);
        expect(await verifyPassword(password, user.passwordHash)).toBe(true);
    });
});

test('current hashes are not rewritten after successful verification', async () => {
    await withUser(async (tx, user) => {
        expect(await verifyUserPassword(user.id, password, tx)).toBe(true);
        expect((await tx.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(user.passwordHash);
    });
});

test('a wrong password never upgrades the stored hash', async () => {
    await withUser(async (tx, user) => {
        vi.stubEnv('ARGON2_PASSES', '4');
        expect(await verifyUserPassword(user.id, 'WrongPassword123!', tx)).toBe(false);
        expect((await tx.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(user.passwordHash);
    });
});

test('unknown users fail verification', async () => {
    expect(await verifyUserPassword(randomUUID(), password)).toBe(false);
});

test('an upgrade does not overwrite a concurrent password reset', async () => {
    await withUser(async (tx, user) => {
        vi.stubEnv('ARGON2_PASSES', '4');

        const resetHash = await hashPassword('ResetPassword456!');
        const originalHashPassword = hashPassword;

        vi.spyOn(passwordHelpers, 'hashPassword').mockImplementationOnce(async (submittedPassword) => {
            await tx.user.update({ where: { id: user.id }, data: { passwordHash: resetHash } });

            return originalHashPassword(submittedPassword);
        });

        expect(await verifyUserPassword(user.id, password, tx)).toBe(false);
        expect((await tx.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(resetHash);
    });
});
