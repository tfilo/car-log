import { createServerFn } from '@tanstack/react-start';
import type { z } from 'zod';
import { HttpMethod } from '../common/http';
import { validateExpenseInput, executeExpenseOperation } from './expense-response.server';
import {
    expenseListSchema,
    expenseIdSchema,
    expenseSchema,
    updateExpenseSchema,
    deleteExpenseSchema,
    categoryListSchema,
    categorySchema,
    updateCategorySchema,
    deleteCategorySchema
} from './expense-schema';
import { listOwnedExpenses, getOwnedExpense, createOwnedExpense, updateOwnedExpense, deleteOwnedExpense } from './expenses.server';
import { listOwnedCategories, createOwnedCategory, updateOwnedCategory, deleteOwnedCategory } from './categories.server';
import type {
    ExpenseListResponse,
    ExpenseReadResponse,
    ExpenseSaveResponse,
    ExpenseDeleteResponse,
    CategoryListResponse,
    CategorySaveResponse,
    CategoryDeleteResponse
} from './expense.types';

export const listExpenses = createServerFn({ method: HttpMethod.GET })
    .validator((input: z.input<typeof expenseListSchema>) => validateExpenseInput(expenseListSchema, input))
    .handler(({ data }): Promise<ExpenseListResponse> => executeExpenseOperation(data, listOwnedExpenses));

export const getExpense = createServerFn({ method: HttpMethod.GET })
    .validator((input: z.input<typeof expenseIdSchema>) => validateExpenseInput(expenseIdSchema, input))
    .handler(({ data }): Promise<ExpenseReadResponse> => executeExpenseOperation(data, getOwnedExpense));

export const createExpense = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof expenseSchema>) => validateExpenseInput(expenseSchema, input))
    .handler(({ data }): Promise<ExpenseSaveResponse> => executeExpenseOperation(data, createOwnedExpense));

export const updateExpense = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof updateExpenseSchema>) => validateExpenseInput(updateExpenseSchema, input))
    .handler(({ data }): Promise<ExpenseSaveResponse> => executeExpenseOperation(data, updateOwnedExpense));

export const deleteExpense = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof deleteExpenseSchema>) => validateExpenseInput(deleteExpenseSchema, input))
    .handler(({ data }): Promise<ExpenseDeleteResponse> => executeExpenseOperation(data, deleteOwnedExpense));

export const listExpenseCategories = createServerFn({ method: HttpMethod.GET })
    .validator((input: z.input<typeof categoryListSchema>) => validateExpenseInput(categoryListSchema, input))
    .handler(({ data }): Promise<CategoryListResponse> => executeExpenseOperation(data, listOwnedCategories));

export const createExpenseCategory = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof categorySchema>) => validateExpenseInput(categorySchema, input))
    .handler(({ data }): Promise<CategorySaveResponse> => executeExpenseOperation(data, createOwnedCategory));

export const updateExpenseCategory = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof updateCategorySchema>) => validateExpenseInput(updateCategorySchema, input))
    .handler(({ data }): Promise<CategorySaveResponse> => executeExpenseOperation(data, updateOwnedCategory));

export const deleteExpenseCategory = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof deleteCategorySchema>) => validateExpenseInput(deleteCategorySchema, input))
    .handler(({ data }): Promise<CategoryDeleteResponse> => executeExpenseOperation(data, deleteOwnedCategory));
