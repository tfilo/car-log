import { transportErrorKey } from '../ui/session';
import { ResultKind } from '../common/result-kind';
/* eslint-disable react-refresh/only-export-components */
import { useState } from 'react';
import { ClientOnly, useRouter, createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { Column, Grid, Page, useAppForm } from '@tfilo/tope-ui';
import { resetPassword } from '../auth/auth';
import { passwordResetFormSchema } from '../auth/password-reset-form-schema';
import { getAuthErrorKey } from '../auth/auth-errors';
import { useTranslation } from 'react-i18next';
import { translatedSchema } from '../i18n/form-schema';
import { usePasswordVisibility } from '../ui/use-password-visibility';
import { ErrorMessages } from '../ui/feedback';

export const Route = createFileRoute('/reset-password')({
    component: () => (
        <ClientOnly>
            <ResetPasswordPage />
        </ClientOnly>
    ),
    head: () => ({
        meta: [
            { name: 'referrer', content: 'no-referrer' },
            { name: 'robots', content: 'noindex' }
        ]
    })
});

function ResetPasswordPage() {
    const { t } = useTranslation('auth');
    const router = useRouter();
    const reset = useServerFn(resetPassword);

    const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
    const [completed, setCompleted] = useState(false);
    const [errorKeys, setErrorKeys] = useState<string[]>(token ? [] : ['errors.passwordResetTokenInvalid']);

    const newPasswordVisibility = usePasswordVisibility();
    const confirmationVisibility = usePasswordVisibility();

    const form = useAppForm({
        defaultValues: { newPassword: '', confirmPassword: '' },
        validators: { onChange: translatedSchema(passwordResetFormSchema, t) },
        onSubmit: async ({ value, formApi }) => {
            setErrorKeys([]);

            try {
                const result = await reset({ data: { token, newPassword: value.newPassword } });

                if (result.kind === ResultKind.RESET) {
                    formApi.reset();
                    window.history.replaceState(null, '', window.location.pathname);

                    setCompleted(true);
                } else {
                    const validationKeys =
                        result.kind === ResultKind.INVALID
                            ? [...(result.fields.newPassword ?? []), ...(result.fields.token ?? []), ...result.formErrors]
                            : [];

                    setErrorKeys(validationKeys.length ? validationKeys : [getAuthErrorKey(result.code)]);
                }
            } catch (error) {
                setErrorKeys([transportErrorKey(error)]);
            }
        }
    });

    return (
        <Page
            title={t('passwordReset.heading')}
            onBack={() => router.navigate({ to: completed ? '/login' : '/forgot-password' })}
        >
            {completed ? (
                <p role='status'>{t('passwordReset.reset')}</p>
            ) : (
                <>
                    <ErrorMessages errors={errorKeys} />
                    {token && (
                        <form
                            noValidate
                            onSubmit={(event) => {
                                event.preventDefault();
                                void form.handleSubmit();
                            }}
                            className='flex flex-col gap-xl'
                        >
                            <p
                                id='password-rules'
                                className='text-sm'
                            >
                                {t('passwordReset.passwordRules')}
                            </p>
                            <Grid>
                                <Column>
                                    <form.AppField name='newPassword'>
                                        {(field) => (
                                            <field.Input
                                                label={t('passwordReset.newPassword')}
                                                {...newPasswordVisibility}
                                                aria-describedby='password-rules'
                                                required
                                                minLength={10}
                                                maxLength={128}
                                            />
                                        )}
                                    </form.AppField>
                                </Column>
                            </Grid>
                            <Grid>
                                <Column>
                                    <form.AppField name='confirmPassword'>
                                        {(field) => (
                                            <field.Input
                                                label={t('passwordReset.confirmPassword')}
                                                {...confirmationVisibility}
                                                required
                                                minLength={10}
                                                maxLength={128}
                                            />
                                        )}
                                    </form.AppField>
                                </Column>
                            </Grid>
                            <form.AppForm>
                                <form.Subscribe selector={(state) => state.isSubmitting}>
                                    {(isSubmitting) => (
                                        <form.SubscribeButton>
                                            {t(isSubmitting ? 'passwordReset.working' : 'passwordReset.button')}
                                        </form.SubscribeButton>
                                    )}
                                </form.Subscribe>
                            </form.AppForm>
                        </form>
                    )}
                </>
            )}
        </Page>
    );
}
