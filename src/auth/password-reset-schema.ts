import { z } from 'zod';
import { loginSchema } from './login-schema';
import { registrationSchema } from './registration-schema';

export const passwordResetRequestSchema = z.strictObject(
    {
        identifier: loginSchema.shape.identifier
    },
    { error: 'validation.passwordReset.shape' }
);

export const passwordResetSchema = z.strictObject(
    {
        token: z
            .string({ error: 'validation.passwordReset.token' })
            .length(43, 'validation.passwordReset.token')
            .regex(/^[A-Za-z0-9_-]+$/, 'validation.passwordReset.token'),
        newPassword: registrationSchema.shape.password
    },
    { error: 'validation.passwordReset.shape' }
);
