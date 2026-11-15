import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { strToU8 } from 'fflate';
import { archiveColumns, csvBytes, packArchive, readArchive } from '../src/transfer/archive.server';
import { FuelType } from '../src/generated/prisma/enums';

async function fixture(change?: (files: Record<string, Uint8Array>) => void) {
    const vehicleId = randomUUID();
    const categoryId = randomUUID();
    const timestamps = { createdAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-01T12:00:00.000Z' };
    const files: Record<string, Uint8Array> = {
        'manifest.json': strToU8('{"format":"car-log","version":1}'),
        'vehicles.csv': csvBytes(
            [
                {
                    id: vehicleId,
                    manufacturer: 'Synthetic',
                    model: 'Test',
                    licensePlate: null,
                    vin: null,
                    color: null,
                    registrationDate: null,
                    fuelTypes: [FuelType.PETROL],
                    picture: `images/${vehicleId}.jpg`,
                    ...timestamps
                }
            ],
            archiveColumns.vehicles
        ),
        'categories.csv': csvBytes(
            [
                {
                    id: categoryId,
                    name: 'Synthetic, "service"\ncategory',
                    isArchived: true,
                    serviceIntervalKm: 10000,
                    serviceIntervalMonths: 12,
                    ...timestamps
                }
            ],
            archiveColumns.categories
        ),
        'fuel.csv': csvBytes(
            [
                {
                    id: randomUUID(),
                    vehicleId,
                    fuelType: FuelType.PETROL,
                    occurredAt: timestamps.createdAt,
                    odometer: 12345.678,
                    quantity: 42.123,
                    totalPrice: 65.43,
                    unitPrice: 1.553307,
                    isFull: true,
                    previousRecordMissing: false,
                    latitude: 48.1,
                    longitude: 17.1,
                    locationAccuracy: 5,
                    locationCapturedAt: timestamps.createdAt,
                    locationManuallyAdjusted: true,
                    ...timestamps
                }
            ],
            archiveColumns.fuel
        ),
        'expenses.csv': csvBytes(
            [
                {
                    id: randomUUID(),
                    vehicleId,
                    categoryId,
                    occurredAt: timestamps.createdAt,
                    odometer: 12345.678,
                    totalPrice: 20.12,
                    comment: '=formula,"quoted"\nnew line',
                    ...timestamps
                }
            ],
            archiveColumns.expenses
        ),
        [`images/${vehicleId}.jpg`]: new Uint8Array([1, 2, 3])
    };
    change?.(files);
    return packArchive(files);
}

test('ZIP round trip retains recorded prices, quantities, odometers, GPS, categories, comments and binary images', async () => {
    const archive = readArchive(await fixture());
    expect(archive.fuelRecords[0]).toMatchObject({
        quantity: 42.123,
        totalPrice: 65.43,
        unitPrice: 1.553307,
        odometer: 12345.678,
        latitude: 48.1,
        longitude: 17.1,
        locationAccuracy: 5,
        locationManuallyAdjusted: true
    });
    expect(archive.categories[0]).toMatchObject({
        name: 'Synthetic, "service"\ncategory',
        isArchived: true,
        serviceIntervalKm: 10000,
        serviceIntervalMonths: 12
    });
    expect(archive.expenses[0].comment).toBe('=formula,"quoted"\nnew line');
    expect(archive.files[archive.vehicles[0].picture!]).toEqual(new Uint8Array([1, 2, 3]));
    expect(archive.fuelRecords[0]).not.toHaveProperty('consumptionPer100Km');
});

test('rejects missing CSVs, missing images, unknown versions and path traversal', async () => {
    for (const change of [
        (files: Record<string, Uint8Array>) => {
            delete files['fuel.csv'];
        },
        (files: Record<string, Uint8Array>) => {
            for (const name of Object.keys(files)) if (name.startsWith('images/')) delete files[name];
        },
        (files: Record<string, Uint8Array>) => {
            files['manifest.json'] = strToU8('{"format":"car-log","version":2}');
        },
        (files: Record<string, Uint8Array>) => {
            files['../outside'] = strToU8('bad');
        }
    ])
        await expect(fixture(change).then(readArchive)).rejects.toThrow();
});

test('rejects orphan expense references before importing', async () => {
    const bytes = await fixture((files) => {
        files['categories.csv'] = csvBytes([], archiveColumns.categories);
    });
    expect(() => readArchive(bytes)).toThrow();
});
