import { ResultKind } from '../common/result-kind';
import { queryOptions } from '@tanstack/react-query';
import { listVehicles, getVehicle } from './vehicles';

export const vehicleKeys = {
    all: ['vehicles'] as const,
    list: (userId: string, page: number, pageSize = 12) => ['vehicles', userId, 'list', page, pageSize] as const,
    detail: (userId: string, vehicleId: string) => ['vehicles', userId, 'detail', vehicleId] as const
};

export function vehicleListOptions(userId: string, page: number, pageSize = 12) {
    return queryOptions({
        queryKey: vehicleKeys.list(userId, page, pageSize),
        queryFn: async ({ signal }) => {
            const result = await listVehicles({ data: { page, pageSize }, signal });

            if (result.kind !== ResultKind.VEHICLES) throw new Error(result.code);

            return result;
        },
        retry: false
    });
}

export function vehicleDetailsOptions(userId: string, vehicleId: string) {
    return queryOptions({
        queryKey: vehicleKeys.detail(userId, vehicleId),
        queryFn: async ({ signal }) => {
            const result = await getVehicle({ data: { vehicleId }, signal });

            if (result.kind !== ResultKind.VEHICLE) throw new Error(result.code);

            return result;
        },
        retry: false
    });
}
