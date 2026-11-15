import { fuelLocationSchema } from './fuel-location-schema';
import { roundNumber } from '../common/number';
import { z } from 'zod';
import { FuelType } from '../generated/prisma/enums';
import { FuelPriceInput } from './fuel-values';
import { fuelInputLimits } from './fuel-input-limits';

export function fuelString(maximum: number, message: string): z.ZodString {
    return z.string({ error: message }).max(maximum, { error: message, abort: true });
}

function decimal(integers: number, fraction: number, positive = false) {
    return z
        .number({ error: 'validation.decimal' })
        .min(0, 'validation.decimal')
        .max(10 ** integers - 10 ** -fraction, 'validation.decimal')
        .refine((value) => roundNumber(value, fraction) === value, 'validation.decimal')
        .refine((value) => !positive || value > 0, 'validation.quantity');
}

const shapeError = { error: 'validation.shape' } as const;

export const fuelRecordSchema = z.strictObject(
    {
        location: fuelLocationSchema.optional(),
        vehicleId: fuelString(fuelInputLimits.uuid, 'validation.vehicleId').pipe(z.uuid({ error: 'validation.vehicleId' })),
        fuelType: z.enum(FuelType, { error: 'validation.fuelType' }),
        occurredAt: fuelString(fuelInputLimits.instant, 'validation.occurredAt').pipe(
            z.iso
                .datetime({ offset: true, error: 'validation.occurredAt' })
                .refine((value) => !/\.\d{4}/.test(value) && new Date(value).getUTCFullYear() >= 1, 'validation.occurredAt')
                .transform((value) => new Date(value).toISOString())
        ),
        odometer: decimal(9, 3),
        quantity: decimal(6, 3, true),
        price: z.discriminatedUnion(
            'type',
            [
                z.strictObject({ type: z.literal(FuelPriceInput.TOTAL), totalPrice: decimal(8, 2) }, shapeError),
                z.strictObject({ type: z.literal(FuelPriceInput.UNIT), unitPrice: decimal(6, 6) }, shapeError)
            ],
            shapeError
        ),
        isFull: z.boolean({ error: 'validation.isFull' }),
        previousRecordMissing: z.boolean({ error: 'validation.previousRecordMissing' }).default(false)
    },
    shapeError
);

export const fuelRecordIdSchema = z.strictObject(
    { recordId: fuelString(fuelInputLimits.uuid, 'validation.recordId').pipe(z.uuid({ error: 'validation.recordId' })) },
    shapeError
);

export const updateFuelRecordSchema = fuelRecordSchema
    .omit({ location: true })
    .extend({ ...fuelRecordIdSchema.shape, location: fuelLocationSchema.pick({ latitude: true, longitude: true }).optional() });

export const deleteFuelRecordSchema = fuelRecordIdSchema.extend({ confirmed: z.literal(true, { error: 'validation.confirmation' }) });

export const fuelRecordListSchema = z.strictObject(
    {
        vehicleId: fuelRecordSchema.shape.vehicleId,
        fuelType: z.enum(FuelType, { error: 'validation.fuelType' }).optional(),
        page: z.int({ error: 'validation.pagination' }).min(0, 'validation.pagination').default(0),
        pageSize: z.int({ error: 'validation.pagination' }).min(1, 'validation.pagination').max(100, 'validation.pagination').default(25)
    },
    shapeError
);
