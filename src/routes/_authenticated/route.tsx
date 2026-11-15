/* eslint-disable react-refresh/only-export-components */
import { userKeys } from '../../users/user-queries';
import { createFileRoute, Navigate, Outlet, redirect, useRouter, useRouterState } from '@tanstack/react-router';
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Header, PageLoadingOverlay, type MenuItem } from '@tfilo/tope-ui';
import { HomeIcon, BoltIcon, UsersIcon, TruckIcon, WrenchScrewdriverIcon, ChartBarIcon } from '@heroicons/react/16/solid';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { UserRole } from '../../generated/prisma/enums';
import { ResultKind } from '../../common/result-kind';
import { logout } from '../../auth/auth';
import { currentUserOptions, replaceCurrentUser, responseErrorKeys, transportErrorKey } from '../../ui/session';
import { ErrorMessages } from '../../ui/feedback';

export const Route = createFileRoute('/_authenticated')({
    headers: () => ({ 'Cache-Control': 'no-store' }),
    beforeLoad: async ({ context }) => {
        const user = await context.queryClient.query(currentUserOptions);

        if (!user) throw redirect({ to: '/login' });

        return { user };
    },
    component: AuthenticatedLayout
});

function AuthenticatedLayout() {
    const { t } = useTranslation('auth');
    const { data: user } = useSuspenseQuery(currentUserOptions);
    const queryClient = useQueryClient();
    const router = useRouter();
    const signOut = useServerFn(logout);
    const isNavigating = useRouterState({ select: (state) => state.status === 'pending' });
    const pathname = useRouterState({ select: (state) => state.resolvedLocation?.pathname ?? state.location.pathname });

    const [errors, setErrors] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);

    const previousIdentity = useRef(user?.id);

    useEffect(() => {
        if (!user || previousIdentity.current !== user.id) {
            queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== currentUserOptions.queryKey[0] });
        } else if (user.role !== UserRole.ADMIN) {
            queryClient.removeQueries({ queryKey: userKeys.all });
        }

        previousIdentity.current = user?.id;
    }, [user, queryClient]);

    if (!user)
        return (
            <Navigate
                to='/login'
                replace
            />
        );

    function isInSection(path: string) {
        return pathname === path || pathname.startsWith(`${path}/`);
    }

    const menu: MenuItem[] = [
        {
            label: t('navigation.home'),
            icon: HomeIcon,
            onClick: () => router.navigate({ to: '/' }),
            active: pathname === '/'
        }
    ];

    menu.push(
        {
            label: t('navigation.fuel'),
            icon: BoltIcon,
            onClick: () => router.navigate({ to: '/fuel' }),
            active: isInSection('/fuel')
        },
        {
            label: t('navigation.expenses'),
            icon: WrenchScrewdriverIcon,
            onClick: () => router.navigate({ to: '/expenses' }),
            active: isInSection('/expenses')
        },
        {
            label: t('navigation.statistics'),
            icon: ChartBarIcon,
            onClick: () => router.navigate({ to: '/statistics' }),
            active: isInSection('/statistics')
        },
        {
            label: t('navigation.vehicles'),
            icon: TruckIcon,
            onClick: () => router.navigate({ to: '/vehicles' }),
            active: isInSection('/vehicles')
        }
    );

    if (user.role === UserRole.ADMIN)
        menu.push({
            label: t('navigation.users'),
            icon: UsersIcon,
            onClick: () => router.navigate({ to: '/users' }),
            active: isInSection('/users')
        });

    async function handleLogout() {
        if (busy) return;

        setBusy(true);
        setErrors([]);

        try {
            const result = await signOut();

            if (result.kind !== ResultKind.LOGGED_OUT) {
                setErrors(responseErrorKeys(result));

                return;
            }

            await replaceCurrentUser(queryClient, null);
            await router.invalidate();
            await router.navigate({ to: '/login', replace: true });
        } catch (error) {
            setErrors([transportErrorKey(error)]);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className='flex min-h-screen flex-col'>
            <Header
                menu={menu}
                onLogout={handleLogout}
                onProfile={() => router.navigate({ to: '/profile' })}
            />
            <main
                className='relative flex flex-1 flex-col'
                aria-busy={isNavigating}
            >
                <div
                    inert={isNavigating}
                    className='flex flex-1 flex-col'
                >
                    <ErrorMessages errors={errors} />
                    <Outlet key={user.id} />
                </div>
                <PageLoadingOverlay
                    active={isNavigating}
                    label={t('common.loading')}
                />
            </main>
        </div>
    );
}
