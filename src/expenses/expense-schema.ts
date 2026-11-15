import { z } from 'zod';
import { fuelRecordSchema, fuelString } from '../fuel/fuel-schema';
import { fuelInputLimits } from '../fuel/fuel-input-limits';

export const expenseInputLimits = { ...fuelInputLimits, categoryName: 100, comment: 1000 } as const;

const shapeError = { error: 'validation.shape' } as const;
const categoryId = fuelString(expenseInputLimits.uuid, 'validation.categoryId').pipe(z.uuid({ error: 'validation.categoryId' }));
const expenseId = fuelString(expenseInputLimits.uuid, 'validation.expenseId').pipe(z.uuid({ error: 'validation.expenseId' }));
const page = z.int({ error: 'validation.pagination' }).min(0, 'validation.pagination').default(0);
const pageSize = z.int({ error: 'validation.pagination' }).min(1, 'validation.pagination').max(100, 'validation.pagination').default(25);

export const categorySchema = z.strictObject(
    {
        name: fuelString(expenseInputLimits.categoryName, 'validation.categoryName').trim().min(1, 'validation.categoryName'),
        serviceIntervalKm: z
            .int({ error: 'validation.serviceIntervalKm' })
            .min(1, 'validation.serviceIntervalKm')
            .max(1000000, 'validation.serviceIntervalKm')
            .nullable()
            .optional(),
        serviceIntervalMonths: z
            .int({ error: 'validation.serviceIntervalMonths' })
            .min(1, 'validation.serviceIntervalMonths')
            .max(1200, 'validation.serviceIntervalMonths')
            .nullable()
            .optional()
    },
    shapeError
);

export const updateCategorySchema = categorySchema.extend({
    categoryId,
    isArchived: z.boolean({ error: 'validation.archive' })
});

export const categoryIdSchema = z.strictObject({ categoryId }, shapeError);

export const deleteCategorySchema = categoryIdSchema.extend({ confirmed: z.literal(true, { error: 'validation.confirmation' }) });

export const categoryListSchema = z.strictObject(
    { page, pageSize, includeArchived: z.boolean({ error: 'validation.archive' }).default(true) },
    shapeError
);

export const expenseSchema = z.strictObject(
    {
        vehicleId: fuelRecordSchema.shape.vehicleId,
        categoryId,
        occurredAt: fuelRecordSchema.shape.occurredAt,
        odometer: fuelRecordSchema.shape.odometer,
        totalPrice: fuelRecordSchema.shape.price.options[0].shape.totalPrice,
        comment: fuelString(expenseInputLimits.comment, 'validation.comment').trim().optional()
    },
    shapeError
);

export const expenseIdSchema = z.strictObject({ expenseId }, shapeError);

export const updateExpenseSchema = expenseSchema.extend({ expenseId });

export const deleteExpenseSchema = expenseIdSchema.extend({ confirmed: z.literal(true, { error: 'validation.confirmation' }) });

export const expenseListSchema = z.strictObject(
    { vehicleId: expenseSchema.shape.vehicleId, categoryId: categoryId.optional(), page, pageSize },
    shapeError
);
