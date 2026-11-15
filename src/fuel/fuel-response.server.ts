import { logServerError } from '../logging.server';
import { z } from 'zod';
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server';
import { clearSessionCookie, getSessionToken, writeSessionCookie } from '../auth/session-cookie.server';
import { AuthErrorCode } from '../auth/auth-errors';
import { ResultKind } from '../common/result-kind';
import { HttpStatus } from '../common/http';
import { FuelErrorCode } from './fuel-errors';
import type { FuelFailure, FuelValidationFailure, FuelOutcome, FuelOperationResult } from './fuel.types';

const errorStatus = {
    [AuthErrorCode.AUTH_REQUIRED]: HttpStatus.UNAUTHORIZED,
    [FuelErrorCode.INVALID]: HttpStatus.BAD_REQUEST,
    [FuelErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
    [FuelErrorCode.VEHICLE_NOT_FOUND]: HttpStatus.NOT_FOUND,
    [FuelErrorCode.TYPE_UNSUPPORTED]: HttpStatus.CONFLICT,
    [FuelErrorCode.TIMESTAMP_CONFLICT]: HttpStatus.CONFLICT,
    [FuelErrorCode.ODOMETER_ORDER]: HttpStatus.CONFLICT,
    [FuelErrorCode.PRICE_RANGE]: HttpStatus.BAD_REQUEST,
    [FuelErrorCode.UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE
} satisfies Record<FuelFailure['code'], HttpStatus>;

type Validated<Input> = { valid: true; input: Input } | { valid: false; errors: FuelValidationFailure };

export function validateFuelInput<Input, Output>(schema: z.ZodType<Output, Input>, input: Input): Validated<Output> {
    const parsed = schema.safeParse(input);

    if (parsed.success) return { valid: true, input: parsed.data };

    const errors = z.flattenError(parsed.error);

    return {
        valid: false,
        errors: { kind: ResultKind.INVALID, code: FuelErrorCode.INVALID, fields: errors.fieldErrors, formErrors: errors.formErrors }
    };
}

export async function executeFuelOperation<Input, Result extends FuelOperationResult>(
    data: Validated<Input>,
    operation: (token: string | undefined, input: Input) => Promise<FuelOutcome<Result>>
): Promise<Result | FuelValidationFailure | FuelFailure> {
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

        return { kind: ResultKind.ERROR, code: FuelErrorCode.UNAVAILABLE };
    }
}
