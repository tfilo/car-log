import { z } from 'zod';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { zip, unzipSync, strToU8, strFromU8 } from 'fflate';
import { vehicleSchema } from '../vehicles/vehicle-schema';
import { categorySchema, expenseSchema } from '../expenses/expense-schema';
import { fuelRecordSchema } from '../fuel/fuel-schema';

export const archiveLimit = 100 * 1024 * 1024;
const id = z.uuid();
const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const timestamps = { createdAt: instant, updatedAt: instant };
const vehicle = vehicleSchema.extend({
    id,
    picture: z
        .string()
        .regex(/^images\/[0-9a-f-]{36}\.jpg$/)
        .nullable(),
    ...timestamps
});
const category = categorySchema.extend({ id, isArchived: z.boolean(), ...timestamps });
const fuel = fuelRecordSchema
    .omit({ price: true, location: true })
    .extend({
        id,
        totalPrice: fuelRecordSchema.shape.price.options[0].shape.totalPrice,
        unitPrice: z.number().finite().nonnegative().max(999999999999),
        latitude: z.number().min(-90).max(90).nullable(),
        longitude: z.number().min(-180).max(180).nullable(),
        locationAccuracy: z.number().finite().nonnegative().nullable(),
        locationCapturedAt: instant.nullable(),
        locationManuallyAdjusted: z.boolean(),
        ...timestamps
    })
    .refine(
        (row) =>
            [row.latitude, row.longitude, row.locationAccuracy, row.locationCapturedAt].every((v) => v === null) ||
            [row.latitude, row.longitude, row.locationAccuracy, row.locationCapturedAt].every((v) => v !== null)
    );
const expense = expenseSchema.extend({ id, comment: z.string().max(1000).nullable(), ...timestamps });

export const archiveSchemas = { vehicles: vehicle, categories: category, fuel, expenses: expense };
export const archiveColumns = {
    vehicles: ['id', ...Object.keys(vehicleSchema.shape), 'picture', 'createdAt', 'updatedAt'],
    categories: ['id', ...Object.keys(categorySchema.shape), 'isArchived', 'createdAt', 'updatedAt'],
    fuel: [
        'id',
        'vehicleId',
        'fuelType',
        'occurredAt',
        'odometer',
        'quantity',
        'totalPrice',
        'unitPrice',
        'isFull',
        'previousRecordMissing',
        'latitude',
        'longitude',
        'locationAccuracy',
        'locationCapturedAt',
        'locationManuallyAdjusted',
        'createdAt',
        'updatedAt'
    ],
    expenses: ['id', 'vehicleId', 'categoryId', 'occurredAt', 'odometer', 'totalPrice', 'comment', 'createdAt', 'updatedAt']
};

// JSON scalar cells preserve null, booleans, arrays, and text exactly; CSV handles quoting/newlines.
export function csvBytes(rows: Record<string, unknown>[], columns: string[]): Uint8Array {
    return strToU8(
        stringify(
            rows.map((row) => Object.fromEntries(columns.map((key) => [key, JSON.stringify(row[key])]))),
            { header: true, columns }
        )
    );
}

export function packArchive(files: Record<string, Uint8Array>): Promise<Uint8Array> {
    return new Promise((resolve, reject) => zip(files, { level: 6 }, (error, data) => (error ? reject(error) : resolve(data))));
}

function csvRows<T>(files: Record<string, Uint8Array>, name: keyof typeof archiveSchemas, schema: z.ZodType<T>): T[] {
    const bytes = files[`${name}.csv`];
    if (!bytes) throw new Error('Missing CSV');
    const rows: string[][] = parse(strFromU8(bytes), { bom: true, max_record_size: 16384 });
    const headers = rows.shift();
    if (JSON.stringify(headers) !== JSON.stringify(archiveColumns[name])) throw new Error('Invalid CSV columns');
    return rows.map((values) =>
        schema.parse(Object.fromEntries(headers!.map((key, index) => [key, JSON.parse(values[index]) as unknown])))
    );
}

export function readArchive(bytes: Uint8Array) {
    if (bytes.length > archiveLimit) throw new Error('Archive too large');
    let size = 0;
    let count = 0;
    const names = new Set<string>();
    const files: Record<string, Uint8Array> = unzipSync(bytes, {
        filter: (entry) => {
            if (names.has(entry.name)) throw new Error('Duplicate archive entry');
            names.add(entry.name);
            size += entry.originalSize;
            count++;
            if (
                size > archiveLimit ||
                count > 100000 ||
                !/^(manifest\.json|vehicles\.csv|categories\.csv|fuel\.csv|expenses\.csv|images\/[0-9a-f-]{36}\.jpg)$/.test(entry.name)
            )
                throw new Error('Invalid archive entry');
            return true;
        }
    });
    if (strFromU8(files['manifest.json'] ?? new Uint8Array()) !== '{"format":"car-log","version":1}')
        throw new Error('Unsupported archive');
    const vehicles = csvRows(files, 'vehicles', vehicle);
    const categories = csvRows(files, 'categories', category);
    const fuelRecords = csvRows(files, 'fuel', fuel);
    const expenses = csvRows(files, 'expenses', expense);
    for (const rows of [vehicles, categories, fuelRecords, expenses]) {
        if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error('Duplicate ID');
    }
    const vehicleMap = new Map(vehicles.map((row) => [row.id, row]));
    const categoryIds = new Set(categories.map((row) => row.id));
    for (const row of vehicles) if (row.picture && !files[row.picture]) throw new Error('Missing image');
    const timelines = new Map<string, typeof fuelRecords>();
    for (const row of fuelRecords) {
        if (!vehicleMap.get(row.vehicleId)?.fuelTypes.includes(row.fuelType)) throw new Error('Invalid fuel vehicle');
        const key = `${row.vehicleId}/${row.fuelType}`;
        const timeline = timelines.get(key) ?? [];
        timeline.push(row);
        timelines.set(key, timeline);
    }
    for (const rows of timelines.values()) {
        rows.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
        for (let i = 1; i < rows.length; i++)
            if (rows[i].occurredAt === rows[i - 1].occurredAt || rows[i].odometer <= rows[i - 1].odometer)
                throw new Error('Invalid fuel timeline');
    }
    for (const row of expenses)
        if (!vehicleMap.has(row.vehicleId) || !categoryIds.has(row.categoryId)) throw new Error('Invalid expense reference');
    return { vehicles, categories, fuelRecords, expenses, timelines, files };
}
