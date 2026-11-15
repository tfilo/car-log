import { LogOperation } from '../src/log-operations.server';
import { afterEach, expect, test, vi } from 'vitest';
import { executeVehicleOperation, validateVehicleInput } from '../src/vehicles/vehicle-response.server';
import { vehicleListSchema } from '../src/vehicles/vehicle-schema';
import { deliverVerification } from '../src/auth/email-verification.server';
import { startPasswordResetRequest } from '../src/auth/password-reset.server';
import { AuthErrorCode } from '../src/auth/auth-errors';
import { VehicleErrorCode } from '../src/vehicles/vehicle-errors';
import { EmailDeliveryStatus } from '../src/email/email-delivery-status';
import { ResultKind } from '../src/common/result-kind';
import { HttpStatus } from '../src/common/http';
import { ServerFunctionOperation } from '../src/server-functions/server-function-operations';
import { setResponseStatus } from '@tanstack/react-start/server';

vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: vi.fn(), setResponseStatus: vi.fn() }));
vi.mock('../src/auth/session-cookie.server', () => ({
    getSessionToken: vi.fn(),
    writeSessionCookie: vi.fn(),
    clearSessionCookie: vi.fn()
}));
vi.mock('../src/db.server', () => ({ db: {} }));
vi.mock('../src/email/verification-mail.server', () => ({ sendVerificationEmail: vi.fn(), sendPasswordResetEmail: vi.fn() }));

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

test('unexpected domain failures log diagnostics and retain the generic client response', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    async function listOwnedVehicles(): Promise<never> {
        throw Object.assign(new Error('private query and password'), { code: 'P2021' });
    }

    const result = await executeVehicleOperation({ valid: true, input: {} }, listOwnedVehicles);

    expect(result).toEqual({ kind: ResultKind.ERROR, code: VehicleErrorCode.UNAVAILABLE });
    expect(setResponseStatus).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(stderr).toHaveBeenCalledOnce();
    expect(JSON.parse(stderr.mock.calls[0][0])).toMatchObject({ operation: listOwnedVehicles.name, code: 'P2021' });
    expect(stderr.mock.calls[0][0]).not.toContain('private');
});

test('expected validation and authentication failures do not create error logs', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const operation = vi.fn(async () => ({
        result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED } as const,
        clearSession: true
    }));

    await executeVehicleOperation(validateVehicleInput(vehicleListSchema, { page: -1 }), operation);
    expect(operation).not.toHaveBeenCalled();

    await executeVehicleOperation({ valid: true, input: {} }, operation);
    expect(setResponseStatus).toHaveBeenLastCalledWith(HttpStatus.UNAUTHORIZED);
    expect(stderr).not.toHaveBeenCalled();
});

test('email delivery failures log once without exposing the address, token, or SMTP response', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const message = { email: 'synthetic@example.test', token: 'synthetic-private-token' };
    const sender = vi.fn(async () => {
        throw Object.assign(new Error(`SMTP refused ${message.email}: ${message.token}`), { code: 'EAUTH' });
    });

    expect(await deliverVerification(message, sender)).toBe(EmailDeliveryStatus.UNAVAILABLE);
    expect(stderr).toHaveBeenCalledOnce();
    expect(JSON.parse(stderr.mock.calls[0][0])).toMatchObject({ operation: LogOperation.DELIVER_ACCOUNT_EMAIL, code: 'EAUTH' });
    expect(stderr.mock.calls[0][0]).not.toContain(message.email);
    expect(stderr.mock.calls[0][0]).not.toContain(message.token);
});

test('successful email delivery does not produce an error log', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await deliverVerification({ email: 'synthetic@example.test', token: 'synthetic-token' }, async () => {})).toBe(
        EmailDeliveryStatus.SENT
    );
    expect(stderr).not.toHaveBeenCalled();
});

test('background password-reset failures are logged and remain handled', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(startPasswordResetRequest({ identifier: 'synthetic@example.test' })).resolves.toBeUndefined();
    expect(stderr).toHaveBeenCalledOnce();
    expect(JSON.parse(stderr.mock.calls[0][0])).toMatchObject({
        operation: ServerFunctionOperation.REQUEST_PASSWORD_RESET,
        type: 'TypeError'
    });
    expect(stderr.mock.calls[0][0]).not.toContain('synthetic@example.test');
});
