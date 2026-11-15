import { expect, test, vi } from 'vitest';
import { FormApi, FieldApi } from '@tanstack/react-form';
import { passwordResetRequestSchema } from '../src/auth/password-reset-schema';
import { passwordResetFormSchema } from '../src/auth/password-reset-form-schema';
import { translatedSchema } from '../src/i18n/form-schema';
import { i18n } from '../src/i18n';

test('reset form applies password policy and requires matching confirmation', () => {
    expect(passwordResetFormSchema.safeParse({ newPassword: 'Password123!', confirmPassword: 'Password123!' }).success).toBe(true);
    expect(passwordResetFormSchema.safeParse({ newPassword: 'weak', confirmPassword: 'weak' }).success).toBe(false);

    const mismatch = passwordResetFormSchema.safeParse({ newPassword: 'Password123!', confirmPassword: 'OtherPassword123!' });

    expect(mismatch.success).toBe(false);

    if (mismatch.success) throw new Error('Expected mismatched passwords');

    expect(mismatch.error.issues).toContainEqual(
        expect.objectContaining({ path: ['confirmPassword'], message: 'passwordReset.passwordMismatch' })
    );
});

test('a corrected identifier submits after a failed validation attempt', async () => {
    const submit = vi.fn();
    const form = new FormApi({
        defaultValues: { identifier: '' },
        validators: { onChange: translatedSchema(passwordResetRequestSchema, i18n.t) },
        onSubmit: submit
    });
    const unmountForm = form.mount();
    const field = new FieldApi({ form, name: 'identifier' });
    const unmountField = field.mount();

    try {
        await form.handleSubmit();
        expect(submit).not.toHaveBeenCalled();
        expect(field.state.meta.isTouched).toBe(true);
        expect(field.state.meta.errors).toContainEqual(expect.objectContaining({ message: i18n.t('validation.login.identifier') }));
        field.handleChange('synthetic@example.test');
        await form.handleSubmit();
        expect(submit).toHaveBeenCalledTimes(1);
    } finally {
        unmountField();
        unmountForm();
    }
});
