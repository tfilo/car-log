import { profileSchema } from '../src/auth/profile-schema';
import { passwordResetSchema } from '../src/auth/password-reset-schema';
import { UserRole, UserStatus } from '../src/generated/prisma/enums';
import { expect, test } from 'vitest';
import { registrationSchema } from '../src/auth/registration-schema';

const valid = { email: 'user@example.test', username: 'user123', password: 'Password123' };

test('normalizes email and names without changing the password', () => {
    const data = registrationSchema.parse({ ...valid, email: ' User@Example.Test ', firstName: ' TestFirst ', lastName: '  ' });

    expect(data.email).toBe('user@example.test');
    expect(data.firstName).toBe('TestFirst');
    expect(data.lastName).toBeUndefined();
    expect(data.password).toBe(valid.password);
});

test.each(['ab', 'a'.repeat(31), 'Uppercase', 'with space', 'with-dash', 'with_underscore', 'an@email', 'žiadne'])(
    'rejects invalid username %s',
    (username) => {
        expect(registrationSchema.safeParse({ ...valid, username }).success).toBe(false);
    }
);

test.each([
    'Abcdefghi',
    'Aa1' + 'a'.repeat(126),
    'lowercase123',
    'UPPERCASE123',
    'PasswordOnly',
    'Password 123',
    'Password123\t',
    'Password123\n',
    'Password123:',
    'HesloŽlté123'
])('rejects invalid password %j', (password) => {
    expect(registrationSchema.safeParse({ ...valid, password }).success).toBe(false);
});

test.each(['Aa12345678', 'Aa1' + 'a'.repeat(125), ...[...'*$#&,.%@-_~|\\/!?^'].map((character) => `Password123${character}`)])(
    'accepts valid password %j',
    (password) => {
        expect(registrationSchema.parse({ ...valid, password }).password).toBe(password);
    }
);

test('rejects public role and status assignment', () => {
    expect(registrationSchema.safeParse({ ...valid, role: UserRole.ADMIN, status: UserStatus.ACTIVE }).success).toBe(false);
});

test('rejects malformed email and excessively long names', () => {
    expect(registrationSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...valid, firstName: 'a'.repeat(101) }).success).toBe(false);
});

test('profile password changes and password resets also accept a caret', () => {
    const newPassword = 'Password123^';

    expect(profileSchema.parse({ currentPassword: valid.password, newPassword }).newPassword).toBe(newPassword);
    expect(passwordResetSchema.parse({ token: 'a'.repeat(43), newPassword }).newPassword).toBe(newPassword);
});
