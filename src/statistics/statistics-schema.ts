import { z } from 'zod';
import { fuelRecordSchema, fuelString } from '../fuel/fuel-schema';
import { StatisticsPeriod } from './statistics-values';

const day = fuelString(10, 'validation.date').pipe(
    z.iso.date({ error: 'validation.date' }).refine((value) => value >= '1900-01-01' && value <= '2100-12-31', 'validation.date')
);

export const statisticsSchema = z
    .strictObject(
        {
            vehicleId: fuelRecordSchema.shape.vehicleId,
            period: z.enum(StatisticsPeriod, { error: 'validation.period' }).default(StatisticsPeriod.ALL),
            from: day.optional(),
            to: day.optional()
        },
        { error: 'validation.shape' }
    )
    .superRefine((input, context) => {
        if (input.period === StatisticsPeriod.CUSTOM) {
            if (!input.from) context.addIssue({ code: 'custom', path: ['from'], message: 'validation.date' });
            if (!input.to) context.addIssue({ code: 'custom', path: ['to'], message: 'validation.date' });
            if (input.from && input.to && input.from > input.to)
                context.addIssue({ code: 'custom', path: ['to'], message: 'validation.dateOrder' });
        } else if (input.from || input.to) {
            context.addIssue({ code: 'custom', path: ['period'], message: 'validation.period' });
        }
    });
