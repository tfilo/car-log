import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AuthErrorCode } from '../auth/auth-errors';
import { getExpenseErrorKey } from '../expenses/expense-errors';
import type { ExpenseFailure, ExpenseValidationFailure, ExpenseOperationResult } from '../expenses/expense.types';
import { replaceCurrentUser } from './session';

export function expenseErrors(result: ExpenseFailure | ExpenseValidationFailure): string[] {
    if ('fields' in result) {
        const messages = [...Object.values(result.fields).flatMap((value) => value ?? []), ...result.formErrors];

        if (messages.length) return [...new Set(messages)];
    }

    return [getExpenseErrorKey(result.code)];
}

export function useExpenseAccess(result: ExpenseOperationResult | ExpenseValidationFailure): void {
    const queryClient = useQueryClient();

    useEffect(() => {
        if ('code' in result && result.code === AuthErrorCode.AUTH_REQUIRED) void replaceCurrentUser(queryClient, null);
    }, [result, queryClient]);
}
