import { createServerFn } from '@tanstack/react-start';
import type { z } from 'zod';
import { HttpMethod } from '../common/http';
import { vehicleSchema, vehicleIdSchema, vehicleListSchema, updateVehicleSchema, deleteVehicleSchema } from './vehicle-schema';
import { listOwnedVehicles, getOwnedVehicle, createOwnedVehicle, updateOwnedVehicle, deleteOwnedVehicle } from './vehicles.server';
import { validateVehicleInput, executeVehicleOperation } from './vehicle-response.server';
import type { VehicleReadResponse, VehicleListResponse, VehicleSaveResponse, VehicleDeleteResponse } from './vehicle.types';

export const listVehicles = createServerFn({ method: HttpMethod.GET })
    .validator((input: z.input<typeof vehicleListSchema>) => validateVehicleInput(vehicleListSchema, input))
    .handler(({ data }): Promise<VehicleListResponse> => executeVehicleOperation(data, listOwnedVehicles));

export const getVehicle = createServerFn({ method: HttpMethod.GET })
    .validator((input: z.input<typeof vehicleIdSchema>) => validateVehicleInput(vehicleIdSchema, input))
    .handler(({ data }): Promise<VehicleReadResponse> => executeVehicleOperation(data, getOwnedVehicle));

export const createVehicle = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof vehicleSchema>) => validateVehicleInput(vehicleSchema, input))
    .handler(({ data }): Promise<VehicleSaveResponse> => executeVehicleOperation(data, createOwnedVehicle));

export const updateVehicle = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof updateVehicleSchema>) => validateVehicleInput(updateVehicleSchema, input))
    .handler(({ data }): Promise<VehicleSaveResponse> => executeVehicleOperation(data, updateOwnedVehicle));

export const deleteVehicle = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof deleteVehicleSchema>) => validateVehicleInput(deleteVehicleSchema, input))
    .handler(({ data }): Promise<VehicleDeleteResponse> => executeVehicleOperation(data, deleteOwnedVehicle));
