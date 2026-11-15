import { logServerError } from '../logging.server';
import { z } from 'zod';
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server';
import { clearSessionCookie, getSessionToken, writeSessionCookie } from '../auth/session-cookie.server';
import { AuthErrorCode } from '../auth/auth-errors';
import { ResultKind } from '../common/result-kind';
import { HttpStatus } from '../common/http';
import { ExpenseErrorCode } from './expense-errors';
import type { ExpenseFailure, ExpenseValidationFailure, ExpenseOutcome, ExpenseOperationResult } from './expense.types';

const errorStatus = {
    [AuthErrorCode.AUTH_REQUIRED]: HttpStatus.UNAUTHORIZED,
    [ExpenseErrorCode.INVALID]: HttpStatus.BAD_REQUEST,
    [ExpenseErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
    [ExpenseErrorCode.VEHICLE_NOT_FOUND]: HttpStatus.NOT_FOUND,
    [ExpenseErrorCode.CATEGORY_NOT_FOUND]: HttpStatus.NOT_FOUND,
    [ExpenseErrorCode.CATEGORY_ARCHIVED]: HttpStatus.CONFLICT,
    [ExpenseErrorCode.CATEGORY_DUPLICATE]: HttpStatus.CONFLICT,
    [ExpenseErrorCode.CATEGORY_IN_USE]: HttpStatus.CONFLICT,
    [ExpenseErrorCode.UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE
} satisfies Record<ExpenseFailure['code'], HttpStatus>;

type Validated<Input> = { valid: true; input: Input } | { valid: false; errors: ExpenseValidationFailure };

export function validateExpenseInput<Input, Output>(schema: z.ZodType<Output, Input>, input: Input): Validated<Output> {
    const parsed = schema.safeParse(input);

    if (parsed.success) return { valid: true, input: parsed.data };

    const errors = z.flattenError(parsed.error);

    return {
        valid: false,
        errors: { kind: ResultKind.INVALID, code: ExpenseErrorCode.INVALID, fields: errors.fieldErrors, formErrors: errors.formErrors }
    };
}

export async function executeExpenseOperation<Input, Result extends ExpenseOperationResult>(
    data: Validated<Input>,
    operation: (token: string | undefined, input: Input) => Promise<ExpenseOutcome<Result>>
): Promise<Result | ExpenseValidationFailure | ExpenseFailure> {
    setResponseHeader('Cache-Control', 'no-store');

    if (!data.valid) {
        setResponseStatus(HttpStatus.BAD_REQUEST);

        return data.errors;
    }

    try {
        const token = getSessionToken();
        const outcome = await operation(token, data.input);

        if (outcome.clearSession) clearSessionCookie();
        else if (outcome.expiresAt && token) writeSessionCookie(token, outcome.expiresAt);

        if (outcome.result.kind === ResultKind.ERROR) setResponseStatus(errorStatus[outcome.result.code]);

        return outcome.result;
    } catch (error) {
        logServerError(operation.name, error);

        setResponseStatus(HttpStatus.SERVICE_UNAVAILABLE);

        return { kind: ResultKind.ERROR, code: ExpenseErrorCode.UNAVAILABLE };
    }
}
