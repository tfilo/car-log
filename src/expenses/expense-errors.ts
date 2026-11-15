import { getAuthErrorKey } from '../auth/auth-errors.ts';

export const ExpenseErrorCode = {
    INVALID: 'EXPENSE_INVALID',
    NOT_FOUND: 'EXPENSE_NOT_FOUND',
    VEHICLE_NOT_FOUND: 'EXPENSE_VEHICLE_NOT_FOUND',
    CATEGORY_NOT_FOUND: 'EXPENSE_CATEGORY_NOT_FOUND',
    CATEGORY_ARCHIVED: 'EXPENSE_CATEGORY_ARCHIVED',
    CATEGORY_DUPLICATE: 'EXPENSE_CATEGORY_DUPLICATE',
    CATEGORY_IN_USE: 'EXPENSE_CATEGORY_IN_USE',
    UNAVAILABLE: 'EXPENSE_UNAVAILABLE'
} as const;

export type ExpenseErrorCode = (typeof ExpenseErrorCode)[keyof typeof ExpenseErrorCode];

export const expenseErrorKeys = {
    [ExpenseErrorCode.INVALID]: 'errors.invalid',
    [ExpenseErrorCode.NOT_FOUND]: 'errors.notFound',
    [ExpenseErrorCode.VEHICLE_NOT_FOUND]: 'errors.vehicleNotFound',
    [ExpenseErrorCode.CATEGORY_NOT_FOUND]: 'errors.categoryNotFound',
    [ExpenseErrorCode.CATEGORY_ARCHIVED]: 'errors.categoryArchived',
    [ExpenseErrorCode.CATEGORY_DUPLICATE]: 'errors.categoryDuplicate',
    [ExpenseErrorCode.CATEGORY_IN_USE]: 'errors.categoryInUse',
    [ExpenseErrorCode.UNAVAILABLE]: 'errors.unavailable'
} satisfies Record<ExpenseErrorCode, string>;

export function getExpenseErrorKey(code: unknown): string {
    if (typeof code === 'string' && Object.hasOwn(expenseErrorKeys, code)) return expenseErrorKeys[code as ExpenseErrorCode];

    return `auth:${getAuthErrorKey(code)}`;
}
