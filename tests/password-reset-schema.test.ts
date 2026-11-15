import { UserRole } from '../src/generated/prisma/enums';
import { expect, test, vi, afterEach } from 'vitest';
import { passwordResetRequestSchema, passwordResetSchema } from '../src/auth/password-reset-schema';
import { passwordResetLink } from '../src/email/verification-mail.server';
import { i18n } from '../src/i18n';

afterEach(() => vi.unstubAllEnvs());

test('reset requests normalize username or email and reject extra authorization fields', () => {
    expect(passwordResetRequestSchema.parse({ identifier: ' USER123 ' })).toEqual({ identifier: 'user123' });
    expect(passwordResetRequestSchema.parse({ identifier: ' USER@example.test ' })).toEqual({ identifier: 'user@example.test' });
    expect(passwordResetRequestSchema.safeParse({ identifier: 'user123', userId: 'untrusted' }).success).toBe(false);
});

test.each([
    { token: 'invalid', newPassword: 'Password123!' },
    { token: 'A'.repeat(43), newPassword: 'weak' },
    { token: 'A'.repeat(43), newPassword: 'Password123! ' },
    { token: 'A'.repeat(43), newPassword: 'Password123!', role: UserRole.ADMIN }
])('reset schema rejects invalid tokens, passwords and extra fields (%#)', (input) => {
    const parsed = passwordResetSchema.safeParse(input);

    expect(parsed.success).toBe(false);

    if (parsed.success) throw new Error('Expected invalid reset');

    for (const issue of parsed.error.issues) expect(i18n.exists(issue.message)).toBe(true);
});

test('reset links use the reset page and put the token only in the fragment', () => {
    vi.stubEnv('APP_URL', 'https://example.test');

    const link = new URL(passwordResetLink('synthetic-token'));

    expect(link.origin).toBe('https://example.test');
    expect(link.pathname).toBe('/reset-password');
    expect(link.search).toBe('');
    expect(new URLSearchParams(link.hash.slice(1)).get('token')).toBe('synthetic-token');
});
