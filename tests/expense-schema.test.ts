import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { categorySchema, expenseSchema, deleteCategorySchema, categoryListSchema } from '../src/expenses/expense-schema';
import { expenseFormSchema, expenseFormInput } from '../src/expenses/expense-form-schema';

const input = {
    vehicleId: randomUUID(),
    categoryId: randomUUID(),
    occurredAt: '2026-07-15T12:30:00.123Z',
    odometer: 999999999.999,
    totalPrice: 99999999.99,
    comment: 'Synthetic service'
};

test('category names trim, reject empty/oversized values, and pagination is bounded and zero-based', () => {
    expect(categorySchema.parse({ name: ' Service ' })).toEqual({ name: 'Service' });
    expect(categorySchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(categorySchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false);
    expect(categoryListSchema.parse({})).toEqual({ page: 0, pageSize: 25, includeArchived: true });
    expect(categoryListSchema.safeParse({ page: -1 }).success).toBe(false);
    expect(categoryListSchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(deleteCategorySchema.safeParse({ categoryId: input.categoryId, confirmed: false }).success).toBe(false);
});

test('expense validation accepts precise range boundaries but rejects extra fields and excessive precision', () => {
    expect(expenseSchema.safeParse(input).success).toBe(true);
    expect(expenseSchema.safeParse({ ...input, totalPrice: 0, odometer: 0 }).success).toBe(true);
    expect(expenseSchema.safeParse({ ...input, userId: randomUUID() }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...input, comment: 'x'.repeat(1001) }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...input, occurredAt: '2026-01-01T12:00:00' }).success).toBe(false);
});

test.each([-1, '1e2', 'NaN', 100000000.0, 1.001])('rejects invalid EUR amount %s', (totalPrice) => {
    expect(expenseSchema.safeParse({ ...input, totalPrice }).success).toBe(false);
});

test.each(['vehicleId', 'categoryId', 'occurredAt', 'comment'] as const)(
    'raw length for %s aborts before parsing/normalization',
    (field) => {
        expect(expenseSchema.safeParse({ ...input, [field]: ' '.repeat(100_000) }).error?.issues).toMatchObject([
            { code: 'too_big', path: [field] }
        ]);
    }
);

test('GUI accepts numbers and converts Bratislava time, preserves milliseconds and rejects DST gaps/ambiguity', () => {
    const form = { ...input, occurredAt: '2026-07-15T14:30:00', timeInstant: input.occurredAt, odometer: 1200.5, totalPrice: 12.34 };

    expect(expenseFormSchema.safeParse(form).success).toBe(true);
    expect(expenseFormInput(form)).toMatchObject({ occurredAt: input.occurredAt, totalPrice: 12.34, odometer: 1200.5 });
    expect(expenseFormSchema.safeParse({ ...form, occurredAt: '2026-03-29T02:30:00', timeInstant: '' }).success).toBe(false);
    expect(expenseFormSchema.safeParse({ ...form, occurredAt: '2026-10-25T02:30:00', timeInstant: '' }).error?.issues).toMatchObject([
        { path: ['timeInstant'], message: 'validation.timeChoice' }
    ]);
    expect(expenseFormSchema.safeParse({ ...form, totalPrice: ' '.repeat(100_000) }).error?.issues).toMatchObject([
        { code: 'invalid_type', path: ['totalPrice'] }
    ]);
});
