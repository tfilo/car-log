import { EmailDeliveryStatus } from '../src/email/email-delivery-status';
import { AuthErrorCode } from '../src/auth/auth-errors';
import { ResultKind } from '../src/common/result-kind';
import { UserRole, UserStatus } from '../src/generated/prisma/enums';
import { updateUserProfile } from '../src/auth/profile.server';
import { confirmEmailAddress, requestVerificationForUser, verificationLifetimeMs } from '../src/auth/email-verification.server';
import type { VerificationMessage } from '../src/email/verification-mail.server';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { db } from '../src/db.server';
import { hashPassword } from '../src/auth/password.server';
import * as passwordHelpers from '../src/auth/password.server';
import * as userPasswordHelpers from '../src/auth/user-password.server';
import { loginUser } from '../src/auth/login.server';
import { createSession, revokeSession, sessionLifetimeSeconds, validateSession } from '../src/auth/session.server';

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
            status: UserStatus.ACTIVE
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

test.each(['email', 'username'] as const)('logs in using normalized %s and stores only a hashed session token', async (identifier) => {
    const session = await loginUser({ identifier: ` ${user[identifier].toUpperCase()} `, password }, undefined, database);

    expect(session).not.toBeNull();

    if (!session) throw new Error('Expected session');

    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.user.id).toBe(user.id);
    expect(session.user).not.toHaveProperty('passwordHash');

    const stored = await database.session.findFirstOrThrow();

    expect(stored.tokenHash).toBe(createHash('sha256').update(session.token).digest('hex'));
    expect(stored.tokenHash).not.toBe(session.token);
    expect(Math.abs(stored.expiresAt.getTime() - Date.now() - sessionLifetimeSeconds * 1000)).toBeLessThan(5000);
});

test('unknown users and wrong passwords do expensive work and have the same failure result', async () => {
    const hash = vi.spyOn(passwordHelpers, 'hashPassword');

    expect(await loginUser({ identifier: 'unknown123', password }, undefined, database)).toBeNull();
    expect(hash).toHaveBeenCalledTimes(1);

    const verify = vi.spyOn(passwordHelpers, 'verifyPassword');

    expect(await loginUser({ identifier: user.username, password: 'WrongPassword123!' }, undefined, database)).toBeNull();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(await database.session.count()).toBe(0);
});

test.each([UserStatus.PENDING, UserStatus.BLOCKED] as const)(
    'inactive %s accounts cannot log in and still perform hashing work',
    async (status) => {
        await database.user.update({ where: { id: user.id }, data: { status } });

        const hash = vi.spyOn(passwordHelpers, 'hashPassword');

        expect(await loginUser({ identifier: user.username, password }, undefined, database)).toBeNull();
        expect(hash).toHaveBeenCalledTimes(1);
        expect(await database.session.count()).toBe(0);
    }
);

test('successful login upgrades an old password profile before creating a session', async () => {
    vi.stubEnv('ARGON2_PASSES', '4');
    expect(await loginUser({ identifier: user.email, password }, undefined, database)).not.toBeNull();
    expect((await database.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toContain('t=4');
});

test('login replaces the previous cookie session with a fresh token', async () => {
    const first = await createSession(user.id, user.passwordHash, undefined, database);

    if (!first) throw new Error('Expected session');

    const next = await loginUser({ identifier: user.username, password }, first.token, database);

    expect(next?.token).not.toBe(first.token);
    expect(await validateSession(first.token, database)).toBeNull();
    expect(await database.session.count()).toBe(1);
});

test('regular visits extend expiry and allow a session to outlive its original 14-day period', async () => {
    const session = await createSession(user.id, user.passwordHash, undefined, database);

    if (!session) throw new Error('Expected session');

    const day = 24 * 60 * 60 * 1000;
    const day13 = new Date(session.expiresAt.getTime() - day);
    const renewed = await validateSession(session.token, database, day13);

    expect(renewed?.expiresAt.getTime()).toBe(day13.getTime() + sessionLifetimeSeconds * 1000);
    expect(await validateSession(session.token, database, new Date(day13.getTime() + 2 * day))).not.toBeNull();
});

test('an expired session is deleted and cannot be renewed', async () => {
    const session = await createSession(user.id, user.passwordHash, undefined, database);

    if (!session) throw new Error('Expected session');

    expect(await validateSession(session.token, database, session.expiresAt)).toBeNull();
    expect(await database.session.count()).toBe(0);
});

test('logout revokes immediately and is idempotent', async () => {
    const session = await createSession(user.id, user.passwordHash, undefined, database);

    if (!session) throw new Error('Expected session');

    await revokeSession(session.token, database);
    await revokeSession(session.token, database);
    expect(await validateSession(session.token, database)).toBeNull();
});

test('blocking deletes all sessions immediately and unblocking does not revive old tokens', async () => {
    const first = await createSession(user.id, user.passwordHash, undefined, database);
    const second = await createSession(user.id, user.passwordHash, undefined, database);

    if (!first || !second) throw new Error('Expected sessions');

    await database.user.update({ where: { id: user.id }, data: { status: UserStatus.BLOCKED } });
    expect(await database.session.count()).toBe(0);
    await database.user.update({ where: { id: user.id }, data: { status: UserStatus.ACTIVE } });
    expect(await validateSession(first.token, database)).toBeNull();
    expect(await validateSession(second.token, database)).toBeNull();
});

test('deleting the account revokes its sessions', async () => {
    const session = await createSession(user.id, user.passwordHash, undefined, database);

    if (!session) throw new Error('Expected session');

    await database.user.delete({ where: { id: user.id } });
    expect(await validateSession(session.token, database)).toBeNull();
});

test('concurrent renewal and logout cannot resurrect a deleted session', async () => {
    const session = await createSession(user.id, user.passwordHash, undefined, database);

    if (!session) throw new Error('Expected session');

    await Promise.all([validateSession(session.token, database), revokeSession(session.token, database)]);
    expect(await validateSession(session.token, database)).toBeNull();
});

test('password changes between verification and session creation abort login', async () => {
    const verify = userPasswordHelpers.verifyAndUpgradeUserPassword;

    vi.spyOn(userPasswordHelpers, 'verifyAndUpgradeUserPassword').mockImplementationOnce(async (...args) => {
        const verified = await verify(...args);

        await database.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword('ChangedPassword123!') } });

        return verified;
    });
    expect(await loginUser({ identifier: user.email, password }, undefined, database)).toBeNull();
    expect(await database.session.count()).toBe(0);
});

test('blocking between password verification and session creation aborts login', async () => {
    const verify = userPasswordHelpers.verifyAndUpgradeUserPassword;

    vi.spyOn(userPasswordHelpers, 'verifyAndUpgradeUserPassword').mockImplementationOnce(async (...args) => {
        const verified = await verify(...args);

        await database.user.update({ where: { id: user.id }, data: { status: UserStatus.BLOCKED } });

        return verified;
    });
    expect(await loginUser({ identifier: user.email, password }, undefined, database)).toBeNull();
    expect(await database.session.count()).toBe(0);
});

test('logging out one device leaves another device session valid', async () => {
    const first = await createSession(user.id, user.passwordHash, undefined, database);
    const second = await createSession(user.id, user.passwordHash, undefined, database);

    if (!first || !second) throw new Error('Expected sessions');

    await revokeSession(first.token, database);
    expect(await validateSession(first.token, database)).toBeNull();
    expect(await validateSession(second.token, database)).not.toBeNull();
});

test('invalid tokens do not authenticate', async () => {
    expect(await validateSession('invalid', database)).toBeNull();
    expect(await validateSession('a'.repeat(43), database)).toBeNull();
});

test('profile names are clearable and do not revoke sessions', async () => {
    const session = await createSession(user.id, user.passwordHash, undefined, database);
    const other = await createSession(user.id, user.passwordHash, undefined, database);
    const result = await updateUserProfile(session!.token, { firstName: ' TestFirst ', lastName: 'TestLast' }, database);

    expect(result.result).toMatchObject({ kind: ResultKind.UPDATED, user: { firstName: 'TestFirst', lastName: 'TestLast' } });
    expect(await validateSession(other!.token, database)).not.toBeNull();
    await updateUserProfile(session!.token, { firstName: '', lastName: null, newPassword: '' }, database);
    expect(await database.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
        firstName: null,
        lastName: null,
        email: user.email
    });
});

test.each([{ email: 'changed@example.test' }, { username: 'changed123' }])(
    'sensitive profile updates require current password (%j)',
    async (change) => {
        const session = await createSession(user.id, user.passwordHash, undefined, database);

        expect((await updateUserProfile(session!.token, change, database)).result).toMatchObject({
            code: AuthErrorCode.CURRENT_PASSWORD_REQUIRED
        });
        expect(
            (await updateUserProfile(session!.token, { ...change, currentPassword: 'WrongPassword123!' }, database)).result
        ).toMatchObject({ code: AuthErrorCode.CURRENT_PASSWORD_INVALID });
        expect(await database.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
            email: user.email,
            username: user.username
        });
    }
);

test('combined profile/password update rotates this session, revokes others and verifies the new address', async () => {
    const first = await createSession(user.id, user.passwordHash, undefined, database);
    const second = await createSession(user.id, user.passwordHash, undefined, database);

    await database.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });

    let message: VerificationMessage | undefined;
    const result = await updateUserProfile(
        first!.token,
        {
            firstName: 'TestFirst',
            email: ' CHANGED@example.test ',
            username: 'changed123',
            currentPassword: password,
            newPassword: 'ChangedPassword123!'
        },
        database,
        async (value) => {
            message = value;
        }
    );

    expect(result.result).toMatchObject({
        kind: ResultKind.UPDATED,
        user: { email: 'changed@example.test', username: 'changed123', emailVerifiedAt: null },
        verificationDelivery: EmailDeliveryStatus.SENT
    });
    expect(result.result).not.toHaveProperty('passwordHash');
    expect(result.result).not.toHaveProperty('token');
    expect(await validateSession(first!.token, database)).toBeNull();
    expect(await validateSession(second!.token, database)).toBeNull();

    if (!('sessionToken' in result)) throw new Error('Expected a rotated session');

    expect(await validateSession(result.sessionToken!, database)).not.toBeNull();
    expect(await loginUser({ identifier: 'changed123', password }, undefined, database)).toBeNull();
    expect(await loginUser({ identifier: 'changed@example.test', password: 'ChangedPassword123!' }, undefined, database)).not.toBeNull();
    expect(await confirmEmailAddress(message!.token, database)).toBe(true);
    expect((await database.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
});

test('duplicate identifiers roll back all profile fields, password and session revocation', async () => {
    await database.user.create({ data: { email: 'taken@example.test', username: 'taken123', passwordHash: user.passwordHash } });

    const session = await createSession(user.id, user.passwordHash, undefined, database);
    const outcome = await updateUserProfile(
        session!.token,
        { email: 'taken@example.test', firstName: 'TestFirst', currentPassword: password, newPassword: 'ChangedPassword123!' },
        database
    );

    expect(outcome.result).toMatchObject({ code: AuthErrorCode.IDENTIFIER_ALREADY_EXISTS });
    expect(await database.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
        firstName: null,
        passwordHash: user.passwordHash,
        email: user.email
    });
    expect(await validateSession(session!.token, database)).not.toBeNull();
    expect(await database.emailVerification.count()).toBe(0);
});

test('logout during password verification prevents a profile update', async () => {
    const session = await createSession(user.id, user.passwordHash, undefined, database);
    const verify = passwordHelpers.verifyPassword;

    vi.spyOn(passwordHelpers, 'verifyPassword').mockImplementationOnce(async (...args) => {
        const valid = await verify(...args);

        await revokeSession(session!.token, database);

        return valid;
    });

    const outcome = await updateUserProfile(session!.token, { username: 'changed123', currentPassword: password }, database);

    expect(outcome.result).toMatchObject({ code: AuthErrorCode.AUTH_REQUIRED });
    expect((await database.user.findUniqueOrThrow({ where: { id: user.id } })).username).toBe(user.username);
});

test('a concurrent password change cannot be overwritten by an old password proof', async () => {
    const session = await createSession(user.id, user.passwordHash, undefined, database);
    const verify = passwordHelpers.verifyPassword;
    const changedHash = await hashPassword('OtherPassword123!');

    vi.spyOn(passwordHelpers, 'verifyPassword').mockImplementationOnce(async (...args) => {
        const valid = await verify(...args);

        await database.user.update({ where: { id: user.id }, data: { passwordHash: changedHash } });

        return valid;
    });

    const outcome = await updateUserProfile(session!.token, { newPassword: 'ChangedPassword123!', currentPassword: password }, database);

    expect(outcome.result).toMatchObject({ code: AuthErrorCode.PROFILE_CHANGED });
    expect((await database.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(changedHash);
});

test('SMTP failure reports delivery unavailable after the profile transaction commits', async () => {
    const session = await createSession(user.id, user.passwordHash, undefined, database);
    const outcome = await updateUserProfile(
        session!.token,
        { email: 'changed@example.test', currentPassword: password },
        database,
        async () => {
            throw new Error('Synthetic SMTP failure');
        }
    );

    expect(outcome.result).toMatchObject({ kind: ResultKind.UPDATED, verificationDelivery: EmailDeliveryStatus.UNAVAILABLE });
    expect((await database.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe('changed@example.test');
});

test('email verification is hashed, single-use and does not approve a pending account', async () => {
    await database.user.update({ where: { id: user.id }, data: { status: UserStatus.PENDING } });

    let message: VerificationMessage | undefined;

    expect(
        await requestVerificationForUser(user.id, database, async (value) => {
            message = value;
        })
    ).toMatchObject({ kind: ResultKind.REQUESTED, delivery: EmailDeliveryStatus.SENT });

    const record = await database.emailVerification.findUniqueOrThrow({ where: { userId: user.id } });

    expect(record.tokenHash).toBe(createHash('sha256').update(message!.token).digest('hex'));
    expect(record.tokenHash).not.toBe(message!.token);
    expect(await confirmEmailAddress(message!.token, database)).toBe(true);
    expect(await confirmEmailAddress(message!.token, database)).toBe(false);
    expect(await database.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
        status: UserStatus.PENDING,
        role: UserRole.USER,
        emailVerifiedAt: expect.any(Date)
    });
    expect(await requestVerificationForUser(user.id, database)).toEqual({ kind: ResultKind.ALREADY_VERIFIED });
});

test('resend immediately replaces previous verification links', async () => {
    const messages: VerificationMessage[] = [];

    const sender = async (value: VerificationMessage) => {
        messages.push(value);
    };

    const now = new Date();

    await requestVerificationForUser(user.id, database, sender, now);
    await requestVerificationForUser(user.id, database, sender, now);
    expect(messages).toHaveLength(2);
    expect(await confirmEmailAddress(messages[0].token, database)).toBe(false);
    expect(await confirmEmailAddress(messages[1].token, database)).toBe(true);
});

test('expired tokens fail and deleting a user cascades verification records', async () => {
    let message: VerificationMessage | undefined;

    await requestVerificationForUser(user.id, database, async (value) => {
        message = value;
    });
    expect(await confirmEmailAddress(message!.token, database, new Date(Date.now() + verificationLifetimeMs))).toBe(false);
    expect(await database.emailVerification.count()).toBe(0);
    await requestVerificationForUser(user.id, database, async () => {});
    await database.user.delete({ where: { id: user.id } });
    expect(await database.emailVerification.count()).toBe(0);
});

test('changing an address invalidates its prior verification link', async () => {
    let oldMessage: VerificationMessage | undefined;
    let newMessage: VerificationMessage | undefined;

    await requestVerificationForUser(user.id, database, async (value) => {
        oldMessage = value;
    });

    const session = await createSession(user.id, user.passwordHash, undefined, database);

    await updateUserProfile(session!.token, { email: 'changed@example.test', currentPassword: password }, database, async (value) => {
        newMessage = value;
    });
    expect(await confirmEmailAddress(oldMessage!.token, database)).toBe(false);
    expect(await confirmEmailAddress(newMessage!.token, database)).toBe(true);
});
