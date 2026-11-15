import { z } from 'zod';
import { FuelPriceInput } from './fuel-values';
import { fuelRecordSchema, fuelString } from './fuel-schema';
import { fuelInputLimits } from './fuel-input-limits';
import { fuelTimeCandidates, resolveFuelTime } from './fuel-time';
import { fuelPricePreview } from './fuel-format';

const formSchema = z.strictObject({
    vehicleId: fuelRecordSchema.shape.vehicleId,
    fuelType: fuelRecordSchema.shape.fuelType,
    occurredAt: fuelString(fuelInputLimits.localDateTime, 'validation.occurredAt'),
    timeInstant: fuelString(fuelInputLimits.instant, 'validation.occurredAt'),
    odometer: z.number({ error: 'validation.decimal' }).nullable(),
    quantity: z.number({ error: 'validation.decimal' }).nullable(),
    priceType: z.enum(FuelPriceInput),
    priceAmount: z.number({ error: 'validation.decimal' }).nullable(),
    isFull: fuelRecordSchema.shape.isFull,
    previousRecordMissing: z.boolean()
});

export type FuelFormValues = z.input<typeof formSchema>;

export function fuelFormInput(value: FuelFormValues): z.input<typeof fuelRecordSchema> {
    return {
        vehicleId: value.vehicleId,
        fuelType: value.fuelType,
        occurredAt: resolveFuelTime(value.occurredAt, value.timeInstant) ?? '',
        odometer: value.odometer ?? NaN,
        quantity: value.quantity ?? NaN,
        price:
            value.priceType === FuelPriceInput.TOTAL
                ? { type: value.priceType, totalPrice: value.priceAmount ?? NaN }
                : { type: value.priceType, unitPrice: value.priceAmount ?? NaN },
        isFull: value.isFull,
        previousRecordMissing: value.previousRecordMissing
    };
}

export const fuelFormSchema = formSchema.superRefine((value, context) => {
    const input = fuelFormInput(value);
    const parsed = fuelRecordSchema.safeParse(input);

    if (!parsed.success) {
        const invalidTime = !input.occurredAt;
        const ambiguousTime = invalidTime && fuelTimeCandidates(value.occurredAt).length > 1;

        if (invalidTime)
            context.addIssue({
                code: 'custom',
                path: [ambiguousTime ? 'timeInstant' : 'occurredAt'],
                message: ambiguousTime ? 'validation.timeChoice' : 'validation.occurredAt'
            });

        for (const issue of parsed.error.issues) {
            const field = issue.path[0];
            if (invalidTime && field === 'occurredAt') continue;

            const path = field === 'price' ? ['priceAmount'] : issue.path;
            context.addIssue({ code: 'custom', path, message: issue.message });
        }
    } else if (!fuelPricePreview(value.quantity, value.priceType, value.priceAmount)) {
        context.addIssue({ code: 'custom', path: ['priceAmount'], message: 'validation.priceRange' });
    }
});
