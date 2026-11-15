export const AuthErrorCode = {
    PASSWORD_RESET_REQUEST_INVALID: 'PASSWORD_RESET_REQUEST_INVALID',
    PASSWORD_RESET_INVALID: 'PASSWORD_RESET_INVALID',
    PASSWORD_RESET_TOKEN_INVALID: 'PASSWORD_RESET_TOKEN_INVALID',
    PROFILE_INVALID: 'PROFILE_INVALID',
    CURRENT_PASSWORD_REQUIRED: 'CURRENT_PASSWORD_REQUIRED',
    CURRENT_PASSWORD_INVALID: 'CURRENT_PASSWORD_INVALID',
    PROFILE_CHANGED: 'PROFILE_CHANGED',
    EMAIL_VERIFICATION_INVALID: 'EMAIL_VERIFICATION_INVALID',
    EMAIL_DELIVERY_UNAVAILABLE: 'EMAIL_DELIVERY_UNAVAILABLE',
    REGISTRATION_INVALID: 'REGISTRATION_INVALID',
    REGISTRATION_DISABLED: 'REGISTRATION_DISABLED',
    IDENTIFIER_ALREADY_EXISTS: 'IDENTIFIER_ALREADY_EXISTS',
    REGISTRATION_UNAVAILABLE: 'REGISTRATION_UNAVAILABLE',
    LOGIN_INVALID: 'LOGIN_INVALID',
    INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
    AUTH_UNAVAILABLE: 'AUTH_UNAVAILABLE',
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    ADMIN_REQUIRED: 'ADMIN_REQUIRED',
    REQUEST_METHOD_NOT_ALLOWED: 'REQUEST_METHOD_NOT_ALLOWED',
    REQUEST_CONTENT_TYPE_UNSUPPORTED: 'REQUEST_CONTENT_TYPE_UNSUPPORTED',
    REQUEST_BODY_TOO_LARGE: 'REQUEST_BODY_TOO_LARGE',
    REQUEST_BODY_INVALID: 'REQUEST_BODY_INVALID',
    REQUEST_FORBIDDEN: 'REQUEST_FORBIDDEN'
} as const;

export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];

export const authErrorKeys = {
    [AuthErrorCode.PASSWORD_RESET_REQUEST_INVALID]: 'errors.passwordResetRequestInvalid',
    [AuthErrorCode.PASSWORD_RESET_INVALID]: 'errors.passwordResetInvalid',
    [AuthErrorCode.PASSWORD_RESET_TOKEN_INVALID]: 'errors.passwordResetTokenInvalid',

    [AuthErrorCode.PROFILE_INVALID]: 'errors.profileInvalid',
    [AuthErrorCode.CURRENT_PASSWORD_REQUIRED]: 'errors.currentPasswordRequired',
    [AuthErrorCode.CURRENT_PASSWORD_INVALID]: 'errors.currentPasswordInvalid',
    [AuthErrorCode.PROFILE_CHANGED]: 'errors.profileChanged',
    [AuthErrorCode.EMAIL_VERIFICATION_INVALID]: 'errors.emailVerificationInvalid',
    [AuthErrorCode.EMAIL_DELIVERY_UNAVAILABLE]: 'errors.emailDeliveryUnavailable',
    [AuthErrorCode.REGISTRATION_INVALID]: 'errors.registrationInvalid',
    [AuthErrorCode.REGISTRATION_DISABLED]: 'errors.registrationDisabled',
    [AuthErrorCode.IDENTIFIER_ALREADY_EXISTS]: 'errors.identifierAlreadyExists',
    [AuthErrorCode.REGISTRATION_UNAVAILABLE]: 'errors.registrationUnavailable',
    [AuthErrorCode.LOGIN_INVALID]: 'errors.loginInvalid',
    [AuthErrorCode.INVALID_CREDENTIALS]: 'errors.invalidCredentials',
    [AuthErrorCode.AUTH_UNAVAILABLE]: 'errors.authUnavailable',
    [AuthErrorCode.AUTH_REQUIRED]: 'errors.authRequired',
    [AuthErrorCode.ADMIN_REQUIRED]: 'errors.adminRequired',
    [AuthErrorCode.REQUEST_METHOD_NOT_ALLOWED]: 'errors.requestMethodNotAllowed',
    [AuthErrorCode.REQUEST_CONTENT_TYPE_UNSUPPORTED]: 'errors.requestContentTypeUnsupported',
    [AuthErrorCode.REQUEST_BODY_TOO_LARGE]: 'errors.requestBodyTooLarge',
    [AuthErrorCode.REQUEST_BODY_INVALID]: 'errors.requestBodyInvalid',
    [AuthErrorCode.REQUEST_FORBIDDEN]: 'errors.requestForbidden'
} as const satisfies Record<AuthErrorCode, string>;

export function getAuthErrorKey(code: unknown): (typeof authErrorKeys)[AuthErrorCode] | 'errors.unexpected' {
    return typeof code === 'string' && Object.hasOwn(authErrorKeys, code) ? authErrorKeys[code as AuthErrorCode] : 'errors.unexpected';
}
