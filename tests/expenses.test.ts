import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { FuelType, UserRole, UserStatus } from '../src/generated/prisma/enums';
import { db } from '../src/db.server';
import { createSession } from '../src/auth/session.server';
import { deleteOwnUserAccount } from '../src/users/users.server';
import { AuthErrorCode } from '../src/auth/auth-errors';
import { ResultKind } from '../src/common/result-kind';
import { ExpenseErrorCode } from '../src/expenses/expense-errors';
import { createOwnedCategory, updateOwnedCategory, deleteOwnedCategory, listOwnedCategories } from '../src/expenses/categories.server';
import {
    createOwnedExpense,
    updateOwnedExpense,
    getOwnedExpense,
    listOwnedExpenses,
    deleteOwnedExpense
} from '../src/expenses/expenses.server';

const databaseName = `car_log_expenses_${randomUUID().replaceAll('-', '')}`;
let database: PrismaClient;
let created = false;
let owner: { id: string; username: string; token: string };
let stranger: { id: string; username: string; token: string };
let vehicleId: string;
let categoryId: string;

async function account(role: UserRole = UserRole.USER) {
    const username = `expense${randomUUID().replaceAll('-', '').slice(0, 14)}`;
    const passwordHash = 'synthetic-not-used-for-login';
    const user = await database.user.create({
        data: { username, email: `${username}@example.test`, passwordHash, status: UserStatus.ACTIVE, role }
    });
    const session = await createSession(user.id, passwordHash, undefined, database);

    if (!session) throw new Error('Expected active synthetic session.');

    return { id: user.id, username, token: session.token };
}

function input() {
    return {
        vehicleId,
        categoryId,
        occurredAt: '2026-07-15T12:00:00.123Z',
        odometer: 12000.125,
        totalPrice: 123.45,
        comment: 'Synthetic service'
    };
}

async function create() {
    const outcome = await createOwnedExpense(owner.token, input(), database);

    if (outcome.result.kind !== ResultKind.CREATED) throw new Error('Expected expense.');

    return outcome.result.expense;
}

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
    owner = await account();
    stranger = await account(UserRole.ADMIN);

    const vehicle = await database.vehicle.create({
        data: { userId: owner.id, manufacturer: 'Synthetic', model: 'Expense', fuelTypes: [FuelType.PETROL] }
    });
    const category = await createOwnedCategory(owner.token, { name: 'Service' }, database);

    if (category.result.kind !== ResultKind.CREATED) throw new Error('Expected category.');

    vehicleId = vehicle.id;
    categoryId = category.result.category.id;
});

afterAll(async () => {
    await database?.$disconnect();
    if (created) await db.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await db.$disconnect();
});

test('categories trim names and reserve case-insensitive names across archived and concurrent registrations', async () => {
    const attempts = await Promise.all([
        createOwnedCategory(owner.token, { name: '  Tires  ' }, database),
        createOwnedCategory(owner.token, { name: 'tires' }, database)
    ]);

    expect(attempts.filter((item) => item.result.kind === ResultKind.CREATED)).toHaveLength(1);
    expect(attempts.filter((item) => 'code' in item.result && item.result.code === ExpenseErrorCode.CATEGORY_DUPLICATE)).toHaveLength(1);

    const archived = await updateOwnedCategory(owner.token, { categoryId, name: 'Service', isArchived: true }, database);

    expect(archived.result.kind).toBe(ResultKind.UPDATED);
    expect((await createOwnedCategory(owner.token, { name: ' service ' }, database)).result).toMatchObject({
        code: ExpenseErrorCode.CATEGORY_DUPLICATE
    });
    expect((await createOwnedCategory(stranger.token, { name: 'service' }, database)).result.kind).toBe(ResultKind.CREATED);
    await expect(database.expenseCategory.create({ data: { userId: owner.id, name: 'SERVICE' } })).rejects.toThrow();
});

test('category renames affect history; archived categories can be retained but not newly assigned', async () => {
    const expense = await create();

    await updateOwnedCategory(owner.token, { categoryId, name: 'Corrected service', isArchived: true }, database);
    const read = await getOwnedExpense(owner.token, { expenseId: expense.id }, database);

    expect(read.result).toMatchObject({ kind: ResultKind.EXPENSE, expense: { categoryName: 'Corrected service', categoryArchived: true } });
    expect((await createOwnedExpense(owner.token, input(), database)).result).toMatchObject({ code: ExpenseErrorCode.CATEGORY_ARCHIVED });
    expect(
        (await updateOwnedExpense(owner.token, { ...input(), expenseId: expense.id, comment: 'Edited', odometer: 0 }, database)).result.kind
    ).toBe(ResultKind.UPDATED);

    const active = await createOwnedCategory(owner.token, { name: 'Brakes' }, database);
    if (active.result.kind !== ResultKind.CREATED) throw new Error('Expected category.');

    const another = await createOwnedExpense(owner.token, { ...input(), categoryId: active.result.category.id }, database);
    if (another.result.kind !== ResultKind.CREATED) throw new Error('Expected expense.');

    expect((await updateOwnedExpense(owner.token, { ...input(), expenseId: another.result.expense.id }, database)).result).toMatchObject({
        code: ExpenseErrorCode.CATEGORY_ARCHIVED
    });
    expect((await listOwnedCategories(owner.token, { includeArchived: false }, database)).result).toMatchObject({ total: 1 });
    expect((await listOwnedExpenses(owner.token, { vehicleId, categoryId }, database)).result).toMatchObject({ total: 1 });
    await updateOwnedCategory(owner.token, { categoryId, name: 'Corrected service', isArchived: false }, database);
    expect((await createOwnedExpense(owner.token, input(), database)).result.kind).toBe(ResultKind.CREATED);
});

test('expenses preserve exact decimal amounts and allow repeated timestamps/odometers and retrospective entries', async () => {
    const first = await create();
    const repeated = await create();
    const earlier = await createOwnedExpense(
        owner.token,
        { ...input(), occurredAt: '2020-01-01T00:00:00Z', odometer: 99999, totalPrice: 0.1 },
        database
    );

    expect(first).toMatchObject({ totalPrice: 123.45, odometer: 12000.125, occurredAt: input().occurredAt });
    expect(earlier.result).toMatchObject({ kind: ResultKind.CREATED, expense: { totalPrice: 0.1 } });
    expect(
        (await updateOwnedExpense(owner.token, { ...input(), expenseId: first.id, totalPrice: 99999999.99, comment: '   ' }, database))
            .result
    ).toMatchObject({
        kind: ResultKind.UPDATED,
        expense: { totalPrice: 99999999.99, comment: null }
    });
    const page = await listOwnedExpenses(owner.token, { vehicleId, page: 1, pageSize: 2 }, database);

    expect(page.result).toMatchObject({
        kind: ResultKind.EXPENSES,
        total: 3,
        page: 1,
        expenses: [{ occurredAt: '2020-01-01T00:00:00.000Z' }]
    });
    expect((await deleteOwnedExpense(owner.token, { expenseId: repeated.id, confirmed: true }, database)).result.kind).toBe(
        ResultKind.DELETED
    );
});

test('categories are shared across owned vehicles; category deletion checks references across all vehicles', async () => {
    const secondVehicle = await database.vehicle.create({
        data: { userId: owner.id, manufacturer: 'Synthetic', model: 'Second', fuelTypes: [FuelType.DIESEL] }
    });
    const expense = await createOwnedExpense(owner.token, { ...input(), vehicleId: secondVehicle.id }, database);

    if (expense.result.kind !== ResultKind.CREATED) throw new Error('Expected expense.');

    expect((await deleteOwnedCategory(owner.token, { categoryId, confirmed: true }, database)).result).toMatchObject({
        code: ExpenseErrorCode.CATEGORY_IN_USE
    });
    await expect(database.expenseCategory.delete({ where: { id: categoryId } })).rejects.toThrow();
    await deleteOwnedExpense(owner.token, { expenseId: expense.result.expense.id, confirmed: true }, database);
    expect((await deleteOwnedCategory(owner.token, { categoryId, confirmed: true }, database)).result.kind).toBe(ResultKind.DELETED);
});

test('administrators cannot read or mutate another user expenses/categories or assign their categories', async () => {
    const expense = await create();
    const foreignCategory = await database.expenseCategory.create({ data: { userId: stranger.id, name: 'Private' } });
    const foreignVehicle = await database.vehicle.create({
        data: { userId: stranger.id, manufacturer: 'Synthetic', model: 'Private', fuelTypes: [FuelType.PETROL] }
    });

    expect((await getOwnedExpense(stranger.token, { expenseId: expense.id }, database)).result).toMatchObject({
        code: ExpenseErrorCode.NOT_FOUND
    });
    expect((await listOwnedExpenses(stranger.token, { vehicleId }, database)).result).toMatchObject({
        code: ExpenseErrorCode.VEHICLE_NOT_FOUND
    });
    expect((await updateOwnedExpense(stranger.token, { ...input(), expenseId: expense.id }, database)).result).toMatchObject({
        code: ExpenseErrorCode.NOT_FOUND
    });
    expect((await deleteOwnedExpense(stranger.token, { expenseId: expense.id, confirmed: true }, database)).result).toMatchObject({
        code: ExpenseErrorCode.NOT_FOUND
    });
    expect((await updateOwnedCategory(stranger.token, { categoryId, name: 'Stolen', isArchived: true }, database)).result).toMatchObject({
        code: ExpenseErrorCode.CATEGORY_NOT_FOUND
    });
    expect((await deleteOwnedCategory(stranger.token, { categoryId, confirmed: true }, database)).result).toMatchObject({
        code: ExpenseErrorCode.CATEGORY_NOT_FOUND
    });
    expect((await createOwnedExpense(owner.token, { ...input(), categoryId: foreignCategory.id }, database)).result).toMatchObject({
        code: ExpenseErrorCode.CATEGORY_NOT_FOUND
    });
    expect((await createOwnedExpense(owner.token, { ...input(), vehicleId: foreignVehicle.id }, database)).result).toMatchObject({
        code: ExpenseErrorCode.VEHICLE_NOT_FOUND
    });
    expect((await listOwnedExpenses(owner.token, { vehicleId, categoryId: foreignCategory.id }, database)).result).toMatchObject({
        code: ExpenseErrorCode.CATEGORY_NOT_FOUND
    });
    expect((await listOwnedCategories(stranger.token, {}, database)).result).toMatchObject({ total: 1 });
    await expect(
        database.expense.create({
            data: { ...input(), occurredAt: new Date(input().occurredAt), userId: owner.id, categoryId: foreignCategory.id }
        })
    ).rejects.toThrow();
});

test('unauthenticated and blocked sessions cannot access expenses or categories', async () => {
    expect((await createOwnedCategory(undefined, { name: 'Denied' }, database)).result).toMatchObject({
        code: AuthErrorCode.AUTH_REQUIRED
    });
    expect((await createOwnedExpense(undefined, input(), database)).result).toMatchObject({ code: AuthErrorCode.AUTH_REQUIRED });
    await database.user.update({ where: { id: owner.id }, data: { status: UserStatus.BLOCKED } });
    expect((await listOwnedCategories(owner.token, {}, database)).result).toMatchObject({ code: AuthErrorCode.AUTH_REQUIRED });
    expect((await listOwnedExpenses(owner.token, { vehicleId }, database)).result).toMatchObject({ code: AuthErrorCode.AUTH_REQUIRED });
});

test('create versus category deletion is serialized and never creates an orphan expense', async () => {
    const outcomes = await Promise.all([
        createOwnedExpense(owner.token, input(), database),
        deleteOwnedCategory(owner.token, { categoryId, confirmed: true }, database)
    ]);
    const expenseCreated = outcomes[0].result.kind === ResultKind.CREATED;

    expect(outcomes[1].result).toMatchObject(expenseCreated ? { code: ExpenseErrorCode.CATEGORY_IN_USE } : { kind: ResultKind.DELETED });
    expect(await database.expense.count()).toBe(expenseCreated ? 1 : 0);
    if (!expenseCreated) expect(outcomes[0].result).toMatchObject({ code: ExpenseErrorCode.CATEGORY_NOT_FOUND });
});

test('vehicle deletion cascades expenses but retains categories; account deletion removes both', async () => {
    await create();
    await database.vehicle.delete({ where: { id: vehicleId } });
    expect(await database.expense.count()).toBe(0);
    expect(await database.expenseCategory.count({ where: { userId: owner.id } })).toBe(1);

    const car = await database.vehicle.create({
        data: { userId: owner.id, manufacturer: 'Synthetic', model: 'Cascade', fuelTypes: [FuelType.PETROL] }
    });

    await createOwnedExpense(owner.token, { ...input(), vehicleId: car.id }, database);
    expect((await deleteOwnUserAccount(owner.token, { confirmation: owner.username }, database)).result.kind).toBe(ResultKind.DELETED);
    expect(await database.expense.count()).toBe(0);
    expect(await database.expenseCategory.count({ where: { userId: owner.id } })).toBe(0);
});
