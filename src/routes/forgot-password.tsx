import { transportErrorKey } from '../ui/session';
import { ResultKind } from '../common/result-kind';
/* eslint-disable react-refresh/only-export-components */
import { useState } from 'react';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { Column, Grid, Page, useAppForm } from '@tfilo/tope-ui';
import { requestPasswordReset } from '../auth/auth';
import { passwordResetRequestSchema } from '../auth/password-reset-schema';
import { getAuthErrorKey } from '../auth/auth-errors';
import { useTranslation } from 'react-i18next';
import { translatedSchema } from '../i18n/form-schema';

export const Route = createFileRoute('/forgot-password')({ component: ForgotPasswordPage });

function ForgotPasswordPage() {
    const { t } = useTranslation('auth');
    const router = useRouter();
    const requestReset = useServerFn(requestPasswordReset);

    const [requested, setRequested] = useState(false);
    const [errorKey, setErrorKey] = useState<string | null>(null);

    const form = useAppForm({
        defaultValues: { identifier: '' },
        validators: { onChange: translatedSchema(passwordResetRequestSchema, t) },
        onSubmit: async ({ value }) => {
            setErrorKey(null);

            try {
                const result = await requestReset({ data: value });

                if (result.kind === ResultKind.REQUESTED) setRequested(true);
                else setErrorKey(getAuthErrorKey(result.code));
            } catch (error) {
                setErrorKey(transportErrorKey(error));
            }
        }
    });

    return (
        <Page
            title={t('passwordReset.requestHeading')}
            onBack={() => router.navigate({ to: '/login' })}
        >
            {requested ? (
                <p role='status'>{t('passwordReset.requested')}</p>
            ) : (
                <form
                    noValidate
                    onSubmit={(event) => {
                        event.preventDefault();
                        void form.handleSubmit();
                    }}
                    className='flex flex-col gap-xl'
                >
                    <Grid>
                        <Column>
                            <form.AppField name='identifier'>
                                {(field) => (
                                    <field.Input
                                        label={t('passwordReset.identifier')}
                                        autoComplete='username'
                                        required
                                        maxLength={254}
                                    />
                                )}
                            </form.AppField>
                        </Column>
                    </Grid>
                    {errorKey && (
                        <p
                            role='alert'
                            className='text-danger'
                        >
                            {t(errorKey)}
                        </p>
                    )}
                    <form.AppForm>
                        <form.Subscribe selector={(state) => state.isSubmitting}>
                            {(isSubmitting) => (
                                <form.SubscribeButton>
                                    {t(isSubmitting ? 'passwordReset.working' : 'passwordReset.requestButton')}
                                </form.SubscribeButton>
                            )}
                        </form.Subscribe>
                    </form.AppForm>
                </form>
            )}
        </Page>
    );
}
