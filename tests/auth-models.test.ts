import { UserRole, UserStatus } from '../src/generated/prisma/enums';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, expect, test } from 'vitest';
import { db } from '../src/db.server';
import type { Prisma } from '../src/generated/prisma/client';

// Every test rolls back its own records, including when an assertion fails.
async function withRollback(run: (tx: Prisma.TransactionClient) => Promise<void>) {
    const rollback = new Error('Roll back test records');

    try {
        await db.$transaction(async (tx) => {
            await run(tx);

            throw rollback;
        });
    } catch (error) {
        if (error !== rollback) throw error;
    }
}

function userData() {
    return {
        email: `${randomUUID()}@example.test`,
        username: `user-${randomUUID()}`,
        passwordHash: 'test-placeholder-not-a-real-password-hash'
    };
}

function sessionData(userId: string) {
    return {
        userId,
        tokenHash: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 60_000)
    };
}

afterAll(async () => {
    await db.$disconnect();
});

test('users default to USER and PENDING, with timestamps and UUID v7 IDs', async () => {
    await withRollback(async (tx) => {
        const user = await tx.user.create({ data: userData() });

        expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(user.role).toBe(UserRole.USER);
        expect(user.status).toBe(UserStatus.PENDING);
        expect(user.firstName).toBeNull();
        expect(user.lastName).toBeNull();
        expect(user.createdAt).toBeInstanceOf(Date);
        expect(user.updatedAt).toBeInstanceOf(Date);
    });
});

test('sessions receive database-generated UUID v7 IDs', async () => {
    await withRollback(async (tx) => {
        const user = await tx.user.create({ data: userData() });
        const session = await tx.session.create({ data: sessionData(user.id) });

        expect(session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
});

test('duplicate email addresses are rejected by the database', async () => {
    await withRollback(async (tx) => {
        const data = userData();

        await tx.user.create({ data });

        await expect(tx.user.create({ data: { ...userData(), email: data.email } })).rejects.toMatchObject({ code: 'P2002' });
    });
});

test('duplicate usernames are rejected even when emails differ', async () => {
    await withRollback(async (tx) => {
        const user = await tx.user.create({ data: userData() });

        await expect(tx.user.create({ data: { ...userData(), username: user.username } })).rejects.toMatchObject({
            code: 'P2002'
        });
    });
});

test('optional names can be stored independently', async () => {
    await withRollback(async (tx) => {
        const user = await tx.user.create({ data: { ...userData(), firstName: 'TestFirst' } });

        expect(user.firstName).toBe('TestFirst');
        expect(user.lastName).toBeNull();

        const updated = await tx.user.update({ where: { id: user.id }, data: { firstName: null, lastName: 'TestLast' } });

        expect(updated.firstName).toBeNull();
        expect(updated.lastName).toBe('TestLast');
    });
});

test('a user can own multiple sessions and deleting the user removes those sessions', async () => {
    await withRollback(async (tx) => {
        const user = await tx.user.create({ data: userData() });

        await tx.session.createMany({ data: [sessionData(user.id), sessionData(user.id)] });
        expect(await tx.session.count({ where: { userId: user.id } })).toBe(2);

        await tx.user.delete({ where: { id: user.id } });
        expect(await tx.session.count({ where: { userId: user.id } })).toBe(0);
    });
});

test('duplicate session token hashes are rejected', async () => {
    await withRollback(async (tx) => {
        const user = await tx.user.create({ data: userData() });
        const data = sessionData(user.id);

        await tx.session.create({ data });

        await expect(tx.session.create({ data })).rejects.toMatchObject({ code: 'P2002' });
    });
});

test('a session cannot reference a missing user', async () => {
    await withRollback(async (tx) => {
        await expect(tx.session.create({ data: sessionData(randomUUID()) })).rejects.toMatchObject({ code: 'P2003' });
    });
});
