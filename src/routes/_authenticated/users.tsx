/* eslint-disable react-refresh/only-export-components */
import { useCallback, useState } from 'react';
import { createFileRoute, Navigate, redirect } from '@tanstack/react-router';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Page, Table, createColumns } from '@tfilo/tope-ui';
import { CheckIcon, NoSymbolIcon, LockOpenIcon, UserGroupIcon, TrashIcon } from '@heroicons/react/16/solid';
import { MobileTableRow, TableRowMenu } from '../../ui/mobile-table-row';
import { UserRole } from '../../generated/prisma/enums';
import { UserAction } from '../../users/user-action';
import { managedUsersOptions } from '../../users/user-queries';
import { currentUserOptions } from '../../ui/session';
import { availableUserActions, managedUserRow, type ManagedUserRow } from '../../ui/managed-users';
import { ManageUserDialog } from '../../ui/manage-user-dialog';

const actionIcons = {
    [UserAction.APPROVE]: CheckIcon,
    [UserAction.BLOCK]: NoSymbolIcon,
    [UserAction.UNBLOCK]: LockOpenIcon,
    [UserAction.SET_ROLE]: UserGroupIcon,
    [UserAction.DELETE]: TrashIcon
};

export const Route = createFileRoute('/_authenticated/users')({
    beforeLoad: ({ context }) => {
        if (context.user.role !== UserRole.ADMIN) throw redirect({ to: '/' });
    },
    loader: ({ context }) => context.queryClient.query({ ...managedUsersOptions(0, 25), staleTime: 0 }),
    component: UsersPage
});

function UsersPage() {
    const { t } = useTranslation('auth');
    const { data: user } = useSuspenseQuery(currentUserOptions);
    const queryClient = useQueryClient();

    const [revision, setRevision] = useState(0);
    const [selected, setSelected] = useState<{ user: ManagedUserRow; action: UserAction } | null>(null);

    const onFetch = useCallback(
        async (page: number, pageSize: number) => {
            const result = await queryClient.query(managedUsersOptions(page, pageSize));

            return { data: result.users.map(managedUserRow), page: result.page, pageSize: result.pageSize, totalRecords: result.total };
        },
        [queryClient]
    );

    const columns = createColumns<ManagedUserRow>([
        { header: t('profile.username'), accessor: 'username' },
        { header: t('profile.email'), accessor: 'email' },
        { header: t('users.name'), accessor: 'name' },
        { header: t('users.role'), accessor: 'role', formatter: (role) => t(`users.roles.${role}`) },
        { header: t('users.status'), accessor: 'status', formatter: (status) => t(`users.statuses.${status}`) },
        {
            header: t('profile.verificationHeading'),
            accessor: 'emailVerified',
            formatter: (verified) => t(verified ? 'common.yes' : 'common.no')
        },
        { header: t('users.createdAt'), accessor: 'createdAt' },
        {
            header: t('users.actionsHeading'),
            accessor: 'id',
            additionalClassName: 'w-none whitespace-nowrap border-l text-right sticky right-none bg-white shadow-lg shadow-secondary-light',
            cell: (row) => (
                <div className='ml-auto flex w-max justify-end gap-sm'>
                    {availableUserActions(row).map((action) => (
                        <Button
                            key={action}
                            icon={actionIcons[action]}
                            showChildren={false}
                            variant={action === UserAction.DELETE ? 'danger' : 'transparent'}
                            onClick={() => setSelected({ user: row, action })}
                        >
                            {t(`users.actions.${action}`)}
                        </Button>
                    ))}
                </div>
            )
        }
    ]);

    if (!user || user.role !== UserRole.ADMIN)
        return (
            <Navigate
                to='/'
                replace
            />
        );

    return (
        <Page title={t('users.heading')}>
            <Table
                key={revision}
                columns={columns}
                onFetch={onFetch}
                pageSize={25}
                renderMobileRow={(row) => (
                    <MobileTableRow
                        title={row.username}
                        value={t(`users.statuses.${row.status}`)}
                        actions={
                            <TableRowMenu
                                label={t('users.actionsHeading')}
                                options={availableUserActions(row).map((action) => ({
                                    label: t(`users.actions.${action}`),
                                    icon: actionIcons[action],
                                    onClick: () => setSelected({ user: row, action })
                                }))}
                            />
                        }
                    >
                        <p>{row.email}</p>
                        {row.name && <p>{row.name}</p>}
                        <p>
                            {t('users.role')}: {t(`users.roles.${row.role}`)}
                        </p>
                        <p className='text-secondary'>
                            {t('profile.verificationHeading')}: {t(row.emailVerified ? 'common.yes' : 'common.no')}
                        </p>
                        <p className='text-secondary'>
                            {t('users.createdAt')}: {row.createdAt}
                        </p>
                    </MobileTableRow>
                )}
            />
            {selected && (
                <ManageUserDialog
                    key={`${selected.user.id}:${selected.action}`}
                    {...selected}
                    onClose={() => setSelected(null)}
                    onSaved={() => setRevision((value) => value + 1)}
                />
            )}
        </Page>
    );
}
