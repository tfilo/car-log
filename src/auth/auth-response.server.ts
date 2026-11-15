import { z } from 'zod';
import { getRequest, setResponseHeader, setResponseStatus } from '@tanstack/react-start/server';
import { HttpStatus } from '../common/http';
import { ResultKind } from '../common/result-kind';
import { ServerFunctionOperation } from '../server-functions/server-function-operations';
import { LogOperation } from '../log-operations.server';
import { logServerError } from '../logging.server';
import { EmailDeliveryStatus } from '../email/email-delivery-status';
import { db } from '../db.server';
import { AuthErrorCode } from './auth-errors';
import { loginUser } from './login.server';
import { registerUser, isRegistrationEnabled, RegistrationDisabledError } from './registration.server';
import { updateUserProfile } from './profile.server';
import { confirmEmailAddress, requestVerificationForUser } from './email-verification.server';
import { completePasswordReset, startPasswordResetRequest } from './password-reset.server';
import { revokeSession } from './session.server';
import { clearSessionCookie, getCurrentSession, getSessionToken, writeSessionCookie } from './session-cookie.server';
import type { loginSchema } from './login-schema';
import type { registrationSchema } from './registration-schema';
import type { profileSchema, emailTokenSchema } from './profile-schema';
import type { passwordResetRequestSchema, passwordResetSchema } from './password-reset-schema';
import type {
    CurrentUserResponse,
    LoginResponse,
    LogoutResponse,
    PasswordResetRequestResponse,
    PasswordResetResponse,
    ProfileResponse,
    RegistrationResponse,
    RegistrationAvailabilityResponse,
    ConfirmEmailResponse,
    RequestEmailVerificationResponse
} from './auth.types';

type Validated<Input> =
    { valid: true; input: Input } | { valid: false; errors: { fieldErrors: Partial<Record<keyof Input, string[]>>; formErrors: string[] } };

export function validateAuthInput<Input, Output>(schema: z.ZodType<Output, Input>, input: Input): Validated<Output> {
    const result = schema.safeParse(input);

    if (result.success) return { valid: true, input: result.data };

    return { valid: false, errors: z.flattenError(result.error) };
}

export async function executeCurrentUser(): Promise<CurrentUserResponse> {
    setResponseHeader('Cache-Control', 'no-store');

    try {
        const session = await getCurrentSession();

        return session ? { kind: ResultKind.AUTHENTICATED, user: session.user } : { kind: ResultKind.ANONYMOUS };
    } catch (error) {
        logServerError(ServerFunctionOperation.GET_CURRENT_USER, error);

        setResponseStatus(HttpStatus.SERVICE_UNAVAILABLE);

        return { kind: ResultKind.UNAVAILABLE, code: AuthErrorCode.AUTH_UNAVAILABLE };
    }
}

export async function executeLogin(data: Validated<z.output<typeof loginSchema>>): Promise<LoginResponse> {
    setResponseHeader('Cache-Control', 'no-store');

    if (!data.valid) {
        setResponseStatus(HttpStatus.BAD_REQUEST);

        return {
            kind: ResultKind.INVALID,
            code: AuthErrorCode.LOGIN_INVALID,
            fields: data.errors.fieldErrors,
            formErrors: data.errors.formErrors
        };
    }

    try {
        const session = await loginUser(data.input, getSessionToken());

        if (!session) {
            setResponseStatus(HttpStatus.UNAUTHORIZED);

            return { kind: ResultKind.INVALID_CREDENTIALS, code: AuthErrorCode.INVALID_CREDENTIALS };
        }

        writeSessionCookie(session.token, session.expiresAt);

        return { kind: ResultKind.AUTHENTICATED, user: session.user };
    } catch (error) {
        logServerError(ServerFunctionOperation.LOGIN, error);

        setResponseStatus(HttpStatus.SERVICE_UNAVAILABLE);

        return { kind: ResultKind.UNAVAILABLE, code: AuthErrorCode.AUTH_UNAVAILABLE };
    }
}

export async function executeLogout(): Promise<LogoutResponse> {
    setResponseHeader('Cache-Control', 'no-store');

    try {
        const token = getSessionToken();

        if (token) await revokeSession(token);

        clearSessionCookie();

        return { kind: ResultKind.LOGGED_OUT };
    } catch (error) {
        logServerError(ServerFunctionOperation.LOGOUT, error);

        setResponseStatus(HttpStatus.SERVICE_UNAVAILABLE);

        return { kind: ResultKind.UNAVAILABLE, code: AuthErrorCode.AUTH_UNAVAILABLE };
    }
}

export async function executePasswordResetRequest(
    data: Validated<z.output<typeof passwordResetRequestSchema>>
): Promise<PasswordResetRequestResponse> {
    setResponseHeader('Cache-Control', 'no-store');

    if (!data.valid) {
        setResponseStatus(HttpStatus.BAD_REQUEST);

        return { kind: ResultKind.INVALID, code: AuthErrorCode.PASSWORD_RESET_REQUEST_INVALID };
    }

    try {
        const work = startPasswordResetRequest(data.input);

        const request = getRequest();

        // srvx tracks background work through waitUntil. The long-running
        // Node development server also keeps pending database/SMTP I/O alive.
        if ('waitUntil' in request && typeof request.waitUntil === 'function') request.waitUntil(work);

        setResponseStatus(HttpStatus.ACCEPTED);

        return { kind: ResultKind.REQUESTED };
    } catch (error) {
        logServerError(ServerFunctionOperation.REQUEST_PASSWORD_RESET, error);

        setResponseStatus(HttpStatus.SERVICE_UNAVAILABLE);

        return { kind: ResultKind.UNAVAILABLE, code: AuthErrorCode.AUTH_UNAVAILABLE };
    }
}

export async function executePasswordReset(data: Validated<z.output<typeof passwordResetSchema>>): Promise<PasswordResetResponse> {
    setResponseHeader('Cache-Control', 'no-store');

    if (!data.valid) {
        setResponseStatus(HttpStatus.BAD_REQUEST);

        return {
            kind: ResultKind.INVALID,
            code: AuthErrorCode.PASSWORD_RESET_INVALID,
            fields: data.errors.fieldErrors,
            formErrors: data.errors.formErrors
        };
    }

    try {
        if (!(await completePasswordReset(data.input))) {
            setResponseStatus(HttpStatus.BAD_REQUEST);

            return { kind: ResultKind.INVALID_TOKEN, code: AuthErrorCode.PASSWORD_RESET_TOKEN_INVALID };
        }

        return { kind: ResultKind.RESET };
    } catch (error) {
        logServerError(ServerFunctionOperation.RESET_PASSWORD, error);

        setResponseStatus(HttpStatus.SERVICE_UNAVAILABLE);

        return { kind: ResultKind.UNAVAILABLE, code: AuthErrorCode.AUTH_UNAVAILABLE };
    }
}

export async function executeProfileUpdate(data: Validated<z.output<typeof profileSchema>>): Promise<ProfileResponse> {
    setResponseHeader('Cache-Control', 'no-store');

    if (!data.valid) {
        setResponseStatus(HttpStatus.BAD_REQUEST);

        return {
            kind: ResultKind.INVALID,
            code: AuthErrorCode.PROFILE_INVALID,
            fields: data.errors.fieldErrors,
            formErrors: data.errors.formErrors
        };
    }

    try {
        const token = getSessionToken();
        const outcome = await updateUserProfile(token, data.input);

        if ('clearSession' in outcome && outcome.clearSession) clearSessionCookie();
        else if ('expiresAt' in outcome && outcome.expiresAt) {
            const nextToken = 'sessionToken' in outcome ? outcome.sessionToken : token;

            if (nextToken) writeSessionCookie(nextToken, outcome.expiresAt);
        }

        if (outcome.result.kind === ResultKind.ERROR) {
            setResponseStatus(
                outcome.result.code === AuthErrorCode.AUTH_REQUIRED
                    ? HttpStatus.UNAUTHORIZED
                    : outcome.result.code === AuthErrorCode.IDENTIFIER_ALREADY_EXISTS ||
                        outcome.result.code === AuthErrorCode.PROFILE_CHANGED
                      ? HttpStatus.CONFLICT
                      : HttpStatus.BAD_REQUEST
            );
        }

        return outcome.result;
    } catch (error) {
        logServerError(ServerFunctionOperation.UPDATE_MY_PROFILE, error);

        setResponseStatus(HttpStatus.SERVICE_UNAVAILABLE);

        return { kind: ResultKind.UNAVAILABLE, code: AuthErrorCode.AUTH_UNAVAILABLE };
    }
}

export function executeRegistrationAvailability(): RegistrationAvailabilityResponse {
    setResponseHeader('Cache-Control', 'no-store');

    return { enabled: isRegistrationEnabled() };
}

export async function executeRegistration(data: Validated<z.output<typeof registrationSchema>>): Promise<RegistrationResponse> {
    setResponseHeader('Cache-Control', 'no-store');

    if (!data.valid) {
        setResponseStatus(HttpStatus.BAD_REQUEST);

        return {
            kind: ResultKind.INVALID,
            code: AuthErrorCode.REGISTRATION_INVALID,
            fields: data.errors.fieldErrors,
            formErrors: data.errors.formErrors
        };
    }

    try {
        const result = await registerUser(data.input);

        if (result.kind === ResultKind.DUPLICATE) {
            setResponseStatus(HttpStatus.CONFLICT);

            return { kind: ResultKind.DUPLICATE, code: AuthErrorCode.IDENTIFIER_ALREADY_EXISTS };
        }

        setResponseStatus(HttpStatus.CREATED);

        let verificationDelivery: EmailDeliveryStatus = EmailDeliveryStatus.UNAVAILABLE;

        try {
            const user = await db.user.findUnique({ where: { email: data.input.email }, select: { id: true } });

            if (user) {
                const verification = await requestVerificationForUser(user.id);

                if (verification.kind === ResultKind.REQUESTED) verificationDelivery = verification.delivery;
            }
        } catch (error) {
            logServerError(LogOperation.REGISTRATION_VERIFICATION, error);

            /* Account creation succeeded; delivery can be retried after login. */
        }

        return { ...result, verificationDelivery };
    } catch (error) {
        if (error instanceof RegistrationDisabledError) {
            setResponseStatus(HttpStatus.FORBIDDEN);

            return { kind: ResultKind.ERROR, code: AuthErrorCode.REGISTRATION_DISABLED };
        }

        logServerError(ServerFunctionOperation.REGISTER, error);

        setResponseStatus(HttpStatus.SERVICE_UNAVAILABLE);

        return { kind: ResultKind.UNAVAILABLE, code: AuthErrorCode.REGISTRATION_UNAVAILABLE };
    }
}

export async function executeEmailConfirmation(data: Validated<z.output<typeof emailTokenSchema>>): Promise<ConfirmEmailResponse> {
    setResponseHeader('Cache-Control', 'no-store');

    try {
        if (!data.valid || !(await confirmEmailAddress(data.input.token))) {
            setResponseStatus(HttpStatus.BAD_REQUEST);

            return { kind: ResultKind.INVALID, code: AuthErrorCode.EMAIL_VERIFICATION_INVALID };
        }

        return { kind: ResultKind.VERIFIED };
    } catch (error) {
        logServerError(ServerFunctionOperation.CONFIRM_EMAIL, error);

        setResponseStatus(HttpStatus.SERVICE_UNAVAILABLE);

        return { kind: ResultKind.UNAVAILABLE, code: AuthErrorCode.AUTH_UNAVAILABLE };
    }
}

export async function executeEmailVerificationRequest(): Promise<RequestEmailVerificationResponse> {
    setResponseHeader('Cache-Control', 'no-store');

    try {
        const session = await getCurrentSession();

        if (!session) {
            setResponseStatus(HttpStatus.UNAUTHORIZED);

            return { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED };
        }

        const outcome = await requestVerificationForUser(session.user.id);

        if (outcome.kind === ResultKind.REQUESTED && outcome.delivery === EmailDeliveryStatus.UNAVAILABLE) {
            setResponseStatus(HttpStatus.SERVICE_UNAVAILABLE);

            return { kind: ResultKind.UNAVAILABLE, code: AuthErrorCode.EMAIL_DELIVERY_UNAVAILABLE };
        }

        return { kind: outcome.kind === ResultKind.ALREADY_VERIFIED ? ResultKind.ALREADY_VERIFIED : ResultKind.SENT };
    } catch (error) {
        logServerError(ServerFunctionOperation.REQUEST_EMAIL_VERIFICATION, error);

        setResponseStatus(HttpStatus.SERVICE_UNAVAILABLE);

        return { kind: ResultKind.UNAVAILABLE, code: AuthErrorCode.AUTH_UNAVAILABLE };
    }
}
