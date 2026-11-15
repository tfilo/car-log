import { registerUser, RegistrationDisabledError } from '../src/auth/registration.server';
import { ServerFunctionOperation } from '../src/server-functions/server-function-operations';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server';
import { AuthErrorCode } from '../src/auth/auth-errors';
import { ResultKind } from '../src/common/result-kind';
import { HttpStatus } from '../src/common/http';
import { loginSchema } from '../src/auth/login-schema';
import { registrationSchema } from '../src/auth/registration-schema';
import { profileSchema, emailTokenSchema } from '../src/auth/profile-schema';
import { passwordResetRequestSchema, passwordResetSchema } from '../src/auth/password-reset-schema';
import {
    validateAuthInput,
    executeLogin,
    executeRegistration,
    executeRegistrationAvailability,
    executeProfileUpdate,
    executePasswordResetRequest,
    executePasswordReset,
    executeEmailConfirmation
} from '../src/auth/auth-response.server';

vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: vi.fn(), setResponseStatus: vi.fn(), getRequest: vi.fn() }));
vi.mock('../src/db.server', () => ({ db: {} }));
vi.mock('../src/email/verification-mail.server', () => ({ sendVerificationEmail: vi.fn(), sendPasswordResetEmail: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

afterEach(() => vi.unstubAllEnvs());

test.each([
    {
        operation: ServerFunctionOperation.LOGIN,
        run: () => executeLogin(validateAuthInput(loginSchema, { identifier: '', password: '' })),
        code: AuthErrorCode.LOGIN_INVALID
    },
    {
        operation: ServerFunctionOperation.REGISTER,
        run: () => executeRegistration(validateAuthInput(registrationSchema, { email: '', username: '', password: '' })),
        code: AuthErrorCode.REGISTRATION_INVALID
    },
    {
        operation: ServerFunctionOperation.UPDATE_MY_PROFILE,
        run: () => executeProfileUpdate(validateAuthInput(profileSchema, { firstName: 'x'.repeat(101) })),
        code: AuthErrorCode.PROFILE_INVALID
    },
    {
        operation: ServerFunctionOperation.REQUEST_PASSWORD_RESET,
        run: () => executePasswordResetRequest(validateAuthInput(passwordResetRequestSchema, { identifier: '' })),
        code: AuthErrorCode.PASSWORD_RESET_REQUEST_INVALID
    },
    {
        operation: ServerFunctionOperation.RESET_PASSWORD,
        run: () => executePasswordReset(validateAuthInput(passwordResetSchema, { token: '', newPassword: '' })),
        code: AuthErrorCode.PASSWORD_RESET_INVALID
    },
    {
        operation: ServerFunctionOperation.CONFIRM_EMAIL,
        run: () => executeEmailConfirmation(validateAuthInput(emailTokenSchema, { token: '' })),
        code: AuthErrorCode.EMAIL_VERIFICATION_INVALID
    }
])('$operation keeps its public validation code and HTTP status without database access', async ({ run, code }) => {
    expect(await run()).toMatchObject({ kind: ResultKind.INVALID, code });
    expect(setResponseStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(setResponseHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
});

test.each([
    { value: undefined, enabled: true },
    { value: 'false', enabled: true },
    { value: 'true', enabled: false }
])('registration availability is $enabled when DISABLE_REGISTRATION=$value', ({ value, enabled }) => {
    vi.stubEnv('DISABLE_REGISTRATION', value);

    expect(executeRegistrationAvailability()).toEqual({ enabled });
    expect(setResponseHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
});

test('disabled registration rejects direct domain calls before validation and returns HTTP 403 from the RPC handler', async () => {
    vi.stubEnv('DISABLE_REGISTRATION', 'true');

    await expect(registerUser({ email: '', username: '', password: '' })).rejects.toThrow(RegistrationDisabledError);

    const result = await executeRegistration(
        validateAuthInput(registrationSchema, { email: 'synthetic@example.test', username: 'syntheticuser', password: 'Password123^' })
    );

    expect(result).toEqual({ kind: ResultKind.ERROR, code: AuthErrorCode.REGISTRATION_DISABLED });
    expect(setResponseStatus).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
});
