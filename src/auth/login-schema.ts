import { z } from 'zod';

export const loginSchema = z.strictObject(
    {
        identifier: z
            .string({ error: 'validation.login.identifier' })
            .trim()
            .toLowerCase()
            .max(254, 'validation.login.identifier')
            .refine(
                (value) => (value.includes('@') ? z.email().safeParse(value).success : /^[a-z0-9]{3,30}$/.test(value)),
                'validation.login.identifier'
            ),
        // Login must not reapply today's registration complexity rules to old passwords.
        password: z
            .string({ error: 'validation.login.password' })
            .min(1, 'validation.login.password')
            .max(128, 'validation.password.maxLength')
    },
    { error: 'validation.login.shape' }
);
