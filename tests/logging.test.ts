import { afterEach, expect, test, vi } from 'vitest';
import { ConfigurationError, logServerError } from '../src/logging.server';
import { ServerFunctionOperation } from '../src/server-functions/server-function-operations';

afterEach(() => vi.restoreAllMocks());

test('writes one JSON line to stderr with safe technical details only', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = Object.assign(new Error('SQL and credentials must not be logged\nprivate@example.test'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2021',
        meta: { query: 'SELECT private_data', params: ['secret-token'] }
    });

    logServerError(ServerFunctionOperation.LOGIN, error);

    expect(stderr).toHaveBeenCalledOnce();
    const line = stderr.mock.calls[0][0];

    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
        time: expect.any(String),
        level: 'error',
        operation: ServerFunctionOperation.LOGIN,
        error: 'Unexpected server failure.',
        type: 'PrismaClientKnownRequestError',
        code: 'P2021'
    });
    expect(Number.isNaN(Date.parse(JSON.parse(line).time))).toBe(false);
});

test('extracts safe connection codes from wrapped errors without exposing causes', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = Object.assign(new Error('postgresql://private:password@database/private'), { code: 'ECONNREFUSED' });

    logServerError(ServerFunctionOperation.LOGIN, new Error('private SQL', { cause }));
    logServerError(ServerFunctionOperation.LOGIN, new AggregateError([cause], 'private SQL'));

    for (const [line] of stderr.mock.calls) {
        expect(JSON.parse(line).causeCode).toBe('ECONNREFUSED');
        expect(line).not.toContain('private');
        expect(line).not.toContain('password');
    }
});

test.each([
    'secret-token',
    { message: 'secret-token', name: 'secret-token', code: 'secret-token', stack: 'secret-token' },
    Object.assign(new Error('secret-token'), { name: 'secret-token', code: 'secret-token', cause: 'secret-token' }),
    null
])('does not serialize arbitrary thrown values, names, codes, or messages', (error) => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});

    logServerError(ServerFunctionOperation.LOGIN, error);

    const line = stderr.mock.calls[0][0];

    expect(line).not.toContain('secret-token');
    expect(JSON.parse(line).type).toBe('UnknownError');
});

test('keeps fixed configuration guidance actionable', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});

    logServerError(ServerFunctionOperation.LOGIN, new ConfigurationError('Set PASSWORD_PEPPER before using authentication.'));

    expect(JSON.parse(stderr.mock.calls[0][0])).toMatchObject({
        error: 'Set PASSWORD_PEPPER before using authentication.',
        type: 'ConfigurationError'
    });
});
