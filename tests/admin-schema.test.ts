import { UserAction } from '../src/users/user-action';
import { UserRole } from '../src/generated/prisma/enums';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, expectTypeOf, test } from 'vitest';
import type { z } from 'zod';
import type { listManagedUsers, manageUserAccount, deleteOwnUserAccount } from '../src/users/users.server';
import { deleteMyAccountSchema, manageUserSchema, userListSchema } from '../src/users/user-schema';

const bundle = JSON.parse(readFileSync(new URL('../src/i18n/locales/sk/auth.json', import.meta.url), 'utf8'));

test('list input defaults and page bounds are enforced', () => {
    expect(userListSchema.parse(undefined)).toEqual({ page: 0, pageSize: 25 });
    expect(userListSchema.parse({})).toEqual({ page: 0, pageSize: 25 });
    expect(userListSchema.parse({ page: 0 })).toEqual({ page: 0, pageSize: 25 });
    expect(userListSchema.parse({ page: 1 })).toEqual({ page: 1, pageSize: 25 });
    expect(userListSchema.safeParse({ page: -1 }).success).toBe(false);
    expect(userListSchema.safeParse({ page: 0.5 }).success).toBe(false);
    expect(userListSchema.safeParse({ pageSize: 101 }).success).toBe(false);
});

test('self-deletion cannot accept another user ID or injected privileges', () => {
    expect(deleteMyAccountSchema.parse({ confirmation: 'testuser' })).toEqual({ confirmation: 'testuser' });
    expect(deleteMyAccountSchema.safeParse({ confirmation: 'testuser', userId: randomUUID() }).success).toBe(false);
    expect(deleteMyAccountSchema.safeParse({ confirmation: 'testuser', role: UserRole.ADMIN }).success).toBe(false);
});

test.each([
    {},
    { action: 'unknown', userId: randomUUID() },
    { action: UserAction.BLOCK, userId: 'invalid' },
    { action: UserAction.SET_ROLE, userId: randomUUID(), role: 'ROOT' },
    { action: UserAction.DELETE, userId: randomUUID(), confirmation: '' },
    { action: UserAction.APPROVE, userId: randomUUID(), actorId: randomUUID() }
])('invalid admin commands return translation keys (%#)', (input) => {
    const parsed = manageUserSchema.safeParse(input);

    expect(parsed.success).toBe(false);

    if (parsed.success) throw new Error('Expected invalid command');

    for (const issue of parsed.error.issues) {
        expect(typeof issue.message.split('.').reduce((value, part) => value?.[part], bundle)).toBe('string');
    }
});

test('account service input types are inferred from their schemas', () => {
    expectTypeOf<Parameters<typeof listManagedUsers>[1]>().toEqualTypeOf<z.input<typeof userListSchema>>();
    expectTypeOf<Parameters<typeof manageUserAccount>[1]>().toEqualTypeOf<z.input<typeof manageUserSchema>>();
    expectTypeOf<Parameters<typeof deleteOwnUserAccount>[1]>().toEqualTypeOf<z.input<typeof deleteMyAccountSchema>>();
});
