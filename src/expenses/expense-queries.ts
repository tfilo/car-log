import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import { ResultKind } from '../common/result-kind';
import { getExpense, listExpenseCategories, listExpenses } from './expenses';
import type { CategoryData } from './expense.types';
import type { expenseListSchema } from './expense-schema';

export const expenseKeys = {
    all: ['expenses'] as const,
    categories: (userId: string, pageSize = 100) => ['expenses', userId, 'categories', pageSize] as const,
    categoryPage: (page: number, pageSize: number) => ['expenses', 'categoryPage', page, pageSize] as const,
    detail: (userId: string, expenseId: string) => ['expenses', userId, 'detail', expenseId] as const,
    list: (userId: string, vehicleId: string, categoryId: string, page: number, pageSize: number) =>
        ['expenses', userId, 'list', vehicleId, categoryId, page, pageSize] as const
};

export function expenseCategoryPageOptions(page: number, pageSize: number) {
    return queryOptions({
        queryKey: expenseKeys.categoryPage(page, pageSize),
        queryFn: async ({ signal }) => {
            const result = await listExpenseCategories({ data: { page, pageSize, includeArchived: true }, signal });

            if (result.kind !== ResultKind.EXPENSE_CATEGORIES) throw new Error(result.code);

            return result;
        },
        retry: false
    });
}

export function expenseCategoriesOptions(userId: string, pageSize = 100) {
    return queryOptions({
        queryKey: expenseKeys.categories(userId, pageSize),
        queryFn: async ({ signal }): Promise<CategoryData[]> => {
            const categories: CategoryData[] = [];
            let page = 0;

            while (true) {
                const result = await listExpenseCategories({ data: { page, pageSize, includeArchived: true }, signal });

                if (result.kind !== ResultKind.EXPENSE_CATEGORIES) throw new Error(result.code);

                if (result.categories.length === 0) return categories;

                categories.push(...result.categories);

                if (categories.length >= result.total) return categories;

                page++;
            }
        },
        retry: false
    });
}

export function expenseOptions(userId: string, expenseId: string) {
    return queryOptions({
        queryKey: expenseKeys.detail(userId, expenseId),
        queryFn: async ({ signal }) => {
            const result = await getExpense({ data: { expenseId }, signal });

            if (result.kind !== ResultKind.EXPENSE) throw new Error(result.code);

            return result;
        },
        retry: false
    });
}

export function expenseListOptions(userId: string, { vehicleId, categoryId, page, pageSize }: z.output<typeof expenseListSchema>) {
    return queryOptions({
        queryKey: expenseKeys.list(userId, vehicleId, categoryId ?? '', page, pageSize),
        queryFn: async ({ signal }) => {
            const result = await listExpenses({ data: { vehicleId, categoryId, page, pageSize }, signal });

            if (result.kind !== ResultKind.EXPENSES) throw new Error(result.code);

            return result;
        },
        retry: false
    });
}
