import { expect, test, vi, afterEach } from 'vitest';
import { profileSchema } from '../src/auth/profile-schema';
import { verificationLink } from '../src/email/verification-mail.server';

afterEach(() => vi.unstubAllEnvs());

test.each(['userId', 'role', 'status', 'emailVerifiedAt'])('profile rejects injected %s', (field) => {
    expect(profileSchema.safeParse({ [field]: 'untrusted' }).success).toBe(false);
});

test('blank new password is optional but actual password changes need current password', () => {
    expect(profileSchema.parse({ newPassword: '' }).newPassword).toBeUndefined();
    expect(profileSchema.safeParse({ newPassword: 'Password123!' }).success).toBe(false);
    expect(profileSchema.safeParse({ currentPassword: ' OldPassword123!', newPassword: 'Password123!' }).success).toBe(true);
    expect(profileSchema.safeParse({ currentPassword: 'OldPassword123!', newPassword: 'Password123! ' }).success).toBe(false);
});

test('verification links use a trusted configured origin and keep tokens out of the request URL', () => {
    vi.stubEnv('APP_URL', 'https://example.test');

    const link = new URL(verificationLink('synthetic-token'));

    expect(link.origin).toBe('https://example.test');
    expect(link.pathname).toBe('/verify-email');
    expect(link.search).toBe('');
    expect(new URLSearchParams(link.hash.slice(1)).get('token')).toBe('synthetic-token');
});

test.each(['http://example.test', 'https://example.test/path', 'https://example.test?redirect=1', 'https://user@example.test'])(
    'rejects unsafe public origin %s',
    (origin) => {
        vi.stubEnv('APP_URL', origin);
        expect(() => verificationLink('token')).toThrow();
    }
);
