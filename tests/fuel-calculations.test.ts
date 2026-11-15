import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { FuelType } from '../src/generated/prisma/enums';
import { FuelPriceInput, FuelUnit, fuelUnits } from '../src/fuel/fuel-values';
import { fuelRecordSchema } from '../src/fuel/fuel-schema';
import { calculateFuelPrice, calculateFuelConsumption, type ConsumptionRecord } from '../src/fuel/fuel-calculations';

const input = {
    vehicleId: randomUUID(),
    fuelType: FuelType.PETROL,
    occurredAt: '2026-01-01T12:00:00Z',
    odometer: 1000,
    quantity: 1.005,
    price: { type: FuelPriceInput.UNIT, unitPrice: 1 },
    isFull: true
};

function record(id: string, odometer: number, quantity: number, isFull = true, previousRecordMissing = false): ConsumptionRecord {
    return { id, odometer: odometer, quantity: quantity, isFull, previousRecordMissing };
}

test('numeric input is preserved, timestamps normalize, and flags default explicitly', () => {
    const parsed = fuelRecordSchema.parse({ ...input, occurredAt: '2026-01-01T13:00:00+01:00' });

    expect(parsed.occurredAt).toBe('2026-01-01T12:00:00.000Z');
    expect(parsed.quantity).toBe(1.005);
    expect(parsed.previousRecordMissing).toBe(false);
    expect(fuelUnits[FuelType.PETROL]).toBe(FuelUnit.LITRE);
    expect(fuelUnits[FuelType.CNG]).toBe(FuelUnit.KILOGRAM);
    expect(fuelUnits[FuelType.ELECTRIC]).toBe(FuelUnit.KILOWATT_HOUR);
});

test.each([0, -1, NaN, Infinity, 1.0001, 1000000, '1.2'])('rejects invalid fuel quantity %s', (quantity) => {
    expect(fuelRecordSchema.safeParse({ ...input, quantity }).success).toBe(false);
});

test('rejects ambiguous pricing, client-derived data, and timestamps beyond database precision', () => {
    expect(fuelRecordSchema.safeParse({ ...input, price: { type: FuelPriceInput.TOTAL, totalPrice: 2.0, unitPrice: 1.99 } }).success).toBe(
        false
    );
    expect(fuelRecordSchema.safeParse({ ...input, consumptionPer100Km: 5 }).success).toBe(false);
    expect(fuelRecordSchema.safeParse({ ...input, userId: randomUUID() }).success).toBe(false);
    expect(fuelRecordSchema.safeParse({ ...input, occurredAt: '2026-01-01T12:00:00.0001Z' }).success).toBe(false);
    expect(fuelRecordSchema.safeParse({ ...input, occurredAt: '2026-01-01T12:00:00' }).success).toBe(false);
    expect(fuelRecordSchema.safeParse({ ...input, price: { type: FuelPriceInput.TOTAL, totalPrice: 1.005 } }).success).toBe(false);
});

test('unit-price entry rounds the paid total half-up to cents and derives its effective unit price', () => {
    const price = calculateFuelPrice(fuelRecordSchema.parse(input));

    expect(price?.totalPrice).toBe(1.01);
    expect(price?.unitPrice).toBe(1.004975);
    expect(
        calculateFuelPrice(fuelRecordSchema.parse({ ...input, quantity: 0.1, price: { type: FuelPriceInput.UNIT, unitPrice: 0.1 } }))
            ?.totalPrice
    ).toBe(0.01);
    expect(
        calculateFuelPrice(
            fuelRecordSchema.parse({ ...input, quantity: 999999.999, price: { type: FuelPriceInput.UNIT, unitPrice: 999999.999999 } })
        )
    ).toBeNull();
});

test('paid total takes precedence and free charging is supported', () => {
    const price = calculateFuelPrice(
        fuelRecordSchema.parse({ ...input, quantity: 3, price: { type: FuelPriceInput.TOTAL, totalPrice: 10.0 } })
    );
    const free = calculateFuelPrice(
        fuelRecordSchema.parse({ ...input, fuelType: FuelType.ELECTRIC, price: { type: FuelPriceInput.TOTAL, totalPrice: 0 } })
    );

    expect(price?.totalPrice).toBe(10.0);
    expect(price?.unitPrice).toBe(3.333333);
    expect(free?.unitPrice).toBe(0.0);
});

test('full-to-full consumption includes partial fills and excludes the starting quantity', () => {
    const records = [record('before', 0, 20, false), record('start', 100, 90), record('partial', 300, 10, false), record('end', 600, 30)];
    const result = calculateFuelConsumption(records, FuelType.PETROL);

    expect(result.get('before')?.consumptionPer100Km).toBeNull();
    expect(result.get('start')?.consumptionPer100Km).toBeNull();
    expect(result.get('partial')?.consumptionPer100Km).toBeNull();
    expect(result.get('end')?.consumptionDistance).toBe(500);
    expect(result.get('end')?.consumptionQuantity).toBe(40);
    expect(result.get('end')?.consumptionPer100Km).toBe(8);
});

test.each([true, false])('missing history breaks consumption until a new full baseline (missing record is full=%s)', (isFull) => {
    const result = calculateFuelConsumption(
        [record('start', 100, 40), record('missing', 200, 10, isFull, true), record('baseline', 400, 20), record('end', 800, 24)],
        FuelType.DIESEL
    );

    expect(result.get('missing')?.consumptionPer100Km).toBeNull();
    expect(result.get('baseline')?.consumptionPer100Km ?? null).toBe(isFull ? 10 : null);
    expect(result.get('end')?.consumptionPer100Km).toBe(6);
});

test('CNG consumption is per 100 km in kg; EV consumption remains unavailable', () => {
    const records = [record('start', 1000, 100), record('end', 1500, 20)];

    expect(calculateFuelConsumption(records, FuelType.CNG).get('end')?.consumptionPer100Km).toBe(4);
    expect(calculateFuelConsumption(records, FuelType.ELECTRIC).get('end')).toEqual({
        consumptionPer100Km: null,
        consumptionDistance: null,
        consumptionQuantity: null
    });
});

test.each([100, 99])('zero/negative interval distance %s is unavailable', (odometer) => {
    expect(
        calculateFuelConsumption([record('start', 100, 20), record('end', odometer, 10)], FuelType.PETROL).get('end')?.consumptionPer100Km
    ).toBeNull();
});

test.each(['vehicleId', 'occurredAt'] as const)('server rejects oversized raw %s before normalizing it', (field) => {
    const result = fuelRecordSchema.safeParse({ ...input, [field]: ' '.repeat(100_000) + input[field] });

    expect(result.error?.issues).toMatchObject([{ code: 'too_big', path: [field] }]);
});

test('maximum numeric values and millisecond timestamps with offsets remain valid', () => {
    expect(
        fuelRecordSchema.safeParse({
            ...input,
            odometer: 999999999.999,
            quantity: 999999.999,
            price: { type: FuelPriceInput.UNIT, unitPrice: 999999.999999 },
            occurredAt: '2026-01-01T13:00:00.123+01:00'
        }).success
    ).toBe(true);
    expect(fuelRecordSchema.safeParse({ ...input, price: { type: FuelPriceInput.TOTAL, totalPrice: 99999999.99 } }).success).toBe(true);
});
