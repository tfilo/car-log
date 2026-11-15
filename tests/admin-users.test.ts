import { UserErrorCode } from '../src/users/user-errors';
import { UserAction } from '../src/users/user-action';
import { AuthErrorCode } from '../src/auth/auth-errors';
import { ResultKind } from '../src/common/result-kind';
import { UserRole, UserStatus } from '../src/generated/prisma/enums';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { db } from '../src/db.server';
import { createSession, validateSession } from '../src/auth/session.server';
import { deleteOwnUserAccount, listManagedUsers, manageUserAccount } from '../src/users/users.server';

type ManageUserInput = Parameters<typeof manageUserAccount>[1];

const databaseName = `car_log_test_${randomUUID().replaceAll('-', '')}`;
let database: PrismaClient;
let created = false;
let admin: Awaited<ReturnType<typeof makeUser>>;
let target: Awaited<ReturnType<typeof makeUser>>;
let adminToken: string;

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

async function makeUser(role: UserRole = UserRole.USER, status: UserStatus = UserStatus.ACTIVE) {
    const unique = randomUUID().replaceAll('-', '');

    return database.user.create({
        data: { email: `${unique}@example.test`, username: unique.slice(0, 30), passwordHash: 'test-only-placeholder', role, status }
    });
}

async function sessionFor(user: { id: string; passwordHash: string }): Promise<string> {
    const session = await createSession(user.id, user.passwordHash, undefined, database);

    if (!session) throw new Error('Expected active fixture session');

    return session.token;
}

beforeEach(async () => {
    await database.user.deleteMany();
    admin = await makeUser(UserRole.ADMIN);
    target = await makeUser(UserRole.USER, UserStatus.PENDING);
    adminToken = await sessionFor(admin);
});

afterAll(async () => {
    await database?.$disconnect();

    if (created) await db.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);

    await db.$disconnect();
});

test('anonymous callers cannot list or modify accounts', async () => {
    expect((await listManagedUsers(undefined, undefined, database)).result).toEqual({
        kind: ResultKind.ERROR,
        code: AuthErrorCode.AUTH_REQUIRED
    });
    expect((await manageUserAccount(undefined, { action: UserAction.BLOCK, userId: target.id }, database)).result).toEqual({
        kind: ResultKind.ERROR,
        code: AuthErrorCode.AUTH_REQUIRED
    });
    expect((await deleteOwnUserAccount(undefined, { confirmation: target.username }, database)).result).toEqual({
        kind: ResultKind.ERROR,
        code: AuthErrorCode.AUTH_REQUIRED
    });
});

test('ordinary users cannot list users or modify/delete another account', async () => {
    const ordinary = await makeUser();
    const token = await sessionFor(ordinary);

    expect((await listManagedUsers(token, undefined, database)).result).toEqual({
        kind: ResultKind.ERROR,
        code: AuthErrorCode.ADMIN_REQUIRED
    });

    for (const command of [
        { action: UserAction.BLOCK, userId: admin.id },
        { action: UserAction.DELETE, userId: target.id, confirmation: target.username },
        { action: UserAction.SET_ROLE, userId: ordinary.id, role: UserRole.ADMIN }
    ] satisfies ManageUserInput[]) {
        expect((await manageUserAccount(token, command, database)).result).toEqual({
            kind: ResultKind.ERROR,
            code: AuthErrorCode.ADMIN_REQUIRED
        });
    }

    expect(await database.user.count()).toBe(3);
    expect((await database.user.findUniqueOrThrow({ where: { id: ordinary.id } })).role).toBe(UserRole.USER);
});

test('admin lists are paginated and never contain password or session secrets', async () => {
    const outcome = await listManagedUsers(adminToken, { page: 0, pageSize: 1 }, database);

    expect(outcome.result.kind).toBe(ResultKind.USERS);

    if (outcome.result.kind !== ResultKind.USERS) throw new Error('Expected users');

    expect(outcome.result.total).toBe(2);
    expect(outcome.result.page).toBe(0);
    expect(outcome.result.users.map((user) => user.id)).toEqual([target.id]);

    const second = await listManagedUsers(adminToken, { page: 1, pageSize: 1 }, database);

    expect(second.result).toMatchObject({ kind: ResultKind.USERS, page: 1, total: 2, users: [{ id: admin.id }] });

    const beyond = await listManagedUsers(adminToken, { page: 2, pageSize: 1 }, database);

    expect(beyond.result).toMatchObject({ kind: ResultKind.USERS, page: 2, total: 2, users: [] });

    const defaults = await listManagedUsers(adminToken, undefined, database);

    expect(defaults.result).toMatchObject({ kind: ResultKind.USERS, page: 0, pageSize: 25 });

    for (const user of outcome.result.users) {
        expect(user).not.toHaveProperty('passwordHash');
        expect(user).not.toHaveProperty('sessions');
        expect(user).not.toHaveProperty('tokenHash');
    }
});

test('pending registrations can be approved, but an active account cannot be approved again', async () => {
    const command: ManageUserInput = { action: UserAction.APPROVE, userId: target.id };

    expect((await manageUserAccount(adminToken, command, database)).result.kind).toBe(ResultKind.UPDATED);
    expect((await database.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe(UserStatus.ACTIVE);
    expect((await manageUserAccount(adminToken, command, database)).result).toEqual({
        kind: ResultKind.ERROR,
        code: UserErrorCode.ADMIN_INVALID_TRANSITION
    });
});

test('blocking revokes sessions and unblocking does not revive them', async () => {
    await database.user.update({ where: { id: target.id }, data: { status: UserStatus.ACTIVE } });

    const token = await sessionFor(target);

    await manageUserAccount(adminToken, { action: UserAction.BLOCK, userId: target.id }, database);
    expect(await database.session.count({ where: { userId: target.id } })).toBe(0);
    await manageUserAccount(adminToken, { action: UserAction.UNBLOCK, userId: target.id }, database);
    expect(await validateSession(token, database)).toBeNull();
    expect((await database.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe(UserStatus.ACTIVE);
});

test('deletion requires the exact username and deletes the account and sessions', async () => {
    await database.user.update({ where: { id: target.id }, data: { status: UserStatus.ACTIVE } });
    await sessionFor(target);
    expect(
        (await manageUserAccount(adminToken, { action: UserAction.DELETE, userId: target.id, confirmation: 'wrong' }, database)).result
    ).toEqual({
        kind: ResultKind.ERROR,
        code: UserErrorCode.ACCOUNT_CONFIRMATION_MISMATCH
    });
    expect(
        (await manageUserAccount(adminToken, { action: UserAction.DELETE, userId: target.id, confirmation: target.username }, database))
            .result.kind
    ).toBe(ResultKind.DELETED);
    expect(await database.user.findUnique({ where: { id: target.id } })).toBeNull();
    expect(await database.session.count({ where: { userId: target.id } })).toBe(0);
});

test.each([UserAction.BLOCK, UserAction.DELETE, UserAction.SET_ROLE] as const)(
    'cannot remove the last active administrator with %s',
    async (action) => {
        const command: ManageUserInput =
            action === UserAction.DELETE
                ? { action, userId: admin.id, confirmation: admin.username }
                : action === UserAction.SET_ROLE
                  ? { action, userId: admin.id, role: UserRole.USER }
                  : { action, userId: admin.id };

        expect((await manageUserAccount(adminToken, command, database)).result).toEqual({
            kind: ResultKind.ERROR,
            code: UserErrorCode.ADMIN_LAST_ACTIVE
        });
        expect(await database.user.count({ where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE } })).toBe(1);
    }
);

test('inactive administrators do not count as available administrators', async () => {
    await database.user.update({ where: { id: target.id }, data: { role: UserRole.ADMIN } });
    expect((await manageUserAccount(adminToken, { action: UserAction.BLOCK, userId: admin.id }, database)).result).toEqual({
        kind: ResultKind.ERROR,
        code: UserErrorCode.ADMIN_LAST_ACTIVE
    });
});

test.each([UserAction.BLOCK, UserAction.DELETE, UserAction.SET_ROLE] as const)(
    'concurrent self-%s requests preserve an active administrator',
    async (action) => {
        const second = await makeUser(UserRole.ADMIN);
        const secondToken = await sessionFor(second);

        const command = (user: typeof admin): ManageUserInput =>
            action === UserAction.DELETE
                ? { action, userId: user.id, confirmation: user.username }
                : action === UserAction.SET_ROLE
                  ? { action, userId: user.id, role: UserRole.USER }
                  : { action, userId: user.id };

        const results = await Promise.all([
            manageUserAccount(adminToken, command(admin), database),
            manageUserAccount(secondToken, command(second), database)
        ]);

        expect(results.filter((result) => result.result.kind === ResultKind.ERROR)).toHaveLength(1);
        expect(await database.user.count({ where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE } })).toBe(1);
    }
);

test('role changes take effect on existing sessions and cannot be bypassed with a stale admin session', async () => {
    const second = await makeUser(UserRole.ADMIN);
    const token = await sessionFor(second);

    await manageUserAccount(adminToken, { action: UserAction.SET_ROLE, userId: second.id, role: UserRole.USER }, database);
    expect((await listManagedUsers(token, undefined, database)).result).toEqual({
        kind: ResultKind.ERROR,
        code: AuthErrorCode.ADMIN_REQUIRED
    });
});

test('a regular user can delete only their own account with confirmation', async () => {
    const ordinary = await makeUser();
    const token = await sessionFor(ordinary);

    expect((await deleteOwnUserAccount(token, { confirmation: target.username }, database)).result).toEqual({
        kind: ResultKind.ERROR,
        code: UserErrorCode.ACCOUNT_CONFIRMATION_MISMATCH
    });

    const result = await deleteOwnUserAccount(token, { confirmation: ordinary.username }, database);

    expect(result.result).toEqual({ kind: ResultKind.DELETED, userId: ordinary.id });
    expect(result.clearSession).toBe(true);
    expect(await database.user.findUnique({ where: { id: ordinary.id } })).toBeNull();
    expect(await database.user.findUnique({ where: { id: target.id } })).not.toBeNull();
    expect(await validateSession(token, database)).toBeNull();
});

test('the last administrator cannot bypass protection through self-deletion', async () => {
    expect((await deleteOwnUserAccount(adminToken, { confirmation: admin.username }, database)).result).toEqual({
        kind: ResultKind.ERROR,
        code: UserErrorCode.ADMIN_LAST_ACTIVE
    });
});

test('an administrator can delete their own account when another active admin remains', async () => {
    await makeUser(UserRole.ADMIN);

    const outcome = await deleteOwnUserAccount(adminToken, { confirmation: admin.username }, database);

    expect(outcome.result.kind).toBe(ResultKind.DELETED);
    expect(outcome.clearSession).toBe(true);
    expect(await database.user.count({ where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE } })).toBe(1);
});

test('expired sessions cannot perform admin operations', async () => {
    await database.session.updateMany({ where: { userId: admin.id }, data: { expiresAt: new Date(0) } });
    expect((await listManagedUsers(adminToken, undefined, database)).result).toEqual({
        kind: ResultKind.ERROR,
        code: AuthErrorCode.AUTH_REQUIRED
    });
});

test('missing targets are disclosed only to authorized administrators', async () => {
    expect((await manageUserAccount(adminToken, { action: UserAction.BLOCK, userId: randomUUID() }, database)).result).toEqual({
        kind: ResultKind.ERROR,
        code: UserErrorCode.ADMIN_USER_NOT_FOUND
    });
});
