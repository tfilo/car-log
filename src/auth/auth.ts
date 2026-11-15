import type { z } from 'zod';
import { createServerFn } from '@tanstack/react-start';
import { HttpMethod } from '../common/http';
import { loginSchema } from './login-schema';
import { registrationSchema } from './registration-schema';
import { profileSchema, emailTokenSchema } from './profile-schema';
import { passwordResetRequestSchema, passwordResetSchema } from './password-reset-schema';
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
import {
    validateAuthInput,
    executeCurrentUser,
    executeLogin,
    executeLogout,
    executePasswordResetRequest,
    executePasswordReset,
    executeProfileUpdate,
    executeRegistration,
    executeRegistrationAvailability,
    executeEmailConfirmation,
    executeEmailVerificationRequest
} from './auth-response.server';

export const getCurrentUser = createServerFn({ method: HttpMethod.GET }).handler((): Promise<CurrentUserResponse> => executeCurrentUser());

export const login = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof loginSchema>) => validateAuthInput(loginSchema, input))
    .handler(({ data }): Promise<LoginResponse> => executeLogin(data));

export const logout = createServerFn({ method: HttpMethod.POST }).handler((): Promise<LogoutResponse> => executeLogout());

export const requestPasswordReset = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof passwordResetRequestSchema>) => validateAuthInput(passwordResetRequestSchema, input))
    .handler(({ data }): Promise<PasswordResetRequestResponse> => executePasswordResetRequest(data));

export const resetPassword = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof passwordResetSchema>) => validateAuthInput(passwordResetSchema, input))
    .handler(({ data }): Promise<PasswordResetResponse> => executePasswordReset(data));

export const updateMyProfile = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof profileSchema>) => validateAuthInput(profileSchema, input))
    .handler(({ data }): Promise<ProfileResponse> => executeProfileUpdate(data));

export const getRegistrationAvailability = createServerFn({ method: HttpMethod.GET }).handler((): RegistrationAvailabilityResponse =>
    executeRegistrationAvailability()
);

export const register = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof registrationSchema>) => validateAuthInput(registrationSchema, input))
    .handler(({ data }): Promise<RegistrationResponse> => executeRegistration(data));

export const confirmEmail = createServerFn({ method: HttpMethod.POST })
    .validator((input: z.input<typeof emailTokenSchema>) => validateAuthInput(emailTokenSchema, input))
    .handler(({ data }): Promise<ConfirmEmailResponse> => executeEmailConfirmation(data));

export const requestEmailVerification = createServerFn({ method: HttpMethod.POST }).handler((): Promise<RequestEmailVerificationResponse> =>
    executeEmailVerificationRequest()
);
