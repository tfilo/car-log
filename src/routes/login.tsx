/* eslint-disable react-refresh/only-export-components */
import { useState } from 'react';
import { createFileRoute, Link, redirect, useRouter } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useTranslation } from 'react-i18next';
import { Column, Grid, Page, Section, useAppForm } from '@tfilo/tope-ui';
import { ResultKind } from '../common/result-kind';
import { currentUserOptions, replaceCurrentUser, responseErrorKeys, transportErrorKey } from '../ui/session';
import { translatedSchema } from '../i18n/form-schema';
import { ErrorMessages } from '../ui/feedback';
import { login, getRegistrationAvailability } from '../auth/auth';
import { loginSchema } from '../auth/login-schema';
import { usePasswordVisibility } from '../ui/use-password-visibility';

export const Route = createFileRoute('/login')({
    beforeLoad: async ({ context }) => {
        if (await context.queryClient.query(currentUserOptions)) throw redirect({ to: '/' });
    },
    loader: () => getRegistrationAvailability(),
    component: LoginPage
});

function LoginPage() {
    const { t } = useTranslation('auth');
    const queryClient = useQueryClient();
    const router = useRouter();
    const signIn = useServerFn(login);
    const { enabled: registrationEnabled } = Route.useLoaderData();

    const [errors, setErrors] = useState<string[]>([]);

    const passwordVisibility = usePasswordVisibility();

    const form = useAppForm({
        defaultValues: { identifier: '', password: '' },
        validators: { onChange: translatedSchema(loginSchema, t) },
        onSubmit: async ({ value, formApi }) => {
            setErrors([]);

            try {
                const result = await signIn({ data: value });

                if (result.kind !== ResultKind.AUTHENTICATED) {
                    setErrors(responseErrorKeys(result));

                    return;
                }

                formApi.reset();
                await replaceCurrentUser(queryClient, result.user);
                await router.invalidate();
                await router.navigate({ to: '/', replace: true });
            } catch (error) {
                setErrors([transportErrorKey(error)]);
            }
        }
    });

    return (
        <Page title={t('login.heading')}>
            <Section>
                <form
                    noValidate
                    className='flex flex-col gap-xl'
                    onSubmit={(event) => {
                        event.preventDefault();
                        void form.handleSubmit();
                    }}
                >
                    <Grid>
                        <Column>
                            <form.AppField name='identifier'>
                                {(field) => (
                                    <field.Input
                                        label={t('passwordReset.identifier')}
                                        type='text'
                                        autoComplete='username'
                                        required
                                        maxLength={254}
                                    />
                                )}
                            </form.AppField>
                        </Column>
                    </Grid>
                    <Grid>
                        <Column>
                            <form.AppField name='password'>
                                {(field) => (
                                    <field.Input
                                        label={t('login.password')}
                                        {...passwordVisibility}
                                        required
                                        maxLength={128}
                                    />
                                )}
                            </form.AppField>
                        </Column>
                    </Grid>
                    <ErrorMessages errors={errors} />
                    <form.AppForm>
                        <form.Subscribe selector={(state) => state.isSubmitting}>
                            {(busy) => <form.SubscribeButton>{t(busy ? 'common.working' : 'login.submit')}</form.SubscribeButton>}
                        </form.Subscribe>
                    </form.AppForm>
                </form>
                <div className='mt-xl flex flex-col gap-lg'>
                    <Link
                        to='/forgot-password'
                        className='text-primary underline'
                    >
                        {t('login.forgotPassword')}
                    </Link>
                    {registrationEnabled && (
                        <Link
                            to='/register'
                            className='text-primary underline'
                        >
                            {t('login.register')}
                        </Link>
                    )}
                </div>
            </Section>
        </Page>
    );
}
