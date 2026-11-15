import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import { listVehicles } from '../vehicles/vehicles';
import type { VehicleData } from '../vehicles/vehicle.types';
import { ResultKind } from '../common/result-kind';
import { getFuelRecord, listFuelRecords } from './fuel';
import type { fuelRecordListSchema } from './fuel-schema';

export const fuelKeys = {
    all: ['fuel'] as const,
    vehicles: (userId: string, pageSize = 100) => ['fuel', userId, 'vehicles', pageSize] as const,
    list: (userId: string, vehicleId: string, fuelType: string, page: number, pageSize: number) =>
        ['fuel', userId, vehicleId, fuelType, page, pageSize] as const,
    detail: (userId: string, recordId: string) => ['fuel', userId, 'record', recordId] as const
};

export function fuelVehiclesOptions(userId: string, pageSize = 100) {
    return queryOptions({
        queryKey: fuelKeys.vehicles(userId, pageSize),
        queryFn: async ({ signal }): Promise<VehicleData[]> => {
            const vehicles: VehicleData[] = [];
            let page = 0;

            while (true) {
                const result = await listVehicles({ data: { page, pageSize }, signal });

                if (result.kind !== ResultKind.VEHICLES) throw new Error(result.code);

                if (result.vehicles.length === 0) return vehicles;

                vehicles.push(...result.vehicles);

                if (vehicles.length >= result.total) return vehicles;

                page++;
            }
        },
        retry: false
    });
}

export function fuelRecordOptions(userId: string, recordId: string) {
    return queryOptions({
        queryKey: fuelKeys.detail(userId, recordId),
        queryFn: async ({ signal }) => {
            const result = await getFuelRecord({ data: { recordId }, signal });

            if (result.kind !== ResultKind.FUEL_RECORD) throw new Error(result.code);

            return result;
        },
        retry: false
    });
}

export function fuelListOptions(userId: string, { vehicleId, fuelType, page, pageSize }: z.output<typeof fuelRecordListSchema>) {
    return queryOptions({
        queryKey: fuelKeys.list(userId, vehicleId, fuelType ?? '', page, pageSize),
        queryFn: async ({ signal }) => {
            const result = await listFuelRecords({ data: { vehicleId, fuelType, page, pageSize }, signal });

            if (result.kind !== ResultKind.FUEL_RECORDS) throw new Error(result.code);

            return result;
        },
        retry: false
    });
}
