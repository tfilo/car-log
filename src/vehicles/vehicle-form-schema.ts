import { z } from 'zod';
import { vehicleSchema } from './vehicle-schema';
import { pictureMaxBytes } from './picture-policy';

export const vehicleFormSchema = vehicleSchema.extend({
    picture: z.file({ error: 'validation.picture' }).max(pictureMaxBytes, 'validation.pictureSize').nullable()
});
