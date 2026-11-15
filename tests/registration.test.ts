import { ResultKind } from '../src/common/result-kind';
import { UserRole, UserStatus } from '../src/generated/prisma/enums';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { db } from '../src/db.server';
import { registerUser } from '../src/auth/registration.server';

const databaseName = `car_log_test_${randomUUID().replaceAll('-', '')}`;
let isolated: PrismaClient;
let created = false;

beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);

    url.pathname = `/${databaseName}`;
    // This suite creates and removes only its own randomly named database.
    await db.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    created = true;
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url.href },
        stdio: 'pipe'
    });
    isolated = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.href }) });
}, 30_000);

beforeEach(async () => {
    await isolated.user.deleteMany();
    await isolated.registrationState.upsert({
        where: { id: 1 },
        create: { id: 1 },
        update: { completedAt: null }
    });
});

afterAll(async () => {
    await isolated?.$disconnect();

    if (created) await db.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);

    await db.$disconnect();
});

function input() {
    const unique = randomUUID().replaceAll('-', '');

    return { email: `${unique}@example.test`, username: unique.slice(0, 30), password: 'Password123' };
}

test('registers the first user as ACTIVE ADMIN and later users as PENDING USER', async () => {
    const first = input();
    const later = input();

    expect(await registerUser(first, isolated)).toEqual({ kind: ResultKind.CREATED, status: UserStatus.ACTIVE });
    expect(await registerUser(later, isolated)).toEqual({ kind: ResultKind.CREATED, status: UserStatus.PENDING });

    const admin = await isolated.user.findUniqueOrThrow({ where: { email: first.email } });
    const user = await isolated.user.findUniqueOrThrow({ where: { email: later.email } });

    expect(admin.role).toBe(UserRole.ADMIN);
    expect(user.role).toBe(UserRole.USER);
    expect(admin.passwordHash).toMatch(/^\$argon2id\$/);
    expect(admin.passwordHash).not.toContain(first.password);
    expect(await isolated.session.count()).toBe(0);
});

test('simultaneous first registrations create exactly one active administrator', async () => {
    const results = await Promise.all([registerUser(input(), isolated), registerUser(input(), isolated)]);

    expect(results).toContainEqual({ kind: ResultKind.CREATED, status: UserStatus.ACTIVE });
    expect(results).toContainEqual({ kind: ResultKind.CREATED, status: UserStatus.PENDING });
    expect(await isolated.user.count({ where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE } })).toBe(1);
});

test('does not reopen administrator provisioning after deleting every user', async () => {
    await registerUser(input(), isolated);
    await isolated.user.deleteMany();
    expect(await registerUser(input(), isolated)).toEqual({ kind: ResultKind.CREATED, status: UserStatus.PENDING });
    expect(await isolated.user.count({ where: { role: UserRole.ADMIN } })).toBe(0);
});

test('duplicate identifiers are rejected after normalization, without leaking hashes', async () => {
    const first = input();

    await registerUser(first, isolated);
    expect(await registerUser({ ...input(), email: ` ${first.email.toUpperCase()} ` }, isolated)).toEqual({ kind: ResultKind.DUPLICATE });
    expect(await registerUser({ ...input(), username: first.username }, isolated)).toEqual({ kind: ResultKind.DUPLICATE });
    expect(await isolated.user.count()).toBe(1);
});

test('a concurrent duplicate registration creates only one account', async () => {
    const data = input();
    const results = await Promise.all([registerUser(data, isolated), registerUser(data, isolated)]);

    expect(results).toContainEqual({ kind: ResultKind.CREATED, status: UserStatus.ACTIVE });
    expect(results).toContainEqual({ kind: ResultKind.DUPLICATE });
    expect(await isolated.user.count()).toBe(1);
});

test('existing users outside registration prevent a new automatic administrator', async () => {
    const profile = input();

    await isolated.user.create({ data: { email: profile.email, username: profile.username, passwordHash: 'test-only-placeholder' } });
    expect(await registerUser(input(), isolated)).toEqual({ kind: ResultKind.CREATED, status: UserStatus.PENDING });
    expect((await isolated.registrationState.findUniqueOrThrow({ where: { id: 1 } })).completedAt).not.toBeNull();
});

test('rejects invalid input and supplied privileges without claiming bootstrap', async () => {
    // @ts-expect-error Intentionally inject a forbidden field to test runtime validation.
    await expect(registerUser({ ...input(), role: UserRole.ADMIN }, isolated)).rejects.toThrow();
    await expect(registerUser({ ...input(), password: 'weak' }, isolated)).rejects.toThrow();
    expect(await isolated.user.count()).toBe(0);
    expect((await isolated.registrationState.findUniqueOrThrow({ where: { id: 1 } })).completedAt).toBeNull();
});

test('a missing pepper cannot create an account or claim the administrator bootstrap', async () => {
    vi.stubEnv('PASSWORD_PEPPER', undefined);

    try {
        await expect(registerUser(input(), isolated)).rejects.toThrow('Set PASSWORD_PEPPER');
        expect(await isolated.user.count()).toBe(0);
        expect((await isolated.registrationState.findUniqueOrThrow({ where: { id: 1 } })).completedAt).toBeNull();
    } finally {
        vi.unstubAllEnvs();
    }
});

test('missing bootstrap state fails closed without creating an account', async () => {
    await isolated.registrationState.deleteMany();
    await expect(registerUser(input(), isolated)).rejects.toThrow('bootstrap state is missing');
    expect(await isolated.user.count()).toBe(0);
});
