import { type ValidSession, sessionLifetimeSeconds, validateSession } from './session.server';
import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server';

export const sessionCookieName = 'car_log_session';

function cookieOptions() {
    return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
}

export function getSessionToken(): string | undefined {
    return getCookie(sessionCookieName);
}

export function writeSessionCookie(token: string, expiresAt: Date): void {
    setCookie(sessionCookieName, token, { ...cookieOptions(), maxAge: sessionLifetimeSeconds, expires: expiresAt });
}

export function clearSessionCookie(): void {
    deleteCookie(sessionCookieName, cookieOptions());
}

// Protected server operations should use this helper on every request, rather
// than trusting cached GUI user data. It checks status and renews idle expiry.
export async function getCurrentSession(): Promise<ValidSession | null> {
    const token = getSessionToken();

    if (!token) return null;

    const session = await validateSession(token);

    if (!session) {
        clearSessionCookie();

        return null;
    }

    writeSessionCookie(token, session.expiresAt);

    return session;
}
