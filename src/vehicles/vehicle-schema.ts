import { z } from 'zod';
import { FuelType } from '../generated/prisma/enums';

function optionalText(maximum: number) {
    return z
        .string({ error: 'validation.text' })
        .trim()
        .max(maximum, 'validation.length')
        .nullable()
        .optional()
        .transform((value) => value || null);
}

export const vehicleSchema = z.strictObject(
    {
        manufacturer: z.string({ error: 'validation.manufacturer' }).trim().min(1, 'validation.manufacturer').max(100, 'validation.length'),
        model: z.string({ error: 'validation.model' }).trim().min(1, 'validation.model').max(100, 'validation.length'),
        licensePlate: optionalText(30)
            .transform((value) => value?.toUpperCase() ?? null)
            .pipe(z.string().max(30, 'validation.length').nullable()),
        vin: optionalText(32)
            .refine((value) => value === null || /^[A-Za-z0-9]+$/.test(value), 'validation.vin')
            .transform((value) => value?.toUpperCase() ?? null),
        color: optionalText(50),
        registrationDate: z
            .union([z.iso.date({ error: 'validation.date' }), z.literal(''), z.null()], { error: 'validation.date' })
            .optional()
            .transform((value) => value || null),
        fuelTypes: z
            .array(z.enum(FuelType, { error: 'validation.fuelTypes' }), { error: 'validation.fuelTypes' })
            .min(1, 'validation.fuelTypes')
            .refine((values) => new Set(values).size === values.length, 'validation.fuelTypes')
    },
    { error: 'validation.shape' }
);

export const vehicleIdSchema = z.strictObject({ vehicleId: z.uuid({ error: 'validation.id' }) }, { error: 'validation.shape' });
export const updateVehicleSchema = vehicleSchema.extend(vehicleIdSchema.shape);
export const deleteVehicleSchema = vehicleIdSchema.extend({ confirmed: z.literal(true, { error: 'validation.confirmation' }) });

export const vehicleListSchema = z
    .strictObject(
        {
            page: z.int({ error: 'validation.pagination' }).min(0, 'validation.pagination').default(0),
            pageSize: z
                .int({ error: 'validation.pagination' })
                .min(1, 'validation.pagination')
                .max(100, 'validation.pagination')
                .default(12)
        },
        { error: 'validation.shape' }
    )
    .default({ page: 0, pageSize: 12 });
