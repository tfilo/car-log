import { z } from 'zod';
import { FuelType } from '../generated/prisma/enums';

const vehicleId = z.uuid().optional().catch(undefined);
const page = z.int().min(0).max(1000000).optional().catch(undefined);

export const fuelListSearchSchema = z.object({
    vehicleId,
    fuelType: z.enum(FuelType).optional().catch(undefined),
    page
});

export const expenseListSearchSchema = z.object({
    vehicleId,
    categoryId: z.uuid().optional().catch(undefined),
    page
});

export const fuelReturnSearchSchema = z.object({ returnTo: fuelListSearchSchema.optional().catch(undefined) });
export const expenseReturnSearchSchema = z.object({ returnTo: expenseListSearchSchema.optional().catch(undefined) });

export type FuelListSearch = z.output<typeof fuelListSearchSchema>;
export type ExpenseListSearch = z.output<typeof expenseListSearchSchema>;
