import { z } from 'zod';
import { registrationSchema } from '../auth/registration-schema';
import { profileSchema } from '../auth/profile-schema';

const confirmPassword = z.string({ error: 'validation.passwordReset.confirmPassword' });

export const registrationFormSchema = registrationSchema
    .extend({ confirmPassword })
    .refine((value) => value.password === value.confirmPassword, { path: ['confirmPassword'], error: 'passwordReset.passwordMismatch' });

export function profileFormSchema(email: string, username: string) {
    return profileSchema.safeExtend({ confirmPassword }).superRefine((value, context) => {
        if (value.newPassword && value.newPassword !== value.confirmPassword)
            context.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'passwordReset.passwordMismatch' });

        if ((value.email !== email || value.username !== username) && !value.currentPassword)
            context.addIssue({ code: 'custom', path: ['currentPassword'], message: 'validation.profile.currentPasswordRequired' });
    });
}
