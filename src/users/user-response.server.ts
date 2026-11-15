import { UserErrorCode } from './user-errors';
import { z } from 'zod';
import { logServerError } from '../logging.server';
import type { ServerFunctionOperation } from '../server-functions/server-function-operations';
import type { SessionOutcome } from '../auth/auth.types';
import type {
    UserOperationResult,
    UserValidationFailure,
    UserUnavailable,
    UserManagementOutcome,
    UserManagementErrorCode
} from './user.types';
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server';
import { HttpStatus } from '../common/http';
import { AuthErrorCode } from '../auth/auth-errors';
import { ResultKind } from '../common/result-kind';
import { clearSessionCookie, getSessionToken, writeSessionCookie } from '../auth/session-cookie.server';

const userErrorStatus = {
    [AuthErrorCode.AUTH_REQUIRED]: HttpStatus.UNAUTHORIZED,
    [AuthErrorCode.ADMIN_REQUIRED]: HttpStatus.FORBIDDEN,
    [UserErrorCode.ADMIN_USER_NOT_FOUND]: HttpStatus.NOT_FOUND,
    [UserErrorCode.ACCOUNT_CONFIRMATION_MISMATCH]: HttpStatus.BAD_REQUEST,
    [UserErrorCode.ADMIN_LAST_ACTIVE]: HttpStatus.CONFLICT,
    [UserErrorCode.ADMIN_INVALID_TRANSITION]: HttpStatus.CONFLICT
} satisfies Record<UserManagementErrorCode, HttpStatus>;

export function applyUserResponse(outcome: UserManagementOutcome, token?: string): void {
    if (outcome.clearSession) clearSessionCookie();
    else if (token && outcome.expiresAt) writeSessionCookie(token, outcome.expiresAt);

    if (outcome.result.kind !== ResultKind.ERROR) return;

    setResponseStatus(userErrorStatus[outcome.result.code]);
}

type Validated<Input> = { valid: true; input: Input } | { valid: false; errors: UserValidationFailure };

export function validateUserInput<Input, Output>(schema: z.ZodType<Output, Input>, input: Input): Validated<Output> {
    const parsed = schema.safeParse(input);

    if (parsed.success) return { valid: true, input: parsed.data };

    const errors = z.flattenError(parsed.error);

    return {
        valid: false,
        errors: { kind: ResultKind.INVALID, code: UserErrorCode.ACCOUNT_INVALID, fields: errors.fieldErrors, formErrors: errors.formErrors }
    };
}

export async function executeUserOperation<Input, Result extends UserOperationResult>(
    data: Validated<Input>,
    operation: (token: string | undefined, input: Input) => Promise<SessionOutcome<Result>>,
    operationName: ServerFunctionOperation
): Promise<Result | UserValidationFailure | UserUnavailable> {
    setResponseHeader('Cache-Control', 'no-store');

    if (!data.valid) {
        setResponseStatus(HttpStatus.BAD_REQUEST);

        return data.errors;
    }

    try {
        const token = getSessionToken();
        const outcome = await operation(token, data.input);

        applyUserResponse(outcome, token);

        return outcome.result;
    } catch (error) {
        logServerError(operationName, error);
        setResponseStatus(HttpStatus.SERVICE_UNAVAILABLE);

        return { kind: ResultKind.UNAVAILABLE, code: UserErrorCode.ACCOUNT_UNAVAILABLE };
    }
}
