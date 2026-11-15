import { z } from 'zod';
import { fuelString } from '../fuel/fuel-schema';
import { statisticsSchema } from './statistics-schema';
import { StatisticsPeriod } from './statistics-values';

const formSchema = z.strictObject({
    vehicleId: statisticsSchema.shape.vehicleId,
    period: z.enum(StatisticsPeriod, { error: 'validation.period' }),
    from: fuelString(10, 'validation.date'),
    to: fuelString(10, 'validation.date')
});

export type StatisticsFormValues = z.input<typeof formSchema>;

export function statisticsFormInput(value: StatisticsFormValues): z.input<typeof statisticsSchema> {
    return {
        vehicleId: value.vehicleId,
        period: value.period,
        ...(value.period === StatisticsPeriod.CUSTOM ? { from: value.from, to: value.to } : {})
    };
}

export const statisticsFormSchema = formSchema.superRefine((value, context) => {
    const parsed = statisticsSchema.safeParse(statisticsFormInput(value));

    if (!parsed.success) {
        for (const issue of parsed.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
});
