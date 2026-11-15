/* eslint-disable react-refresh/only-export-components */
import { useState } from 'react';
import type { z } from 'zod';
import { createFileRoute, useRouter, redirect } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useTranslation } from 'react-i18next';
import { Column, Grid, Page, Section, useAppForm } from '@tfilo/tope-ui';
import { ResultKind } from '../common/result-kind';
import { currentUserOptions, responseErrorKeys, transportErrorKey } from '../ui/session';
import { translatedSchema } from '../i18n/form-schema';
import { ErrorMessages } from '../ui/feedback';
import { register, getRegistrationAvailability } from '../auth/auth';
import { registrationFormSchema } from '../ui/auth-form-schemas';
import { EmailDeliveryStatus } from '../email/email-delivery-status';
import { UserStatus } from '../generated/prisma/enums';
import { usePasswordVisibility } from '../ui/use-password-visibility';

export const Route = createFileRoute('/register')({
    beforeLoad: async ({ context }) => {
        if (await context.queryClient.query(currentUserOptions)) throw redirect({ to: '/' });
        if (!(await getRegistrationAvailability()).enabled) throw redirect({ to: '/login' });
    },
    component: RegistrationPage
});

function RegistrationPage() {
    const { t } = useTranslation('auth');
    const router = useRouter();
    const createAccount = useServerFn(register);

    const [errors, setErrors] = useState<string[]>([]);
    const [completed, setCompleted] = useState(false);
    const [pendingApproval, setPendingApproval] = useState(false);
    const [deliveryFailed, setDeliveryFailed] = useState(false);

    const defaultValues: z.input<typeof registrationFormSchema> = {
        email: '',
        username: '',
        firstName: '',
        lastName: '',
        password: '',
        confirmPassword: ''
    };

    const passwordVisibility = usePasswordVisibility();
    const confirmationVisibility = usePasswordVisibility();

    const form = useAppForm({
        defaultValues,
        validators: { onChange: translatedSchema(registrationFormSchema, t) },
        onSubmit: async ({ value, formApi }) => {
            setErrors([]);

            try {
                const data = {
                    email: value.email,
                    username: value.username,
                    firstName: value.firstName,
                    lastName: value.lastName,
                    password: value.password
                };
                const result = await createAccount({ data });

                if (result.kind !== ResultKind.CREATED) {
                    setErrors(responseErrorKeys(result));

                    return;
                }

                formApi.reset();

                setPendingApproval(result.status === UserStatus.PENDING);
                setDeliveryFailed(result.verificationDelivery === EmailDeliveryStatus.UNAVAILABLE);
                setCompleted(true);
            } catch (error) {
                setErrors([transportErrorKey(error)]);
            }
        }
    });

    return (
        <Page
            title={t('registration.heading')}
            onBack={() => router.navigate({ to: '/login' })}
        >
            <Section>
                {completed ? (
                    <div role='status'>
                        <p>{t(pendingApproval ? 'registration.pending' : 'registration.active')}</p>
                        <p>{t(deliveryFailed ? 'registration.deliveryFailed' : 'registration.verificationSent')}</p>
                    </div>
                ) : (
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
                                <form.AppField name='email'>
                                    {(field) => (
                                        <field.Input
                                            label={t('profile.email')}
                                            type='email'
                                            autoComplete='email'
                                            required
                                            maxLength={254}
                                        />
                                    )}
                                </form.AppField>
                            </Column>
                        </Grid>
                        <Grid>
                            <Column>
                                <form.AppField name='username'>
                                    {(field) => (
                                        <field.Input
                                            label={t('profile.username')}
                                            type='text'
                                            autoComplete='username'
                                            required
                                            maxLength={30}
                                            aria-describedby='username-rules'
                                        />
                                    )}
                                </form.AppField>
                            </Column>
                        </Grid>
                        <p
                            id='username-rules'
                            className='text-sm'
                        >
                            {t('registration.usernameRules')}
                        </p>
                        <Grid>
                            <Column>
                                <form.AppField name='firstName'>
                                    {(field) => (
                                        <field.Input
                                            label={t('profile.firstName')}
                                            type='text'
                                            autoComplete='given-name'
                                            maxLength={100}
                                        />
                                    )}
                                </form.AppField>
                            </Column>
                        </Grid>
                        <Grid>
                            <Column>
                                <form.AppField name='lastName'>
                                    {(field) => (
                                        <field.Input
                                            label={t('profile.lastName')}
                                            type='text'
                                            autoComplete='family-name'
                                            maxLength={100}
                                        />
                                    )}
                                </form.AppField>
                            </Column>
                        </Grid>
                        <p
                            id='password-rules'
                            className='text-sm'
                        >
                            {t('passwordReset.passwordRules')}
                        </p>
                        <Grid>
                            <Column>
                                <form.AppField name='password'>
                                    {(field) => (
                                        <field.Input
                                            label={t('login.password')}
                                            {...passwordVisibility}
                                            required
                                            maxLength={128}
                                            aria-describedby='password-rules'
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
                                            maxLength={128}
                                        />
                                    )}
                                </form.AppField>
                            </Column>
                        </Grid>
                        <ErrorMessages errors={errors} />
                        <form.AppForm>
                            <form.Subscribe selector={(state) => state.isSubmitting}>
                                {(busy) => (
                                    <form.SubscribeButton>{t(busy ? 'common.working' : 'registration.submit')}</form.SubscribeButton>
                                )}
                            </form.Subscribe>
                        </form.AppForm>
                    </form>
                )}
            </Section>
        </Page>
    );
}
