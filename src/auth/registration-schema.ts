import { z } from 'zod';

const specialCharacters = new Set('*$#&,.%@-_~|\\/!?^');

const optionalName = z
    .string({ error: 'validation.name.invalid' })
    .trim()
    .max(100, 'validation.name.maxLength')
    .optional()
    .transform((value) => value || undefined);

export const registrationSchema = z.strictObject(
    {
        email: z
            .string({ error: 'validation.email.invalid' })
            .trim()
            .toLowerCase()
            .max(254, 'validation.email.maxLength')
            .pipe(z.email({ error: 'validation.email.invalid' })),
        username: z
            .string({ error: 'validation.username.invalid' })
            .min(3, 'validation.username.minLength')
            .max(30, 'validation.username.maxLength')
            .regex(/^[a-z0-9]+$/, 'validation.username.characters'),
        password: z
            .string({ error: 'validation.password.invalid' })
            .min(10, 'validation.password.minLength')
            .max(128, 'validation.password.maxLength')
            .regex(/[a-z]/, 'validation.password.lowercase')
            .regex(/[A-Z]/, 'validation.password.uppercase')
            .regex(/[0-9]/, 'validation.password.digit')
            .refine(
                (value) => [...value].every((character) => /^[a-zA-Z0-9]$/.test(character) || specialCharacters.has(character)),
                'validation.password.characters'
            ),
        firstName: optionalName,
        lastName: optionalName
    },
    { error: 'validation.registration.shape' }
);
