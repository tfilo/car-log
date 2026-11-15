import { afterEach, expect, test, vi } from 'vitest';
import { setCookie, deleteCookie } from '@tanstack/react-start/server';
import { clearSessionCookie, writeSessionCookie, sessionCookieName } from '../src/auth/session-cookie.server';
import { sessionLifetimeSeconds } from '../src/auth/session.server';

vi.mock('@tanstack/react-start/server', () => ({ setCookie: vi.fn(), deleteCookie: vi.fn(), getCookie: vi.fn() }));

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
});

test.each(['production', 'development'])('session cookies use appropriate flags in %s', (environment) => {
    vi.stubEnv('NODE_ENV', environment);

    const expires = new Date();

    writeSessionCookie('test-only-token', expires);
    expect(setCookie).toHaveBeenCalledWith(sessionCookieName, 'test-only-token', {
        httpOnly: true,
        secure: environment === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: sessionLifetimeSeconds,
        expires
    });
    clearSessionCookie();
    expect(deleteCookie).toHaveBeenCalledWith(sessionCookieName, {
        httpOnly: true,
        secure: environment === 'production',
        sameSite: 'lax',
        path: '/'
    });
});
