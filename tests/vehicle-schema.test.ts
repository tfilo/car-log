import { expect, test } from 'vitest';
import { FuelType } from '../src/generated/prisma/enums';
import { vehicleSchema, updateVehicleSchema } from '../src/vehicles/vehicle-schema';
import { vehicleFormSchema } from '../src/vehicles/vehicle-form-schema';

const input = {
    manufacturer: 'Synthetic',
    model: 'Vehicle',
    fuelTypes: [FuelType.PETROL]
};

const schemas = [
    { name: 'create', schema: vehicleSchema, input },
    { name: 'update', schema: updateVehicleSchema, input: { ...input, vehicleId: '00000000-0000-4000-8000-000000000001' } },
    { name: 'form', schema: vehicleFormSchema, input: { ...input, picture: null } }
];

test.each(schemas)('$name rejects plates whose uppercase value exceeds the stored limit', ({ schema, input: values }) => {
    const result = schema.safeParse({ ...values, licensePlate: 'ß'.repeat(16) });

    expect(result.success).toBe(false);
    if (!result.success)
        expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ['licensePlate'], message: 'validation.length' }));
});

test.each(schemas)('$name accepts the normalized plate boundary and can validate the output again', ({ schema, input: values }) => {
    const result = schema.parse({ ...values, licensePlate: 'ß'.repeat(15) });

    expect(result.licensePlate).toBe('S'.repeat(30));
    expect(schema.parse(result)).toEqual(result);
});

test.each(schemas)('$name rejects non-ASCII VIN characters before uppercasing', ({ schema, input: values }) => {
    const result = schema.safeParse({ ...values, vin: 'ß'.repeat(16) });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ['vin'], message: 'validation.vin' }));
});

test('ordinary plates and lowercase ASCII VINs retain their normalization and limits', () => {
    const values = schemas[0].input;
    const parsed = vehicleSchema.parse({ ...values, licensePlate: ' ab-123 ', vin: 'a'.repeat(32) });

    expect(parsed.licensePlate).toBe('AB-123');
    expect(parsed.vin).toBe('A'.repeat(32));
    expect(vehicleSchema.parse(parsed)).toEqual(parsed);
    expect(vehicleSchema.safeParse({ ...values, licensePlate: 'A'.repeat(31) }).success).toBe(false);
    expect(vehicleSchema.safeParse({ ...values, vin: 'a'.repeat(33) }).success).toBe(false);
});

test.each([undefined, null, '', '   '])('blank optional identifiers remain null', (value) => {
    const parsed = vehicleSchema.parse({ ...schemas[0].input, licensePlate: value, vin: value });

    expect(parsed.licensePlate).toBeNull();
    expect(parsed.vin).toBeNull();
});
