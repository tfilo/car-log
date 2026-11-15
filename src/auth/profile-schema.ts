import { z } from 'zod';
import { registrationSchema } from './registration-schema';

const optionalName = z
    .string({ error: 'validation.name.invalid' })
    .trim()
    .max(100, 'validation.name.maxLength')
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : value));

export const profileSchema = z
    .strictObject(
        {
            storeFuelLocation: z.boolean({ error: 'validation.profile.location' }).optional(),
            firstName: optionalName,
            lastName: optionalName,
            email: registrationSchema.shape.email.optional(),
            username: registrationSchema.shape.username.optional(),
            currentPassword: z
                .string({ error: 'validation.profile.currentPassword' })
                .max(128, 'validation.password.maxLength')
                .optional()
                .transform((value) => (value === '' ? undefined : value)),
            newPassword: z
                .string({ error: 'validation.password.invalid' })
                .optional()
                .transform((value) => (value === '' ? undefined : value))
                .pipe(registrationSchema.shape.password.optional())
        },
        { error: 'validation.profile.shape' }
    )
    .superRefine((value, context) => {
        if (value.newPassword && !value.currentPassword)
            context.addIssue({ code: 'custom', path: ['currentPassword'], message: 'validation.profile.currentPasswordRequired' });
    });

export const emailTokenSchema = z.strictObject(
    {
        token: z
            .string({ error: 'validation.emailVerification.token' })
            .length(43, 'validation.emailVerification.token')
            .regex(/^[A-Za-z0-9_-]+$/, 'validation.emailVerification.token')
    },
    { error: 'validation.profile.shape' }
);
