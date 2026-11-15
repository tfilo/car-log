import { UserErrorCode } from '../src/users/user-errors';
import { beforeEach, expect, test, vi } from 'vitest';
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server';
import { clearSessionCookie, getSessionToken, writeSessionCookie } from '../src/auth/session-cookie.server';
import { logServerError } from '../src/logging.server';
import { AuthErrorCode } from '../src/auth/auth-errors';
import { ResultKind } from '../src/common/result-kind';
import { ServerFunctionOperation } from '../src/server-functions/server-function-operations';
import { HttpStatus } from '../src/common/http';
import type { SessionOutcome } from '../src/auth/auth.types';
import type { UserListResult } from '../src/users/user.types';
import { userListSchema } from '../src/users/user-schema';
import { executeUserOperation, validateUserInput } from '../src/users/user-response.server';

vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: vi.fn(), setResponseStatus: vi.fn() }));
vi.mock('../src/auth/session-cookie.server', () => ({
    getSessionToken: vi.fn(),
    writeSessionCookie: vi.fn(),
    clearSessionCookie: vi.fn()
}));
vi.mock('../src/logging.server', () => ({ logServerError: vi.fn() }));

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSessionToken).mockReturnValue('synthetic-session');
});

test('invalid input returns the existing 400 envelope without calling the operation', async () => {
    const operation = vi.fn();
    const result = await executeUserOperation(
        validateUserInput(userListSchema, { page: -1 }),
        operation,
        ServerFunctionOperation.LIST_USERS
    );

    expect(result).toMatchObject({ kind: ResultKind.INVALID, code: UserErrorCode.ACCOUNT_INVALID, fields: { page: expect.any(Array) } });
    expect(setResponseHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(setResponseStatus).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(operation).not.toHaveBeenCalled();
    expect(getSessionToken).not.toHaveBeenCalled();
});

test('valid input applies defaults and renews the session without exposing cookie metadata', async () => {
    const expiresAt = new Date('2030-01-01T00:00:00Z');
    const result: UserListResult = { kind: ResultKind.USERS, users: [], total: 0, page: 0, pageSize: 25 };
    const operation = vi.fn(async (): Promise<SessionOutcome<UserListResult>> => ({ result, expiresAt }));

    expect(await executeUserOperation(validateUserInput(userListSchema, undefined), operation, ServerFunctionOperation.LIST_USERS)).toEqual(
        result
    );
    expect(operation).toHaveBeenCalledWith('synthetic-session', { page: 0, pageSize: 25 });
    expect(writeSessionCookie).toHaveBeenCalledWith('synthetic-session', expiresAt);
    expect(setResponseStatus).not.toHaveBeenCalled();
});

test('domain failures preserve their status and clear revoked sessions', async () => {
    const operation = vi.fn(async (): Promise<SessionOutcome<UserListResult>> => ({
        result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED },
        clearSession: true
    }));

    expect(await executeUserOperation(validateUserInput(userListSchema, undefined), operation, ServerFunctionOperation.LIST_USERS)).toEqual(
        { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }
    );
    expect(setResponseStatus).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(clearSessionCookie).toHaveBeenCalledOnce();
    expect(writeSessionCookie).not.toHaveBeenCalled();
    expect(logServerError).not.toHaveBeenCalled();
});

test('unexpected failures retain the existing 503 envelope and canonical operation label', async () => {
    const error = new Error('Synthetic failure');
    const operation = vi.fn(async (): Promise<never> => {
        throw error;
    });

    expect(await executeUserOperation(validateUserInput(userListSchema, undefined), operation, ServerFunctionOperation.LIST_USERS)).toEqual(
        { kind: ResultKind.UNAVAILABLE, code: UserErrorCode.ACCOUNT_UNAVAILABLE }
    );
    expect(setResponseStatus).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(logServerError).toHaveBeenCalledWith(ServerFunctionOperation.LIST_USERS, error);
});
