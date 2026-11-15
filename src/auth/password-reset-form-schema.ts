import { z } from 'zod';
import { passwordResetSchema } from './password-reset-schema';

export const passwordResetFormSchema = passwordResetSchema
    .omit({ token: true })
    .extend({
        confirmPassword: z.string({ error: 'validation.passwordReset.confirmPassword' }).min(1, 'validation.passwordReset.confirmPassword')
    })
    .refine((value) => value.newPassword === value.confirmPassword, {
        path: ['confirmPassword'],
        error: 'passwordReset.passwordMismatch'
    });
