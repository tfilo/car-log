import type { z } from 'zod';
import { db } from '../db.server';
import type { PrismaClient, Prisma, ExpenseCategory } from '../generated/prisma/client';
import { validateSessionInTransaction } from '../auth/session.server';
import { AuthErrorCode } from '../auth/auth-errors';
import { ResultKind } from '../common/result-kind';
import { ExpenseErrorCode } from './expense-errors';
import { categorySchema, updateCategorySchema, deleteCategorySchema, categoryListSchema } from './expense-schema';
import type { CategoryData, CategoryListResult, CategorySaveResult, CategoryDeleteResult, ExpenseOutcome } from './expense.types';

function categoryData(category: ExpenseCategory & { _count: { expenses: number } }): CategoryData {
    return {
        id: category.id,
        name: category.name,
        isArchived: category.isArchived,
        expenseCount: category._count.expenses,
        serviceIntervalKm: category.serviceIntervalKm ?? undefined,
        serviceIntervalMonths: category.serviceIntervalMonths ?? undefined
    };
}

async function saveCategory(
    token: string | undefined,
    input: z.output<typeof categorySchema> & { categoryId?: string; isArchived?: boolean },
    database: PrismaClient
): Promise<ExpenseOutcome<CategorySaveResult>> {
    return database.$transaction(async (tx) => {
        // The owner lock serializes category changes and expense mutations across sessions.
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const expiresAt = session.expiresAt;
        const userId = session.user.id;

        if (input.categoryId && !(await tx.expenseCategory.findFirst({ where: { id: input.categoryId, userId } }))) {
            return { result: { kind: ResultKind.ERROR, code: ExpenseErrorCode.CATEGORY_NOT_FOUND }, expiresAt };
        }

        // Match the database expression index's case/space normalization exactly.
        const duplicates = await tx.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "ExpenseCategory"
            WHERE "userId" = ${userId}::uuid AND lower(btrim("name")) = lower(btrim(${input.name}))
        `;

        if (duplicates.some((item) => item.id !== input.categoryId)) {
            return { result: { kind: ResultKind.ERROR, code: ExpenseErrorCode.CATEGORY_DUPLICATE }, expiresAt };
        }

        const data = {
            name: input.name,
            serviceIntervalKm: input.serviceIntervalKm,
            serviceIntervalMonths: input.serviceIntervalMonths,
            ...(input.isArchived === undefined ? {} : { isArchived: input.isArchived })
        };
        const include = { _count: { select: { expenses: true } } } satisfies Prisma.ExpenseCategoryInclude;
        const category = input.categoryId
            ? await tx.expenseCategory.update({ where: { id: input.categoryId }, data, include })
            : await tx.expenseCategory.create({ data: { ...data, userId }, include });

        return {
            result: { kind: input.categoryId ? ResultKind.UPDATED : ResultKind.CREATED, category: categoryData(category) },
            expiresAt
        };
    });
}

export async function createOwnedCategory(
    token: string | undefined,
    input: z.input<typeof categorySchema>,
    database: PrismaClient = db
): Promise<ExpenseOutcome<CategorySaveResult>> {
    return saveCategory(token, categorySchema.parse(input), database);
}

export async function updateOwnedCategory(
    token: string | undefined,
    input: z.input<typeof updateCategorySchema>,
    database: PrismaClient = db
): Promise<ExpenseOutcome<CategorySaveResult>> {
    return saveCategory(token, updateCategorySchema.parse(input), database);
}

export async function listOwnedCategories(
    token: string | undefined,
    input: z.input<typeof categoryListSchema>,
    database: PrismaClient = db
): Promise<ExpenseOutcome<CategoryListResult>> {
    const { page, pageSize, includeArchived } = categoryListSchema.parse(input);

    return database.$transaction(async (tx) => {
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const where = { userId: session.user.id, ...(includeArchived ? {} : { isArchived: false }) };
        const categories = await tx.expenseCategory.findMany({
            where,
            include: { _count: { select: { expenses: true } } },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            skip: page * pageSize,
            take: pageSize
        });
        const total = await tx.expenseCategory.count({ where });

        return {
            result: { kind: ResultKind.EXPENSE_CATEGORIES, categories: categories.map(categoryData), total, page, pageSize },
            expiresAt: session.expiresAt
        };
    });
}

export async function deleteOwnedCategory(
    token: string | undefined,
    input: z.input<typeof deleteCategorySchema>,
    database: PrismaClient = db
): Promise<ExpenseOutcome<CategoryDeleteResult>> {
    const { categoryId } = deleteCategorySchema.parse(input);

    return database.$transaction(async (tx) => {
        const session = token ? await validateSessionInTransaction(token, tx) : null;

        if (!session) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

        const expiresAt = session.expiresAt;
        const category = await tx.expenseCategory.findFirst({
            where: { id: categoryId, userId: session.user.id },
            include: { _count: { select: { expenses: true } } }
        });

        if (!category) return { result: { kind: ResultKind.ERROR, code: ExpenseErrorCode.CATEGORY_NOT_FOUND }, expiresAt };
        if (category._count.expenses) return { result: { kind: ResultKind.ERROR, code: ExpenseErrorCode.CATEGORY_IN_USE }, expiresAt };

        await tx.expenseCategory.delete({ where: { id: categoryId } });

        return { result: { kind: ResultKind.DELETED, categoryId }, expiresAt };
    });
}
