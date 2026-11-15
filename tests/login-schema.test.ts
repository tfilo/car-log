import { UserRole } from '../src/generated/prisma/enums';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loginSchema } from '../src/auth/login-schema';

const bundle = JSON.parse(readFileSync(new URL('../src/i18n/locales/sk/auth.json', import.meta.url), 'utf8'));

test('normalizes the identifier but leaves the password unchanged', () => {
    expect(loginSchema.parse({ identifier: ' USER123 ', password: ' ExactPassword123! ' })).toEqual({
        identifier: 'user123',
        password: ' ExactPassword123! '
    });
});

test.each([
    {},
    { identifier: 'a', password: 'x' },
    { identifier: 'bad@email', password: 'x' },
    { identifier: 'user123', password: '' },
    { identifier: 'user123', password: 'x'.repeat(129) },
    { identifier: 'user123', password: 'x', role: UserRole.ADMIN }
])('invalid login data uses translation keys (%#)', (input) => {
    const parsed = loginSchema.safeParse(input);

    expect(parsed.success).toBe(false);

    if (parsed.success) throw new Error('Expected invalid login');

    for (const issue of parsed.error.issues) {
        expect(typeof issue.message.split('.').reduce((value, part) => value?.[part], bundle)).toBe('string');
    }
});
