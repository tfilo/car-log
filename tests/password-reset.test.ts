import { UserRole, UserStatus } from '../src/generated/prisma/enums';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { db } from '../src/db.server';
import { hashPassword, verifyPassword } from '../src/auth/password.server';
import * as passwordHelpers from '../src/auth/password.server';
import { createSession, validateSession, tokenHash } from '../src/auth/session.server';
import { loginUser } from '../src/auth/login.server';
import {
    completePasswordReset,
    requestPasswordResetForIdentifier,
    passwordResetLifetimeMs,
    startPasswordResetRequest
} from '../src/auth/password-reset.server';
import { requestVerificationForUser } from '../src/auth/email-verification.server';
import type { VerificationMessage, VerificationSender } from '../src/email/verification-mail.server';

const databaseName = `car_log_test_${randomUUID().replaceAll('-', '')}`;
let database: PrismaClient;
let created = false;
let user: { id: string; email: string; username: string; passwordHash: string };
const password = 'Password123!';

beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);

    url.pathname = `/${databaseName}`;
    await db.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    created = true;
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url.href },
        stdio: 'pipe'
    });
    database = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.href }) });
}, 30_000);

beforeEach(async () => {
    await database.user.deleteMany();

    const unique = randomUUID().replaceAll('-', '');

    user = await database.user.create({
        data: {
            email: `${unique}@example.test`,
            username: unique.slice(0, 30),
            passwordHash: await hashPassword(password),
            status: UserStatus.ACTIVE,
            emailVerifiedAt: new Date()
        }
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

afterAll(async () => {
    await database?.$disconnect();

    if (created) await db.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);

    await db.$disconnect();
});

async function requestReset(now = new Date()) {
    let message: VerificationMessage | undefined;

    await requestPasswordResetForIdentifier(
        { identifier: user.email },
        database,
        async (value) => {
            message = value;
        },
        now
    );

    if (!message) throw new Error('Expected a reset email');

    return message;
}

test.each(['email', 'username'] as const)('requests a reset using normalized %s and stores only a token hash', async (field) => {
    const sender = vi.fn<VerificationSender>(async () => {});

    expect(await requestPasswordResetForIdentifier({ identifier: ` ${user[field].toUpperCase()} ` }, database, sender)).toBeUndefined();
    expect(sender).toHaveBeenCalledTimes(1);

    const message = sender.mock.calls[0][0];
    const reset = await database.passwordReset.findUniqueOrThrow({ where: { userId: user.id } });

    expect(message.email).toBe(user.email);
    expect(message.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(reset.tokenHash).toBe(tokenHash(message.token));
    expect(reset.tokenHash).not.toBe(message.token);
    expect(reset.expiresAt.getTime() - reset.createdAt.getTime()).toBe(passwordResetLifetimeMs);
});

test.each(['missing', 'unverified', UserStatus.PENDING, UserStatus.BLOCKED] as const)(
    'ineligible %s requests have the same result without sending mail',
    async (scenario) => {
        let identifier = user.email;

        if (scenario === 'missing') identifier = 'missing@example.test';
        else if (scenario === 'unverified') await database.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
        else await database.user.update({ where: { id: user.id }, data: { status: scenario } });

        const sender = vi.fn(async () => {});

        expect(await requestPasswordResetForIdentifier({ identifier }, database, sender)).toBeUndefined();
        expect(sender).not.toHaveBeenCalled();
        expect(await database.passwordReset.count()).toBe(0);
    }
);

test('SMTP failure does not reveal account existence or change the password', async () => {
    expect(
        await requestPasswordResetForIdentifier({ identifier: user.email }, database, async () => {
            throw new Error('Synthetic SMTP failure');
        })
    ).toBeUndefined();
    expect((await database.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(user.passwordHash);
});

test('reset changes password atomically, consumes the token and revokes every device session', async () => {
    const first = await createSession(user.id, user.passwordHash, undefined, database);
    const second = await createSession(user.id, user.passwordHash, undefined, database);
    const message = await requestReset();

    expect(await completePasswordReset({ token: message.token, newPassword: 'NewPassword123!' }, database)).toBe(true);
    expect(await completePasswordReset({ token: message.token, newPassword: 'AnotherPassword123!' }, database)).toBe(false);
    expect(await database.passwordReset.count()).toBe(0);
    expect(await validateSession(first!.token, database)).toBeNull();
    expect(await validateSession(second!.token, database)).toBeNull();
    expect(await loginUser({ identifier: user.username, password }, undefined, database)).toBeNull();
    expect(await loginUser({ identifier: user.username, password: 'NewPassword123!' }, undefined, database)).not.toBeNull();
    expect(await database.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
        email: user.email,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: expect.any(Date)
    });
});

test('simultaneous reset submissions can consume a token only once', async () => {
    const message = await requestReset();
    const results = await Promise.all([
        completePasswordReset({ token: message.token, newPassword: 'FirstPassword123!' }, database),
        completePasswordReset({ token: message.token, newPassword: 'SecondPassword123!' }, database)
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);

    const stored = await database.user.findUniqueOrThrow({ where: { id: user.id } });

    expect(await verifyPassword(results[0] ? 'FirstPassword123!' : 'SecondPassword123!', stored.passwordHash)).toBe(true);
});

test('expired and unknown tokens cannot reset a password or revoke sessions', async () => {
    const session = await createSession(user.id, user.passwordHash, undefined, database);
    const now = new Date();
    const message = await requestReset(now);

    expect(
        await completePasswordReset(
            { token: message.token, newPassword: 'NewPassword123!' },
            database,
            new Date(now.getTime() + passwordResetLifetimeMs)
        )
    ).toBe(false);
    expect(await completePasswordReset({ token: 'A'.repeat(43), newPassword: 'NewPassword123!' }, database)).toBe(false);
    expect((await database.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(user.passwordHash);
    expect(await validateSession(session!.token, database)).not.toBeNull();
});

test('resending by username immediately replaces a link requested by email', async () => {
    const now = new Date();
    const first = await requestReset(now);
    const sender = vi.fn<VerificationSender>(async () => {});

    await requestPasswordResetForIdentifier({ identifier: user.username }, database, sender, now);
    expect(sender).toHaveBeenCalledOnce();

    const second = await requestReset(now);

    expect(await completePasswordReset({ token: first.token, newPassword: 'NewPassword123!' }, database)).toBe(false);
    expect(await completePasswordReset({ token: second.token, newPassword: 'NewPassword123!' }, database)).toBe(true);
});

test.each(['password', 'email', 'username', 'status', 'verification'])('changing %s invalidates links permanently', async (change) => {
    const message = await requestReset();
    const where = { id: user.id };

    if (change === 'password') await database.user.update({ where, data: { passwordHash: await hashPassword('ChangedPassword123!') } });

    if (change === 'email') {
        await database.user.update({ where, data: { email: 'changed@example.test' } });
        await database.user.update({ where, data: { email: user.email } });
    }

    if (change === 'username') {
        await database.user.update({ where, data: { username: 'changed123' } });
        await database.user.update({ where, data: { username: user.username } });
    }

    if (change === 'status') {
        await database.user.update({ where, data: { status: UserStatus.BLOCKED } });
        await database.user.update({ where, data: { status: UserStatus.ACTIVE } });
    }

    if (change === 'verification') {
        await database.user.update({ where, data: { emailVerifiedAt: null } });
        await database.user.update({ where, data: { emailVerifiedAt: new Date() } });
    }

    expect(await database.passwordReset.count()).toBe(0);
    expect(await completePasswordReset({ token: message.token, newPassword: 'NewPassword123!' }, database)).toBe(false);
});

test('reset rechecks expiry and account eligibility after hashing', async () => {
    const message = await requestReset();
    const hash = passwordHelpers.hashPassword;

    vi.spyOn(passwordHelpers, 'hashPassword').mockImplementationOnce(async (value) => {
        const result = await hash(value);

        await database.passwordReset.updateMany({ data: { expiresAt: new Date(0) } });

        return result;
    });
    expect(await completePasswordReset({ token: message.token, newPassword: 'NewPassword123!' }, database)).toBe(false);
    expect((await database.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(user.passwordHash);
});

test('blocking during hashing aborts reset and cannot overwrite the old hash', async () => {
    const message = await requestReset();
    const hash = passwordHelpers.hashPassword;

    vi.spyOn(passwordHelpers, 'hashPassword').mockImplementationOnce(async (value) => {
        const result = await hash(value);

        await database.user.update({ where: { id: user.id }, data: { status: UserStatus.BLOCKED } });

        return result;
    });
    expect(await completePasswordReset({ token: message.token, newPassword: 'NewPassword123!' }, database)).toBe(false);
    expect((await database.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(user.passwordHash);
});

test('hashing failures leave password, token and sessions unchanged', async () => {
    const session = await createSession(user.id, user.passwordHash, undefined, database);
    const message = await requestReset();

    vi.stubEnv('PASSWORD_PEPPER', 'invalid');
    await expect(completePasswordReset({ token: message.token, newPassword: 'NewPassword123!' }, database)).rejects.toThrow();
    expect((await database.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(user.passwordHash);
    expect(await database.passwordReset.count()).toBe(1);
    expect(await validateSession(session!.token, database)).not.toBeNull();
});

test('verification tokens cannot reset passwords and account deletion cascades reset records', async () => {
    await database.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });

    let verification: VerificationMessage | undefined;

    await requestVerificationForUser(user.id, database, async (value) => {
        verification = value;
    });
    expect(await completePasswordReset({ token: verification!.token, newPassword: 'NewPassword123!' }, database)).toBe(false);
    await database.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    await requestReset();
    await database.user.delete({ where: { id: user.id } });
    expect(await database.passwordReset.count()).toBe(0);
});

test('background requests return before SMTP completes', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    const sender = vi.fn(() => pending);
    const input = { identifier: user.email };
    const first = startPasswordResetRequest(input, database, sender);
    const second = startPasswordResetRequest(input, database, sender);

    expect(first).toBeInstanceOf(Promise);
    expect(second).toBeInstanceOf(Promise);
    const third = startPasswordResetRequest(input, database, sender);

    try {
        await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(3));
    } finally {
        release();
        await Promise.all([first, second, third]);
    }

    const final = startPasswordResetRequest(input, database, sender);

    expect(final).toBeInstanceOf(Promise);
    await final;
});
