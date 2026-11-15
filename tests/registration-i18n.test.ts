import { userErrorKeys, getUserErrorKey } from '../src/users/user-errors';
import { HttpStatus } from '../src/common/http';
import { AuthErrorCode, getAuthErrorKey, authErrorKeys } from '../src/auth/auth-errors';
import { UserRole } from '../src/generated/prisma/enums';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { registrationSchema } from '../src/auth/registration-schema';
import { serverFunctionError } from '../src/server-functions/server-function-error.server';

const bundle = JSON.parse(readFileSync(new URL('../src/i18n/locales/sk/auth.json', import.meta.url), 'utf8'));
const valid = { email: 'user@example.test', username: 'user123', password: 'Password123' };

function translation(key: string): unknown {
    return key.split('.').reduce((value, part) => value?.[part], bundle);
}

test('all registration error codes map to nonempty Slovak bundle entries', () => {
    for (const code of Object.keys(authErrorKeys)) {
        const message = translation(getAuthErrorKey(code));

        expect(typeof message).toBe('string');
        expect((message as string).length).toBeGreaterThan(0);
    }

    expect(typeof translation('success.active')).toBe('string');
    expect(typeof translation('success.pending')).toBe('string');
});

test('user-management error codes still resolve to nonempty Slovak bundle entries', () => {
    for (const code of Object.keys(userErrorKeys)) {
        const message = translation(getUserErrorKey(code));

        expect(typeof message).toBe('string');
        expect((message as string).length).toBeGreaterThan(0);
    }
});

test.each([undefined, null, 'raw internal error', 'toString', '__proto__', { code: 'not-a-code' }])(
    'unknown error codes use the safe localized fallback',
    (code) => {
        expect(getAuthErrorKey(code)).toBe('errors.unexpected');
        expect(typeof translation(getAuthErrorKey(code))).toBe('string');
    }
);

test.each([
    null,
    undefined,
    [],
    {},
    { ...valid, role: UserRole.ADMIN },
    { ...valid, email: 123 },
    { ...valid, email: 'invalid' },
    { ...valid, email: 'a'.repeat(255) },
    { ...valid, username: null },
    { ...valid, username: 'aa' },
    { ...valid, username: 'a'.repeat(31) },
    { ...valid, username: 'Uppercase' },
    { ...valid, password: 123 },
    { ...valid, password: 'Aa1' },
    { ...valid, password: 'a'.repeat(129) },
    { ...valid, password: 'UPPERCASE123' },
    { ...valid, password: 'lowercase123' },
    { ...valid, password: 'PasswordOnly' },
    { ...valid, password: 'Password 123' },
    { ...valid, firstName: 123 },
    { ...valid, lastName: 'a'.repeat(101) }
])('all validation issues are translation keys, including invalid types and root errors (%#)', (input) => {
    const result = registrationSchema.safeParse(input);

    expect(result.success).toBe(false);

    if (result.success) throw new Error('Expected invalid registration');

    for (const issue of result.error.issues) {
        expect(issue.message).toMatch(/^validation\./);
        expect(typeof translation(issue.message)).toBe('string');
    }
});

test('transport errors carry a stable code without translated text', async () => {
    const response = serverFunctionError(AuthErrorCode.REQUEST_FORBIDDEN, HttpStatus.FORBIDDEN);

    expect(response.status).toBe(HttpStatus.FORBIDDEN);
    expect(response.headers.get('X-App-Error-Code')).toBe(AuthErrorCode.REQUEST_FORBIDDEN);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe(AuthErrorCode.REQUEST_FORBIDDEN);
});

test('Zod flattenError preserves field and form translation keys', () => {
    const result = registrationSchema.safeParse({ ...valid, password: 'weak', role: UserRole.ADMIN });

    if (result.success) throw new Error('Expected invalid registration');

    const errors = z.flattenError(result.error);

    expect(errors.formErrors).toContain('validation.registration.shape');
    expect(errors.fieldErrors.password).toContain('validation.password.minLength');

    for (const key of [...errors.formErrors, ...(errors.fieldErrors.password ?? [])]) {
        expect(typeof translation(key)).toBe('string');
    }
});
