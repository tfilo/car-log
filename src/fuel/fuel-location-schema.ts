import { z } from 'zod';
import { fuelInputLimits } from './fuel-input-limits';

export const fuelLocationSchema = z.strictObject(
    {
        manuallyAdjusted: z.boolean({ error: 'validation.location' }).optional(),
        latitude: z.number({ error: 'validation.location' }).min(-90, 'validation.location').max(90, 'validation.location'),
        longitude: z.number({ error: 'validation.location' }).min(-180, 'validation.location').max(180, 'validation.location'),
        accuracy: z.number({ error: 'validation.location' }).min(0, 'validation.location').max(40075000, 'validation.location'),
        capturedAt: z
            .string({ error: 'validation.location' })
            .max(fuelInputLimits.instant, 'validation.location')
            .pipe(z.iso.datetime({ error: 'validation.location' }))
    },
    { error: 'validation.location' }
);

export type FuelLocation = z.infer<typeof fuelLocationSchema>;
