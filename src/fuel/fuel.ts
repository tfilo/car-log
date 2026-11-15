import { createServerFn } from '@tanstack/react-start';
import type { z } from 'zod';
import { HttpMethod } from '../common/http';
import { fuelRecordSchema, fuelRecordIdSchema, fuelRecordListSchema, updateFuelRecordSchema, deleteFuelRecordSchema } from './fuel-schema';
import {
    listOwnedFuelRecords,
    getOwnedFuelRecord,
    createOwnedFuelRecord,
    updateOwnedFuelRecord,
    deleteOwnedFuelRecord
} from './fuel.server';
import { validateFuelInput, executeFuelOperation } from './fuel-response.server';
import type { FuelReadResponse, FuelListResponse, FuelSaveResponse, FuelDeleteResponse } from './fuel.types';

export const listFuelRecords = createServerFn({ method: HttpMethod.GET })
    .validator((input: z.input<typeof fuelRecordListSchema>) => validateFuelInput(fuelRecordListSchema, input))
    .handler(({ data }): Promise<FuelListResponse> => executeFuelOperation(data, listOwnedFuelRecords));

export const getFuelRecord = createServerFn({ method: HttpMethod.GET })
    .validator((input: z.input<typeof fuelRecordIdSchema>) => validateFuelInput(fuelRecordIdSchema, input))
    .handler(({ data }): Promise<FuelReadResponse> => executeFuelOperation(data, getOwnedFuelRecord));

export const createFuelRecord = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof fuelRecordSchema>) => validateFuelInput(fuelRecordSchema, input))
    .handler(({ data }): Promise<FuelSaveResponse> => executeFuelOperation(data, createOwnedFuelRecord));

export const updateFuelRecord = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof updateFuelRecordSchema>) => validateFuelInput(updateFuelRecordSchema, input))
    .handler(({ data }): Promise<FuelSaveResponse> => executeFuelOperation(data, updateOwnedFuelRecord));

export const deleteFuelRecord = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof deleteFuelRecordSchema>) => validateFuelInput(deleteFuelRecordSchema, input))
    .handler(({ data }): Promise<FuelDeleteResponse> => executeFuelOperation(data, deleteOwnedFuelRecord));
