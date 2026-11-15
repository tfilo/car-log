import { DataTransferSection } from '../../ui/data-transfer';
/* eslint-disable react-refresh/only-export-components */
import { useState } from 'react';
import type { z } from 'zod';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { useTranslation } from 'react-i18next';
import { Column, Grid, Page, Section, useAppForm } from '@tfilo/tope-ui';
import { updateMyProfile } from '../../auth/auth';
import type { SessionUser } from '../../auth/session.server';
import { ResultKind } from '../../common/result-kind';
import { AuthErrorCode } from '../../auth/auth-errors';
import { EmailDeliveryStatus } from '../../email/email-delivery-status';
import { currentUserOptions, replaceCurrentUser, responseErrorKeys, transportErrorKey } from '../../ui/session';
import { profileFormSchema } from '../../ui/auth-form-schemas';
import { translatedSchema } from '../../i18n/form-schema';
import { ErrorMessages } from '../../ui/feedback';
import { EmailVerification } from '../../ui/email-verification';
import { DeleteOwnAccount } from '../../ui/delete-own-account';
import { usePasswordVisibility } from '../../ui/use-password-visibility';

export const Route = createFileRoute('/_authenticated/profile')({ component: ProfilePage });

function ProfilePage() {
    const { data: user } = useSuspenseQuery(currentUserOptions);

    return user ? (
        <ProfileForm
            key={user.id}
            user={user}
        />
    ) : null;
}

function profileValues(user: SessionUser): z.input<ReturnType<typeof profileFormSchema>> {
    return {
        storeFuelLocation: user.storeFuelLocation,
        firstName: user.firstName ?? '',
        lastName: user.lastName ?? '',
        email: user.email,
        username: user.username,
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
    };
}

function ProfileForm({ user }: { user: SessionUser }) {
    const { t } = useTranslation('auth');
    const update = useServerFn(updateMyProfile);
    const router = useRouter();
    const queryClient = useQueryClient();

    const [errors, setErrors] = useState<string[]>([]);
    const [saved, setSaved] = useState(false);
    const [deliveryFailed, setDeliveryFailed] = useState(false);

    const newPasswordVisibility = usePasswordVisibility();
    const confirmationVisibility = usePasswordVisibility();
    const currentPasswordVisibility = usePasswordVisibility();

    const form = useAppForm({
        defaultValues: profileValues(user),
        validators: { onChange: translatedSchema(profileFormSchema(user.email, user.username), t) },
        onSubmit: async ({ value, formApi }) => {
            setErrors([]);
            setSaved(false);
            setDeliveryFailed(false);

            try {
                const data = {
                    firstName: value.firstName,
                    storeFuelLocation: value.storeFuelLocation,
                    lastName: value.lastName,
                    email: value.email,
                    username: value.username,
                    currentPassword: value.currentPassword,
                    newPassword: value.newPassword
                };
                const result = await update({ data });

                if (result.kind !== ResultKind.UPDATED) {
                    setErrors(responseErrorKeys(result));

                    if ('code' in result && result.code === AuthErrorCode.AUTH_REQUIRED) await replaceCurrentUser(queryClient, null);

                    return;
                }

                formApi.reset(profileValues(result.user));
                await replaceCurrentUser(queryClient, result.user);

                setSaved(true);
                setDeliveryFailed(result.verificationDelivery === EmailDeliveryStatus.UNAVAILABLE);

                await router.invalidate();
            } catch (error) {
                setErrors([transportErrorKey(error)]);
            }
        }
    });

    return (
        <Page title={t('profile.heading')}>
            <Section title={t('profile.details')}>
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
                                    />
                                )}
                            </form.AppField>
                        </Column>
                    </Grid>
                    <p className='text-sm'>{t('profile.sensitiveHelp')}</p>
                    <Section title={t('profile.locationHeading')}>
                        <form.AppField name='storeFuelLocation'>
                            {(field) => <field.Switch label={t('profile.storeFuelLocation')} />}
                        </form.AppField>
                        <p className='text-sm'>{t('profile.locationHelp')}</p>
                    </Section>
                    <Section title={t('profile.passwordHeading')}>
                        <div className='flex flex-col gap-xl'>
                            <p className='text-sm'>{t('profile.passwordHelp')}</p>
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
                                                maxLength={128}
                                            />
                                        )}
                                    </form.AppField>
                                </Column>
                            </Grid>
                        </div>
                    </Section>
                    <Grid>
                        <Column>
                            <form.AppField name='currentPassword'>
                                {(field) => (
                                    <field.Input
                                        label={t('profile.currentPassword')}
                                        {...currentPasswordVisibility}
                                        maxLength={128}
                                    />
                                )}
                            </form.AppField>
                        </Column>
                    </Grid>
                    <ErrorMessages errors={errors} />
                    {saved && <p role='status'>{t('profile.saved')}</p>}
                    {deliveryFailed && (
                        <p
                            role='alert'
                            className='text-danger'
                        >
                            {t('profile.savedDeliveryFailed')}
                        </p>
                    )}
                    <form.AppForm>
                        <form.Subscribe selector={(state) => state.isSubmitting}>
                            {(busy) => <form.SubscribeButton>{t(busy ? 'common.working' : 'profile.save')}</form.SubscribeButton>}
                        </form.Subscribe>
                    </form.AppForm>
                </form>
            </Section>
            <Section title={t('profile.verificationHeading')}>
                <EmailVerification
                    key={user.email}
                    verified={Boolean(user.emailVerifiedAt)}
                />
            </Section>
            <DataTransferSection userId={user.id} />
            <DeleteOwnAccount username={user.username} />
        </Page>
    );
}
