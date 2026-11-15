import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AuthErrorCode } from '../auth/auth-errors';
import { getFuelErrorKey } from '../fuel/fuel-errors';
import type { FuelFailure, FuelValidationFailure, FuelOperationResult } from '../fuel/fuel.types';
import { replaceCurrentUser } from './session';

export function fuelErrors(result: FuelFailure | FuelValidationFailure): string[] {
    if ('fields' in result) {
        const messages = [...Object.values(result.fields).flatMap((value) => value ?? []), ...result.formErrors];

        if (messages.length) return [...new Set(messages)];
    }

    return [getFuelErrorKey(result.code)];
}

export function useFuelAccess(result: FuelOperationResult | FuelValidationFailure): void {
    const queryClient = useQueryClient();

    useEffect(() => {
        if ('code' in result && result.code === AuthErrorCode.AUTH_REQUIRED) void replaceCurrentUser(queryClient, null);
    }, [result, queryClient]);
}
