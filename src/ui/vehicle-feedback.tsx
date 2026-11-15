import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AuthErrorCode } from '../auth/auth-errors';
import { replaceCurrentUser } from './session';
import { getVehicleErrorKey } from '../vehicles/vehicle-errors';
import type { VehicleFailure, VehicleValidationFailure, VehicleResponse } from '../vehicles/vehicle.types';

export function vehicleErrors(result: VehicleFailure | VehicleValidationFailure): string[] {
    if ('fields' in result) {
        const keys = [...Object.values(result.fields).flatMap((value) => value ?? []), ...result.formErrors];

        if (keys.length) return [...new Set(keys)];
    }

    return [getVehicleErrorKey(result.code)];
}

export function useVehicleAccess(result: VehicleResponse): void {
    const queryClient = useQueryClient();

    useEffect(() => {
        if ('code' in result && result.code === AuthErrorCode.AUTH_REQUIRED) void replaceCurrentUser(queryClient, null);
    }, [result, queryClient]);
}
