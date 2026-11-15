import { getUserErrorKey } from '../users/user-errors';
import { userErrors } from './user-feedback';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { Button, Modal, Section, useAppForm } from '@tfilo/tope-ui';
import { deleteMyAccount } from '../users/users';
import { deleteMyAccountSchema } from '../users/user-schema';
import { ResultKind } from '../common/result-kind';
import { AuthErrorCode } from '../auth/auth-errors';
import { translatedSchema } from '../i18n/form-schema';
import { replaceCurrentUser } from './session';
import { ErrorMessages } from './feedback';

export function DeleteOwnAccount({ username }: { username: string }) {
    const { t } = useTranslation('auth');
    const router = useRouter();
    const queryClient = useQueryClient();
    const remove = useServerFn(deleteMyAccount);

    const [open, setOpen] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);

    const form = useAppForm({
        defaultValues: { confirmation: '' },
        validators: {
            onChange: translatedSchema(
                deleteMyAccountSchema.extend({ confirmation: z.literal(username, { error: 'errors.accountConfirmationMismatch' }) }),
                t
            )
        },
        onSubmit: async ({ value }) => {
            setErrors([]);

            try {
                const result = await remove({ data: value });

                if (result.kind === ResultKind.DELETED || ('code' in result && result.code === AuthErrorCode.AUTH_REQUIRED)) {
                    await replaceCurrentUser(queryClient, null);
                    await router.invalidate();
                    await router.navigate({ to: '/login', replace: true });
                } else setErrors(userErrors(result));
            } catch (error) {
                setErrors([getUserErrorKey(error instanceof Error ? error.message : AuthErrorCode.AUTH_UNAVAILABLE)]);
            }
        }
    });

    return (
        <Section title={t('account.deleteHeading')}>
            <p>{t('account.deleteHelp')}</p>
            <Button
                variant='danger'
                onClick={() => {
                    setErrors([]);

                    form.reset();

                    setOpen(true);
                }}
            >
                {t('account.delete')}
            </Button>
            <Modal
                openModal={open}
                aria-label={t('account.deleteHeading')}
                title={t('account.deleteHeading')}
                variant='danger'
                confirmLabel={t('account.delete')}
                onClose={async (confirm) => {
                    if (form.state.isSubmitting) return;

                    if (confirm) await form.handleSubmit();
                    else setOpen(false);
                }}
                body={
                    <form
                        noValidate
                        onSubmit={(event) => {
                            event.preventDefault();
                            void form.handleSubmit();
                        }}
                        className='flex flex-col gap-lg'
                    >
                        <p>{t('account.confirmationHelp', { username })}</p>
                        <form.AppField name='confirmation'>
                            {(field) => (
                                <field.Input
                                    label={t('account.confirmation')}
                                    required
                                    autoComplete='off'
                                    maxLength={30}
                                />
                            )}
                        </form.AppField>
                        <ErrorMessages errors={errors} />
                    </form>
                }
            />
        </Section>
    );
}
