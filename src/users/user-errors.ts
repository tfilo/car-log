import { getAuthErrorKey } from '../auth/auth-errors.ts';

export const UserErrorCode = {
    ACCOUNT_INVALID: 'ACCOUNT_INVALID',
    ADMIN_USER_NOT_FOUND: 'ADMIN_USER_NOT_FOUND',
    ADMIN_LAST_ACTIVE: 'ADMIN_LAST_ACTIVE',
    ADMIN_INVALID_TRANSITION: 'ADMIN_INVALID_TRANSITION',
    ACCOUNT_CONFIRMATION_MISMATCH: 'ACCOUNT_CONFIRMATION_MISMATCH',
    ACCOUNT_UNAVAILABLE: 'ACCOUNT_UNAVAILABLE'
} as const;

export type UserErrorCode = (typeof UserErrorCode)[keyof typeof UserErrorCode];

export const userErrorKeys = {
    [UserErrorCode.ACCOUNT_INVALID]: 'errors.accountInvalid',
    [UserErrorCode.ADMIN_USER_NOT_FOUND]: 'errors.adminUserNotFound',
    [UserErrorCode.ADMIN_LAST_ACTIVE]: 'errors.adminLastActive',
    [UserErrorCode.ADMIN_INVALID_TRANSITION]: 'errors.adminInvalidTransition',
    [UserErrorCode.ACCOUNT_CONFIRMATION_MISMATCH]: 'errors.accountConfirmationMismatch',
    [UserErrorCode.ACCOUNT_UNAVAILABLE]: 'errors.accountUnavailable'
} satisfies Record<UserErrorCode, string>;

export function getUserErrorKey(code: unknown): string {
    if (typeof code === 'string' && Object.hasOwn(userErrorKeys, code)) return userErrorKeys[code as UserErrorCode];

    return `auth:${getAuthErrorKey(code)}`;
}
