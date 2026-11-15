import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useServerFn } from '@tanstack/react-start';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@tfilo/tope-ui';
import { requestEmailVerification } from '../auth/auth';
import { ResultKind } from '../common/result-kind';
import { currentUserOptions, replaceCurrentUser, responseErrorKeys, transportErrorKey } from './session';
import { AuthErrorCode } from '../auth/auth-errors';
import { ErrorMessages } from './feedback';

export function EmailVerification({ verified }: { verified: boolean }) {
    const { t } = useTranslation('auth');
    const send = useServerFn(requestEmailVerification);
    const queryClient = useQueryClient();

    const [errors, setErrors] = useState<string[]>([]);
    const [sent, setSent] = useState(false);
    const [busy, setBusy] = useState(false);

    async function resend() {
        if (busy) return;

        setBusy(true);
        setErrors([]);
        setSent(false);

        try {
            const result = await send();

            if (result.kind === ResultKind.SENT) setSent(true);
            else if (result.kind === ResultKind.ALREADY_VERIFIED) await queryClient.query(currentUserOptions);
            else if ('code' in result) {
                setErrors(responseErrorKeys(result));

                if (result.code === AuthErrorCode.AUTH_REQUIRED) await replaceCurrentUser(queryClient, null);
            }
        } catch (error) {
            setErrors([transportErrorKey(error)]);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className='flex flex-col gap-lg'>
            <p>{t(verified ? 'profile.emailVerified' : 'profile.emailUnverified')}</p>
            {!verified && (
                <>
                    <p className='text-sm'>{t('profile.verificationHelp')}</p>
                    <Button
                        onClick={resend}
                        disabled={busy}
                    >
                        {t(busy ? 'common.working' : 'profile.resend')}
                    </Button>
                </>
            )}
            {sent && <p role='status'>{t('profile.verificationSent')}</p>}
            <ErrorMessages errors={errors} />
        </div>
    );
}
