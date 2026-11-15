import { currentUserKey, transportErrorKey } from '../ui/session';
import { useQueryClient } from '@tanstack/react-query';
import { ResultKind } from '../common/result-kind';
/* eslint-disable react-refresh/only-export-components */
import { useState } from 'react';
import { ClientOnly, useRouter, createFileRoute } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { confirmEmail } from '../auth/auth';
import { getAuthErrorKey } from '../auth/auth-errors';
import { useTranslation } from 'react-i18next';
import { Button, Page } from '@tfilo/tope-ui';

const VerificationState = {
    READY: 'ready',
    WORKING: 'working',
    VERIFIED: 'verified',
    ERROR: 'error'
} as const;

type VerificationState = (typeof VerificationState)[keyof typeof VerificationState];

export const Route = createFileRoute('/verify-email')({
    component: () => (
        <ClientOnly>
            <VerificationPage />
        </ClientOnly>
    ),
    head: () => ({
        meta: [
            { name: 'referrer', content: 'no-referrer' },
            { name: 'robots', content: 'noindex' }
        ]
    })
});

function VerificationPage() {
    const { t } = useTranslation('auth');
    const router = useRouter();
    const confirm = useServerFn(confirmEmail);
    const queryClient = useQueryClient();

    const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
    const [state, setState] = useState<VerificationState>(token ? VerificationState.READY : VerificationState.ERROR);
    const [errorKey, setErrorKey] = useState('errors.emailVerificationInvalid');

    async function verify() {
        setState(VerificationState.WORKING);

        try {
            const result = await confirm({ data: { token } });

            if (result.kind === ResultKind.VERIFIED) {
                window.history.replaceState(null, '', window.location.pathname);

                setState(VerificationState.VERIFIED);

                await queryClient.invalidateQueries({ queryKey: currentUserKey });
            } else {
                setErrorKey(getAuthErrorKey(result.code));
                setState(VerificationState.ERROR);
            }
        } catch (error) {
            setErrorKey(transportErrorKey(error));
            setState(VerificationState.ERROR);
        }
    }

    return (
        <Page
            title={t('emailVerification.heading')}
            onBack={() => router.navigate({ to: '/login' })}
        >
            <p
                role='status'
                className={state === VerificationState.ERROR ? 'text-danger' : undefined}
            >
                {t(state === VerificationState.ERROR ? errorKey : `emailVerification.${state}`)}
            </p>
            {state !== VerificationState.VERIFIED && (
                <Button
                    type='button'
                    disabled={state === VerificationState.WORKING || !token}
                    onClick={verify}
                >
                    {t('emailVerification.button')}
                </Button>
            )}
        </Page>
    );
}
