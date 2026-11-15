import { logServerError } from '../logging.server';
import { z } from 'zod';
import type { SessionOutcome } from '../auth/auth.types';
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server';
import { clearSessionCookie, getSessionToken, writeSessionCookie } from '../auth/session-cookie.server';
import { AuthErrorCode } from '../auth/auth-errors';
import { ResultKind } from '../common/result-kind';
import { HttpStatus } from '../common/http';
import { StatisticsErrorCode } from './statistics-errors';
import type { StatisticsFailure, StatisticsValidationFailure, StatisticsResult } from './statistics.types';

const errorStatus = {
    [AuthErrorCode.AUTH_REQUIRED]: HttpStatus.UNAUTHORIZED,
    [StatisticsErrorCode.INVALID]: HttpStatus.BAD_REQUEST,
    [StatisticsErrorCode.VEHICLE_NOT_FOUND]: HttpStatus.NOT_FOUND,
    [StatisticsErrorCode.UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE
} satisfies Record<StatisticsFailure['code'], HttpStatus>;

type Validated<Input> = { valid: true; input: Input } | { valid: false; errors: StatisticsValidationFailure };

export function validateStatisticsInput<Input, Output>(schema: z.ZodType<Output, Input>, input: Input): Validated<Output> {
    const parsed = schema.safeParse(input);

    if (parsed.success) return { valid: true, input: parsed.data };

    const errors = z.flattenError(parsed.error);

    return {
        valid: false,
        errors: { kind: ResultKind.INVALID, code: StatisticsErrorCode.INVALID, fields: errors.fieldErrors, formErrors: errors.formErrors }
    };
}

export async function executeStatisticsOperation<Input, Result extends StatisticsResult>(
    data: Validated<Input>,
    operation: (token: string | undefined, input: Input) => Promise<SessionOutcome<Result>>
): Promise<Result | StatisticsValidationFailure | StatisticsFailure> {
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

        return { kind: ResultKind.ERROR, code: StatisticsErrorCode.UNAVAILABLE };
    }
}
