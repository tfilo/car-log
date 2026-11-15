import type { z } from 'zod';
import { db } from '../db.server';
import type { PrismaClient, Expense, ExpenseCategory } from '../generated/prisma/client';
import { validateSessionInTransaction } from '../auth/session.server';
import { AuthErrorCode } from '../auth/auth-errors';
import { ResultKind } from '../common/result-kind';
import { ExpenseErrorCode } from './expense-errors';
import { expenseSchema, updateExpenseSchema, expenseIdSchema, expenseListSchema, deleteExpenseSchema } from './expense-schema';
import type {
    ExpenseData,
    ExpenseReadResult,
    ExpenseListResult,
    ExpenseSaveResult,
    ExpenseDeleteResult,
    ExpenseOutcome
} from './expense.types';

function expenseData(expense: Expense & { category: ExpenseCategory }): ExpenseData {
    return {
        id: expense.id,
        vehicleId: expense.vehicleId,
        categoryId: expense.categoryId,
        categoryName: expense.category.name,
        categoryArchived: expense.category.isArchived,
        totalPrice: expense.totalPrice.toNumber(),
        odometer: expense.odometer.toNumber(),
        occurredAt: expense.occurredAt.toISOString(),
        comment: expense.comment,
        createdAt: expense.createdAt.toISOString(),
        updatedAt: expense.updatedAt.toISOString()
    };
}

async function saveExpense(
    token: string | undefined,
    input: z.output<typeof expenseSchema>,
    expenseId: string | undefined,
    database: PrismaClient
): Promise<ExpenseOutcome<ExpenseSaveResult>> {
    return database.$transaction(async (tx) => {
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const expiresAt = session.expiresAt;
        const userId = session.user.id;
        const previous = expenseId ? await tx.expense.findFirst({ where: { id: expenseId, userId } }) : null;

        if (expenseId && !previous) return { result: { kind: ResultKind.ERROR, code: ExpenseErrorCode.NOT_FOUND }, expiresAt };

        const vehicle = await tx.vehicle.findFirst({ where: { id: input.vehicleId, userId } });

        if (!vehicle) return { result: { kind: ResultKind.ERROR, code: ExpenseErrorCode.VEHICLE_NOT_FOUND }, expiresAt };

        const category = await tx.expenseCategory.findFirst({ where: { id: input.categoryId, userId } });

        if (!category) return { result: { kind: ResultKind.ERROR, code: ExpenseErrorCode.CATEGORY_NOT_FOUND }, expiresAt };
        if (category.isArchived && previous?.categoryId !== category.id) {
            return { result: { kind: ResultKind.ERROR, code: ExpenseErrorCode.CATEGORY_ARCHIVED }, expiresAt };
        }

        const data = { ...input, userId, occurredAt: new Date(input.occurredAt), comment: input.comment || null };
        const include = { category: true } as const;
        const expense = expenseId
            ? await tx.expense.update({ where: { id: expenseId }, data, include })
            : await tx.expense.create({ data, include });

        return { result: { kind: expenseId ? ResultKind.UPDATED : ResultKind.CREATED, expense: expenseData(expense) }, expiresAt };
    });
}

export async function createOwnedExpense(
    token: string | undefined,
    input: z.input<typeof expenseSchema>,
    database: PrismaClient = db
): Promise<ExpenseOutcome<ExpenseSaveResult>> {
    return saveExpense(token, expenseSchema.parse(input), undefined, database);
}

export async function updateOwnedExpense(
    token: string | undefined,
    input: z.input<typeof updateExpenseSchema>,
    database: PrismaClient = db
): Promise<ExpenseOutcome<ExpenseSaveResult>> {
    const { expenseId, ...data } = updateExpenseSchema.parse(input);

    return saveExpense(token, data, expenseId, database);
}

export async function getOwnedExpense(
    token: string | undefined,
    input: z.input<typeof expenseIdSchema>,
    database: PrismaClient = db
): Promise<ExpenseOutcome<ExpenseReadResult>> {
    const { expenseId } = expenseIdSchema.parse(input);

    return database.$transaction(async (tx) => {
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const expense = await tx.expense.findFirst({ where: { id: expenseId, userId: session.user.id }, include: { category: true } });

        return {
            result: expense
                ? { kind: ResultKind.EXPENSE, expense: expenseData(expense) }
                : { kind: ResultKind.ERROR, code: ExpenseErrorCode.NOT_FOUND },
            expiresAt: session.expiresAt
        };
    });
}

export async function listOwnedExpenses(
    token: string | undefined,
    input: z.input<typeof expenseListSchema>,
    database: PrismaClient = db
): Promise<ExpenseOutcome<ExpenseListResult>> {
    const { vehicleId, categoryId, page, pageSize } = expenseListSchema.parse(input);

    return database.$transaction(async (tx) => {
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const expiresAt = session.expiresAt;
        const userId = session.user.id;
        const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, userId } });

        if (!vehicle) return { result: { kind: ResultKind.ERROR, code: ExpenseErrorCode.VEHICLE_NOT_FOUND }, expiresAt };
        if (categoryId && !(await tx.expenseCategory.findFirst({ where: { id: categoryId, userId } }))) {
            return { result: { kind: ResultKind.ERROR, code: ExpenseErrorCode.CATEGORY_NOT_FOUND }, expiresAt };
        }

        const where = { userId, vehicleId, ...(categoryId ? { categoryId } : {}) };
        const expenses = await tx.expense.findMany({
            where,
            include: { category: true },
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            skip: page * pageSize,
            take: pageSize
        });
        const total = await tx.expense.count({ where });

        return { result: { kind: ResultKind.EXPENSES, expenses: expenses.map(expenseData), total, page, pageSize }, expiresAt };
    });
}

export async function deleteOwnedExpense(
    token: string | undefined,
    input: z.input<typeof deleteExpenseSchema>,
    database: PrismaClient = db
): Promise<ExpenseOutcome<ExpenseDeleteResult>> {
    const { expenseId } = deleteExpenseSchema.parse(input);

    return database.$transaction(async (tx) => {
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const expiresAt = session.expiresAt;
        const expense = await tx.expense.findFirst({ where: { id: expenseId, userId: session.user.id } });

        if (!expense) return { result: { kind: ResultKind.ERROR, code: ExpenseErrorCode.NOT_FOUND }, expiresAt };

        await tx.expense.delete({ where: { id: expenseId } });

        return { result: { kind: ResultKind.DELETED, expenseId }, expiresAt };
    });
}
