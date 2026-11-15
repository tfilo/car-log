import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { FuelType } from '../src/generated/prisma/enums';
import {
    expenseListSearchSchema,
    expenseReturnSearchSchema,
    fuelListSearchSchema,
    fuelReturnSearchSchema
} from '../src/common/list-search';

test('list state preserves validated filters and zero-based pages', () => {
    const fuel = { vehicleId: randomUUID(), fuelType: FuelType.PETROL, page: 1 };
    const expense = { vehicleId: randomUUID(), categoryId: randomUUID(), page: 2 };

    expect(fuelReturnSearchSchema.parse({ returnTo: fuel })).toEqual({ returnTo: fuel });
    expect(expenseReturnSearchSchema.parse({ returnTo: expense })).toEqual({ returnTo: expense });
});

test('malformed return objects and invalid filters/pages fall back without accepting a redirect URL', () => {
    expect(fuelReturnSearchSchema.parse({ returnTo: 'https://example.test' }).returnTo).toBeUndefined();
    expect(expenseReturnSearchSchema.parse({ returnTo: null }).returnTo).toBeUndefined();
    expect(fuelListSearchSchema.parse({ vehicleId: 'invalid', fuelType: 'invalid', page: -1 })).toEqual({
        vehicleId: undefined,
        fuelType: undefined,
        page: undefined
    });
    expect(expenseListSearchSchema.parse({ categoryId: 'invalid', page: 1.5 }).page).toBeUndefined();
    expect(fuelListSearchSchema.parse({ page: 1000001 }).page).toBeUndefined();
    expect(fuelReturnSearchSchema.parse({ returnTo: { url: 'https://example.test', page: 1 } }).returnTo).toEqual({ page: 1 });
});
