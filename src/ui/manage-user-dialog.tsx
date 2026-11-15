import { getUserErrorKey } from '../users/user-errors';
import { userErrors } from './user-feedback';
import { userKeys } from '../users/user-queries';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useServerFn } from '@tanstack/react-start';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { Modal, useAppForm } from '@tfilo/tope-ui';
import { z } from 'zod';
import { UserRole } from '../generated/prisma/enums';
import { UserAction } from '../users/user-action';
import { manageUser } from '../users/users';
import { ResultKind } from '../common/result-kind';
import { AuthErrorCode } from '../auth/auth-errors';
import { translatedSchema } from '../i18n/form-schema';
import { currentUserOptions, replaceCurrentUser } from './session';
import { roleOptions, type ManagedUserRow } from './managed-users';
import { ErrorMessages } from './feedback';

export function ManageUserDialog({
    user,
    action,
    onClose,
    onSaved
}: {
    user: ManagedUserRow;
    action: UserAction;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { t } = useTranslation('auth');
    const update = useServerFn(manageUser);
    const queryClient = useQueryClient();
    const router = useRouter();

    const [errors, setErrors] = useState<string[]>([]);

    const form = useAppForm({
        defaultValues: { confirmation: '', role: user.role },
        validators: {
            onChange: translatedSchema(
                z
                    .object({ role: z.enum(UserRole), confirmation: z.string() })
                    .refine((value) => action !== UserAction.DELETE || value.confirmation === user.username, {
                        path: ['confirmation'],
                        error: 'errors.accountConfirmationMismatch'
                    }),
                t
            )
        },
        onSubmit: async ({ value }) => {
            setErrors([]);

            try {
                const data =
                    action === UserAction.SET_ROLE
                        ? { action, userId: user.id, role: value.role }
                        : action === UserAction.DELETE
                          ? { action, userId: user.id, confirmation: value.confirmation }
                          : { action, userId: user.id };
                const result = await update({ data });

                if (result.kind !== ResultKind.UPDATED && result.kind !== ResultKind.DELETED) {
                    setErrors(userErrors(result));

                    if (result.code === AuthErrorCode.AUTH_REQUIRED) await replaceCurrentUser(queryClient, null);
                    else if (result.code === AuthErrorCode.ADMIN_REQUIRED) await queryClient.query(currentUserOptions);

                    return;
                }

                // Self-block/deletion/demotion must update the shell before showing another admin page.
                await queryClient.invalidateQueries({ queryKey: userKeys.all });
                await queryClient.query(currentUserOptions);
                await router.invalidate();
                onSaved();
                onClose();
            } catch (error) {
                setErrors([getUserErrorKey(error instanceof Error ? error.message : AuthErrorCode.AUTH_UNAVAILABLE)]);
            }
        }
    });

    const deleting = action === UserAction.DELETE;

    return (
        <Modal
            openModal
            title={t(`users.actions.${action}`)}
            aria-label={t(`users.actions.${action}`)}
            variant={deleting || action === UserAction.BLOCK ? 'danger' : 'primary'}
            confirmLabel={t('common.confirm')}
            onClose={async (confirm) => {
                if (form.state.isSubmitting) return;

                if (confirm) await form.handleSubmit();
                else onClose();
            }}
            body={
                <form
                    noValidate
                    className='flex flex-col gap-lg'
                    onSubmit={(event) => {
                        event.preventDefault();
                        void form.handleSubmit();
                    }}
                >
                    <p>{t('users.confirmAction', { username: user.username, action: t(`users.actions.${action}`) })}</p>
                    {action === UserAction.SET_ROLE && (
                        <form.AppField name='role'>
                            {(field) => (
                                <field.Select
                                    label={t('users.role')}
                                    options={roleOptions.map((role) => ({ value: role, label: t(`users.roles.${role}`) }))}
                                    required
                                />
                            )}
                        </form.AppField>
                    )}
                    {deleting && (
                        <>
                            <p>{t('account.confirmationHelp', { username: user.username })}</p>
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
                        </>
                    )}
                    <ErrorMessages errors={errors} />
                </form>
            }
        />
    );
}
