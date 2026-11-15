import type { z } from 'zod';
import type { AuthErrorCode } from '../auth/auth-errors';
import type { ResultKind } from '../common/result-kind';
import type { SessionOutcome } from '../auth/auth.types';
import type { ExpenseErrorCode } from './expense-errors';
import type {
    updateExpenseSchema,
    expenseListSchema,
    updateCategorySchema,
    categoryListSchema,
    deleteExpenseSchema
} from './expense-schema';

export type CategoryData = {
    serviceIntervalKm?: number;
    serviceIntervalMonths?: number;
    id: string;
    name: string;
    isArchived: boolean;
    expenseCount: number;
};

export type ExpenseData = {
    id: string;
    vehicleId: string;
    categoryId: string;
    categoryName: string;
    categoryArchived: boolean;
    totalPrice: number;
    odometer: number;
    occurredAt: string;
    comment: string | null;
    createdAt: string;
    updatedAt: string;
};

export type ExpenseFailure = { kind: typeof ResultKind.ERROR; code: ExpenseErrorCode | typeof AuthErrorCode.AUTH_REQUIRED };

export type ExpenseValidationFailure = {
    kind: typeof ResultKind.INVALID;
    code: typeof ExpenseErrorCode.INVALID;
    fields: Partial<
        Record<
            | keyof z.input<typeof updateExpenseSchema>
            | keyof z.input<typeof expenseListSchema>
            | keyof z.input<typeof updateCategorySchema>
            | keyof z.input<typeof categoryListSchema>
            | keyof z.input<typeof deleteExpenseSchema>,
            string[]
        >
    >;
    formErrors: string[];
};

export type CategoryListResult =
    | { kind: typeof ResultKind.EXPENSE_CATEGORIES; categories: CategoryData[]; total: number; page: number; pageSize: number }
    | ExpenseFailure;

export type CategorySaveResult = { kind: typeof ResultKind.CREATED | typeof ResultKind.UPDATED; category: CategoryData } | ExpenseFailure;

export type CategoryDeleteResult = { kind: typeof ResultKind.DELETED; categoryId: string } | ExpenseFailure;

export type ExpenseReadResult = { kind: typeof ResultKind.EXPENSE; expense: ExpenseData } | ExpenseFailure;

export type ExpenseListResult =
    { kind: typeof ResultKind.EXPENSES; expenses: ExpenseData[]; total: number; page: number; pageSize: number } | ExpenseFailure;

export type ExpenseSaveResult = { kind: typeof ResultKind.CREATED | typeof ResultKind.UPDATED; expense: ExpenseData } | ExpenseFailure;

export type ExpenseDeleteResult = { kind: typeof ResultKind.DELETED; expenseId: string } | ExpenseFailure;

export type ExpenseOperationResult =
    | CategoryListResult
    | CategorySaveResult
    | CategoryDeleteResult
    | ExpenseReadResult
    | ExpenseListResult
    | ExpenseSaveResult
    | ExpenseDeleteResult;

export type ExpenseOutcome<Result> = SessionOutcome<Result>;

export type CategoryListResponse = CategoryListResult | ExpenseValidationFailure;
export type CategorySaveResponse = CategorySaveResult | ExpenseValidationFailure;
export type CategoryDeleteResponse = CategoryDeleteResult | ExpenseValidationFailure;
export type ExpenseReadResponse = ExpenseReadResult | ExpenseValidationFailure;
export type ExpenseListResponse = ExpenseListResult | ExpenseValidationFailure;
export type ExpenseSaveResponse = ExpenseSaveResult | ExpenseValidationFailure;
export type ExpenseDeleteResponse = ExpenseDeleteResult | ExpenseValidationFailure;
