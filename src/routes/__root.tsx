/* eslint-disable react-refresh/only-export-components */
import { lazy, Suspense, type ReactNode } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { ClientOnly, Navigate, createRootRouteWithContext, HeadContent, Outlet, Scripts, useRouter } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { Button, Content, Page } from '@tfilo/tope-ui';
import { queryErrorKey } from '../common/query-error';
import { AuthErrorCode } from '../auth/auth-errors';
import { i18n } from '../i18n';
import '../styles.css';

const Devtools = import.meta.env.DEV ? lazy(() => import('../devtools')) : () => null;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    head: () => ({
        meta: [
            {
                charSet: 'utf-8'
            },
            {
                name: 'viewport',
                content: 'width=device-width, initial-scale=1'
            },
            {
                title: i18n.t('home.heading')
            },
            { name: 'theme-color', content: '#0852ba' },
            { name: 'apple-mobile-web-app-title', content: i18n.t('appName') }
        ],
        links: [
            { rel: 'icon', href: '/favicon.ico', sizes: '16x16 32x32' },
            { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/icons/icon-32.png' },
            { rel: 'apple-touch-icon', sizes: '180x180', href: '/icons/icon-180.png' },
            { rel: 'manifest', href: '/site.webmanifest' }
        ]
    }),
    errorComponent: RouteError,
    notFoundComponent: NotFoundPage,
    shellComponent: RootDocument,
    component: Outlet
});

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
    return (
        <html lang='sk'>
            <head>
                <HeadContent />
            </head>
            <body className='text-default'>
                <I18nextProvider i18n={i18n}>
                    <div className='flex min-h-screen flex-col'>
                        <Content>{children}</Content>
                    </div>
                    <ClientOnly>
                        <Suspense fallback={null}>
                            <Devtools />
                        </Suspense>
                    </ClientOnly>
                </I18nextProvider>
                <Scripts />
            </body>
        </html>
    );
}

function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
    const router = useRouter();
    const { t } = useTranslation('auth');

    if (error instanceof Error && error.message === AuthErrorCode.AUTH_REQUIRED)
        return (
            <Navigate
                to='/login'
                replace
            />
        );
    if (error instanceof Error && error.message === AuthErrorCode.ADMIN_REQUIRED)
        return (
            <Navigate
                to='/'
                replace
            />
        );

    return (
        <Page title={t('common.errorHeading')}>
            <p
                role='alert'
                className='text-danger'
            >
                {t(queryErrorKey(error))}
            </p>
            <Button
                onClick={async () => {
                    await router.options.context.queryClient.resetQueries({ type: 'active' });
                    await router.invalidate();
                    reset();
                }}
            >
                {t('common.retry')}
            </Button>
        </Page>
    );
}

function NotFoundPage() {
    const { t } = useTranslation('auth');
    const router = useRouter();

    return (
        <Page
            title={t('common.notFound')}
            onBack={() => router.navigate({ to: '/login' })}
        >
            {t('common.notFoundMessage')}
        </Page>
    );
}
