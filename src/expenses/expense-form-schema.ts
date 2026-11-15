import { z } from 'zod';
import { fuelString } from '../fuel/fuel-schema';
import { fuelTimeCandidates, resolveFuelTime } from '../fuel/fuel-time';
import { expenseSchema, expenseInputLimits } from './expense-schema';

const formSchema = expenseSchema.omit({ occurredAt: true, odometer: true, totalPrice: true }).extend({
    occurredAt: fuelString(expenseInputLimits.localDateTime, 'validation.occurredAt'),
    timeInstant: fuelString(expenseInputLimits.instant, 'validation.occurredAt'),
    odometer: z.number({ error: 'validation.decimal' }).nullable(),
    totalPrice: z.number({ error: 'validation.decimal' }).nullable()
});

export type ExpenseFormValues = z.input<typeof formSchema>;

export function expenseFormInput(value: ExpenseFormValues): z.input<typeof expenseSchema> {
    const { timeInstant, ...input } = value;

    return {
        ...input,
        occurredAt: resolveFuelTime(value.occurredAt, timeInstant) ?? '',
        odometer: value.odometer ?? NaN,
        totalPrice: value.totalPrice ?? NaN
    };
}

export const expenseFormSchema = formSchema.superRefine((value, context) => {
    const input = expenseFormInput(value);
    const parsed = expenseSchema.safeParse(input);

    if (parsed.success) return;

    const invalidTime = !input.occurredAt;
    const ambiguousTime = invalidTime && fuelTimeCandidates(value.occurredAt).length > 1;

    if (invalidTime) {
        context.addIssue({
            code: 'custom',
            path: [ambiguousTime ? 'timeInstant' : 'occurredAt'],
            message: ambiguousTime ? 'validation.timeChoice' : 'validation.occurredAt'
        });
    }

    for (const issue of parsed.error.issues) {
        if (invalidTime && issue.path[0] === 'occurredAt') continue;

        context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
});
