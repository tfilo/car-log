import { logServerError } from '../logging.server';
import { z } from 'zod';
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server';
import { clearSessionCookie, getSessionToken, writeSessionCookie } from '../auth/session-cookie.server';
import { AuthErrorCode } from '../auth/auth-errors';
import { ResultKind } from '../common/result-kind';
import { HttpStatus } from '../common/http';
import { VehicleErrorCode } from './vehicle-errors';
import type { VehicleFailure, VehicleValidationFailure, VehicleOutcome, VehicleOperationResult } from './vehicle.types';

export const vehicleErrorStatus = {
    [VehicleErrorCode.FUEL_IN_USE]: HttpStatus.CONFLICT,
    [AuthErrorCode.AUTH_REQUIRED]: HttpStatus.UNAUTHORIZED,
    [VehicleErrorCode.INVALID]: HttpStatus.BAD_REQUEST,
    [VehicleErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
    [VehicleErrorCode.UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
    [VehicleErrorCode.PICTURE_INVALID]: HttpStatus.BAD_REQUEST,
    [VehicleErrorCode.PICTURE_TOO_LARGE]: HttpStatus.PAYLOAD_TOO_LARGE
} satisfies Record<VehicleFailure['code'], HttpStatus>;

type Validated<Input> = { valid: true; input: Input } | { valid: false; errors: VehicleValidationFailure };

export function validateVehicleInput<Input, Output>(schema: z.ZodType<Output, Input>, input: Input): Validated<Output> {
    const parsed = schema.safeParse(input);

    if (parsed.success) return { valid: true, input: parsed.data };

    const errors = z.flattenError(parsed.error);

    return {
        valid: false,
        errors: { kind: ResultKind.INVALID, code: VehicleErrorCode.INVALID, fields: errors.fieldErrors, formErrors: errors.formErrors }
    };
}

export function applyVehicleSession(outcome: { expiresAt?: Date; clearSession?: boolean }, token: string | undefined): void {
    if (outcome.clearSession) clearSessionCookie();
    else if (outcome.expiresAt && token) writeSessionCookie(token, outcome.expiresAt);
}

export async function executeVehicleOperation<Input, Result extends VehicleOperationResult>(
    data: Validated<Input>,
    operation: (token: string | undefined, input: Input) => Promise<VehicleOutcome<Result>>
): Promise<Result | VehicleValidationFailure | VehicleFailure> {
    setResponseHeader('Cache-Control', 'no-store');

    if (!data.valid) {
        setResponseStatus(HttpStatus.BAD_REQUEST);

        return data.errors;
    }

    try {
        const token = getSessionToken();
        const outcome = await operation(token, data.input);

        applyVehicleSession(outcome, token);

        const result = outcome.result;

        if (result.kind === ResultKind.ERROR) setResponseStatus(vehicleErrorStatus[result.code]);

        return result;
    } catch (error) {
        logServerError(operation.name, error);

        setResponseStatus(HttpStatus.SERVICE_UNAVAILABLE);

        return { kind: ResultKind.ERROR, code: VehicleErrorCode.UNAVAILABLE };
    }
}
