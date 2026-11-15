import { userKeys } from '../src/users/user-queries';
import { expect, test } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { UserRole, UserStatus } from '../src/generated/prisma/enums';
import { UserAction } from '../src/users/user-action';
import { AuthErrorCode } from '../src/auth/auth-errors';
import { registrationFormSchema, profileFormSchema } from '../src/ui/auth-form-schemas';
import { availableUserActions } from '../src/ui/managed-users';
import { currentUserKey, replaceCurrentUser, responseErrorKeys, transportErrorKey } from '../src/ui/session';

const credentials = {
    email: 'synthetic@example.test',
    username: 'syntheticuser',
    password: 'Password123!',
    confirmPassword: 'Password123!'
};

test('registration confirmation validates without changing the server registration contract', () => {
    expect(registrationFormSchema.safeParse(credentials).success).toBe(true);
    expect(registrationFormSchema.safeParse({ ...credentials, confirmPassword: 'Different123!' }).success).toBe(false);
});

test('profile requires current password for changed identifiers and matching optional password confirmation', () => {
    const schema = profileFormSchema(credentials.email, credentials.username);
    const profile = { email: credentials.email, username: credentials.username, confirmPassword: '', firstName: '', lastName: '' };

    expect(schema.safeParse(profile).success).toBe(true);
    expect(schema.safeParse({ ...profile, email: 'changed@example.test' }).success).toBe(false);
    expect(schema.safeParse({ ...profile, email: 'changed@example.test', currentPassword: credentials.password }).success).toBe(true);
    expect(schema.safeParse({ ...profile, newPassword: credentials.password, currentPassword: credentials.password }).success).toBe(false);
    expect(
        schema.safeParse({
            ...profile,
            newPassword: credentials.password,
            currentPassword: credentials.password,
            confirmPassword: credentials.password
        }).success
    ).toBe(true);
});

test('row actions reflect current account status', () => {
    expect(availableUserActions({ status: UserStatus.PENDING })).toContain(UserAction.APPROVE);
    expect(availableUserActions({ status: UserStatus.ACTIVE })).not.toContain(UserAction.APPROVE);
    expect(availableUserActions({ status: UserStatus.BLOCKED })).toContain(UserAction.UNBLOCK);
    expect(availableUserActions({ status: UserStatus.BLOCKED })).not.toContain(UserAction.BLOCK);
});

test('account replacement cancels/removes private caches and retains only current user state', async () => {
    const client = new QueryClient();

    client.setQueryData(userKeys.list(0, 25), ['private']);
    client.setQueryData(['otherAccountData'], { private: true });

    const user = {
        id: 'synthetic-id',
        email: credentials.email,
        username: credentials.username,
        firstName: null,
        lastName: null,
        role: UserRole.USER,
        emailVerifiedAt: null,
        storeFuelLocation: false
    };

    await replaceCurrentUser(client, user);
    expect(client.getQueryData(currentUserKey)).toEqual(user);
    expect(client.getQueryData(userKeys.list(0, 25))).toBeUndefined();
    expect(client.getQueryData(['otherAccountData'])).toBeUndefined();
    await replaceCurrentUser(client, null);
    expect(client.getQueryData(currentUserKey)).toBeNull();
    client.clear();
});

test('GUI translates registered transport codes and validation keys without exposing raw errors', () => {
    expect(transportErrorKey(new Error(AuthErrorCode.REQUEST_FORBIDDEN))).toBe('errors.requestForbidden');
    expect(transportErrorKey(new Error('private database failure'))).toBe('errors.unexpected');
    expect(
        responseErrorKeys({ code: AuthErrorCode.PROFILE_INVALID, fields: { email: ['validation.email.invalid'] }, formErrors: [] })
    ).toEqual(['validation.email.invalid']);
});
