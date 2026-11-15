import { expect, test } from 'vitest';
import { fuelLocationSchema } from '../src/fuel/fuel-location-schema';
import { updateFuelRecordSchema } from '../src/fuel/fuel-schema';

const location = { latitude: 51.505, longitude: -0.09, accuracy: 12, capturedAt: '2026-11-12T12:00:00.000Z' };

test('location validates bounded coordinates, accuracy and capture time', () => {
    expect(fuelLocationSchema.safeParse(location).success).toBe(true);
    for (const latitude of [91, -91, NaN, Infinity]) expect(fuelLocationSchema.safeParse({ ...location, latitude }).success).toBe(false);
    expect(fuelLocationSchema.safeParse({ ...location, longitude: 181 }).success).toBe(false);
    expect(fuelLocationSchema.safeParse({ ...location, accuracy: -1 }).success).toBe(false);
    expect(fuelLocationSchema.safeParse({ ...location, capturedAt: 'x'.repeat(1000) }).success).toBe(false);
    expect(fuelLocationSchema.safeParse({ latitude: 51.505 }).success).toBe(false);
});

test('editing accepts coordinates but cannot rewrite original GPS capture metadata', () => {
    const schema = updateFuelRecordSchema.shape.location;
    expect(schema.safeParse({ latitude: 51.505, longitude: -0.09 }).success).toBe(true);
    expect(schema.safeParse(location).success).toBe(false);
});
