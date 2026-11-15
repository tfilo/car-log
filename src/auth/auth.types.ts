import type { EmailDeliveryStatus } from '../email/email-delivery-status';
import type { ResultKind } from '../common/result-kind';
import type { UserStatus } from '../generated/prisma/enums';
import type { AuthErrorCode } from './auth-errors';
import type { SessionUser } from './session.server';

export type AuthFailure<
    Code extends AuthErrorCode = AuthErrorCode,
    Kind extends
        | typeof ResultKind.ERROR
        | typeof ResultKind.INVALID
        | typeof ResultKind.UNAVAILABLE
        | typeof ResultKind.DUPLICATE
        | typeof ResultKind.INVALID_CREDENTIALS
        | typeof ResultKind.INVALID_TOKEN = typeof ResultKind.ERROR
> = { kind: Kind; code: Code };

export type ValidationFailure<Code extends AuthErrorCode, Field extends string> = AuthFailure<Code, typeof ResultKind.INVALID> & {
    fields: Partial<Record<Field, string[]>>;
    formErrors: string[];
};

// Cookie/session metadata stays on the server; RPC handlers return only result.
export type SessionOutcome<Result> = {
    result: Result;
    expiresAt?: Date;
    clearSession?: boolean;
};

export type EmailDelivery = EmailDeliveryStatus;

type AuthUnavailable = AuthFailure<typeof AuthErrorCode.AUTH_UNAVAILABLE, typeof ResultKind.UNAVAILABLE>;

type Authenticated = { kind: typeof ResultKind.AUTHENTICATED; user: SessionUser };

export type RegistrationAvailabilityResponse = { enabled: boolean };

export type RegistrationResponse =
    | { kind: typeof ResultKind.CREATED; status: typeof UserStatus.ACTIVE | typeof UserStatus.PENDING; verificationDelivery: EmailDelivery }
    | AuthFailure<typeof AuthErrorCode.REGISTRATION_DISABLED>
    | AuthFailure<typeof AuthErrorCode.IDENTIFIER_ALREADY_EXISTS, typeof ResultKind.DUPLICATE>
    | ValidationFailure<typeof AuthErrorCode.REGISTRATION_INVALID, 'email' | 'username' | 'password' | 'firstName' | 'lastName'>
    | AuthFailure<typeof AuthErrorCode.REGISTRATION_UNAVAILABLE, typeof ResultKind.UNAVAILABLE>;

export type LoginResponse =
    | Authenticated
    | ValidationFailure<typeof AuthErrorCode.LOGIN_INVALID, 'identifier' | 'password'>
    | AuthFailure<typeof AuthErrorCode.INVALID_CREDENTIALS, typeof ResultKind.INVALID_CREDENTIALS>
    | AuthUnavailable;

export type CurrentUserResponse = Authenticated | { kind: typeof ResultKind.ANONYMOUS } | AuthUnavailable;

export type LogoutResponse = { kind: typeof ResultKind.LOGGED_OUT } | AuthUnavailable;

export type ProfileResult =
    | { kind: typeof ResultKind.UPDATED; user: SessionUser; verificationDelivery?: EmailDelivery }
    | AuthFailure<
          | typeof AuthErrorCode.AUTH_REQUIRED
          | typeof AuthErrorCode.CURRENT_PASSWORD_REQUIRED
          | typeof AuthErrorCode.CURRENT_PASSWORD_INVALID
          | typeof AuthErrorCode.PROFILE_CHANGED
          | typeof AuthErrorCode.IDENTIFIER_ALREADY_EXISTS
      >;

export type ProfileResponse =
    | ProfileResult
    | ValidationFailure<
          typeof AuthErrorCode.PROFILE_INVALID,
          'firstName' | 'lastName' | 'email' | 'username' | 'currentPassword' | 'newPassword' | 'storeFuelLocation'
      >
    | AuthUnavailable;

export type ConfirmEmailResponse =
    | { kind: typeof ResultKind.VERIFIED }
    | AuthFailure<typeof AuthErrorCode.EMAIL_VERIFICATION_INVALID, typeof ResultKind.INVALID>
    | AuthUnavailable;

export type RequestEmailVerificationResponse =
    | { kind: typeof ResultKind.ALREADY_VERIFIED | typeof ResultKind.SENT }
    | AuthFailure<typeof AuthErrorCode.AUTH_REQUIRED>
    | AuthFailure<typeof AuthErrorCode.AUTH_UNAVAILABLE | typeof AuthErrorCode.EMAIL_DELIVERY_UNAVAILABLE, typeof ResultKind.UNAVAILABLE>;

export type VerificationRequestResult =
    { kind: typeof ResultKind.ALREADY_VERIFIED } | { kind: typeof ResultKind.REQUESTED; delivery: EmailDelivery };

export type PasswordResetRequestResponse =
    | { kind: typeof ResultKind.REQUESTED }
    | AuthFailure<typeof AuthErrorCode.PASSWORD_RESET_REQUEST_INVALID, typeof ResultKind.INVALID>
    | AuthFailure<typeof AuthErrorCode.AUTH_UNAVAILABLE, typeof ResultKind.UNAVAILABLE>;

export type PasswordResetResponse =
    | { kind: typeof ResultKind.RESET }
    | ValidationFailure<typeof AuthErrorCode.PASSWORD_RESET_INVALID, 'token' | 'newPassword'>
    | AuthFailure<typeof AuthErrorCode.PASSWORD_RESET_TOKEN_INVALID, typeof ResultKind.INVALID_TOKEN>
    | AuthUnavailable;
