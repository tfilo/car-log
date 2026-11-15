import type { UserErrorCode } from './user-errors';
import type { User } from '../generated/prisma/client';
import type { ResultKind } from '../common/result-kind';
import type { AuthErrorCode } from '../auth/auth-errors';
import type { SessionOutcome } from '../auth/auth.types';

type UserFailureCode = UserErrorCode | typeof AuthErrorCode.AUTH_REQUIRED | typeof AuthErrorCode.ADMIN_REQUIRED;

export type UserFailure<
    Code extends UserFailureCode = UserFailureCode,
    Kind extends typeof ResultKind.ERROR | typeof ResultKind.INVALID | typeof ResultKind.UNAVAILABLE = typeof ResultKind.ERROR
> = { kind: Kind; code: Code };

export type ManagedUser = Pick<
    User,
    'id' | 'email' | 'username' | 'firstName' | 'lastName' | 'emailVerifiedAt' | 'role' | 'status' | 'createdAt' | 'updatedAt'
>;

export type UserManagementErrorCode =
    | typeof AuthErrorCode.AUTH_REQUIRED
    | typeof AuthErrorCode.ADMIN_REQUIRED
    | typeof UserErrorCode.ADMIN_USER_NOT_FOUND
    | typeof UserErrorCode.ACCOUNT_CONFIRMATION_MISMATCH
    | typeof UserErrorCode.ADMIN_LAST_ACTIVE
    | typeof UserErrorCode.ADMIN_INVALID_TRANSITION;

export type UserListResult =
    | { kind: typeof ResultKind.USERS; users: ManagedUser[]; total: number; page: number; pageSize: number }
    | UserFailure<typeof AuthErrorCode.AUTH_REQUIRED | typeof AuthErrorCode.ADMIN_REQUIRED>;

export type ManageUserResult =
    | { kind: typeof ResultKind.UPDATED; user: ManagedUser }
    | { kind: typeof ResultKind.DELETED; userId: string }
    | UserFailure<UserManagementErrorCode>;

export type DeleteAccountResult =
    | { kind: typeof ResultKind.DELETED; userId: string }
    | UserFailure<
          typeof AuthErrorCode.AUTH_REQUIRED | typeof UserErrorCode.ACCOUNT_CONFIRMATION_MISMATCH | typeof UserErrorCode.ADMIN_LAST_ACTIVE
      >;

export type UserManagementOutcome = SessionOutcome<UserListResult | ManageUserResult | DeleteAccountResult>;

export type UserUnavailable = UserFailure<typeof UserErrorCode.ACCOUNT_UNAVAILABLE, typeof ResultKind.UNAVAILABLE>;

export type UserListResponse = UserListResult | UserValidationFailure<'page' | 'pageSize'> | UserUnavailable;

export type ManageUserResponse = ManageUserResult | UserValidationFailure<'action' | 'userId' | 'role' | 'confirmation'> | UserUnavailable;

export type DeleteAccountResponse = DeleteAccountResult | UserValidationFailure<'confirmation'> | UserUnavailable;

export type UserOperationResult = UserListResult | ManageUserResult | DeleteAccountResult;
export type UserValidationFailure<Field extends string = string> = UserFailure<
    typeof UserErrorCode.ACCOUNT_INVALID,
    typeof ResultKind.INVALID
> & {
    fields: Partial<Record<Field, string[]>>;
    formErrors: string[];
};
