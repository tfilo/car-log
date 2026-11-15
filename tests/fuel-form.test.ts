import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { FuelType } from '../src/generated/prisma/enums';
import { FuelPriceInput } from '../src/fuel/fuel-values';
import { fuelTimeCandidates, localFuelTime, resolveFuelTime } from '../src/fuel/fuel-time';
import { fuelPricePreview } from '../src/fuel/fuel-format';
import { fuelFormSchema, fuelFormInput, type FuelFormValues } from '../src/fuel/fuel-form-schema';

const input: FuelFormValues = {
    vehicleId: randomUUID(),
    fuelType: FuelType.PETROL,
    occurredAt: '2026-07-15T14:30:00',
    timeInstant: '',
    quantity: 1.005,
    odometer: 1000.5,
    priceType: FuelPriceInput.UNIT,
    priceAmount: 1,
    isFull: true,
    previousRecordMissing: false
};

test('GUI calendar values use Bratislava in winter and summer independently of host timezone', () => {
    expect(fuelTimeCandidates('2026-01-15T14:30:00')).toEqual(['2026-01-15T13:30:00.000Z']);
    expect(fuelTimeCandidates('2026-07-15T14:30:00')).toEqual(['2026-07-15T12:30:00.000Z']);
    expect(localFuelTime('2026-07-15T12:30:00.123Z')).toBe('2026-07-15T14:30:00');
    expect(resolveFuelTime(input.occurredAt, '2026-07-15T12:30:00.123Z')).toBe('2026-07-15T12:30:00.123Z');
});

test('spring gaps are invalid and autumn repeated times require an explicit occurrence', () => {
    expect(fuelTimeCandidates('2026-03-29T02:30:00')).toEqual([]);
    expect(fuelTimeCandidates('2026-10-25T02:30:00')).toEqual(['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']);
    expect(resolveFuelTime('2026-10-25T02:30:00', '')).toBeNull();
    expect(resolveFuelTime('2026-10-25T02:30:00', '2026-10-25T01:30:00.123Z')).toBe('2026-10-25T01:30:00.123Z');
    expect(fuelFormSchema.safeParse({ ...input, occurredAt: '2026-10-25T02:30:00' }).error?.issues).toMatchObject([
        { path: ['timeInstant'], message: 'validation.timeChoice' }
    ]);
    expect(fuelFormSchema.safeParse({ ...input, occurredAt: '2026-03-29T02:30:00' }).success).toBe(false);
    expect(fuelTimeCandidates('2026-02-30T12:00:00')).toEqual([]);
});

test('forms accept numbers and map shared backend validation to visible fields', () => {
    expect(fuelFormSchema.safeParse(input).success).toBe(true);
    expect(fuelFormInput(input)).toMatchObject({ occurredAt: '2026-07-15T12:30:00.000Z', quantity: 1.005, odometer: 1000.5 });
    expect(fuelFormSchema.safeParse({ ...input, priceAmount: -1 }).error?.issues).toMatchObject([
        { path: ['priceAmount'], message: 'validation.decimal' }
    ]);
    expect(fuelFormSchema.safeParse({ ...input, quantity: 999999.999, priceAmount: 999999.999999 }).error?.issues).toMatchObject([
        { path: ['priceAmount'], message: 'validation.priceRange' }
    ]);
});

test('client previews use the same numeric price calculation as the server', () => {
    expect(fuelPricePreview(1.005, FuelPriceInput.UNIT, 1)).toEqual({ totalPrice: 1.01, unitPrice: 1.004975 });
    expect(fuelPricePreview(3, FuelPriceInput.TOTAL, 10)).toEqual({ totalPrice: 10.0, unitPrice: 3.333333 });
    expect(fuelPricePreview(0.1, FuelPriceInput.UNIT, 0.1)).toEqual({ totalPrice: 0.01, unitPrice: 0.1 });
    expect(fuelPricePreview(20, FuelPriceInput.TOTAL, 0)).toEqual({ totalPrice: 0.0, unitPrice: 0.0 });
    expect(fuelPricePreview(0, FuelPriceInput.TOTAL, 1)).toBeNull();
});

test.each(['vehicleId', 'occurredAt', 'timeInstant'] as const)(
    'oversized form field %s aborts before conversion and cross-field validation',
    (field) => {
        const result = fuelFormSchema.safeParse({ ...input, [field]: ' '.repeat(100_000) });

        expect(result.error?.issues).toMatchObject([{ code: 'too_big', path: [field] }]);
    }
);
