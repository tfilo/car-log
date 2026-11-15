import { ResultKind } from '../src/common/result-kind';
import { ServerFunctionOperation } from '../src/server-functions/server-function-operations';
import { HttpStatus, HttpMethod } from '../src/common/http';
import { expect, test, vi } from 'vitest';
import { guardServerFunction } from '../src/server-functions/server-function-guard.server';

function request(body: string, headers?: Record<string, string>) {
    return new Request('http://localhost/_server/test', {
        method: HttpMethod.POST,
        headers: { 'content-type': 'application/json', ...headers },
        body
    });
}

test('preserves the RPC request body for TanStack to deserialize', async () => {
    const input = request('{"data":{"username":"test123"}}');
    const result = await guardServerFunction(input, async () => input.json());

    expect(result).toEqual({ data: { username: 'test123' } });
});

test('rejects oversized bodies without relying on Content-Length', async () => {
    const next = vi.fn();
    const result = await guardServerFunction(request('x'.repeat(8193)), next);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(next).not.toHaveBeenCalled();
});

test('rejects unsupported content type before deserialization', async () => {
    const next = vi.fn();
    const result = await guardServerFunction(request('{}', { 'content-type': 'text/plain' }), next);

    expect((result as Response).status).toBe(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    expect(next).not.toHaveBeenCalled();
});

test('rejects malformed JSON without echoing parser diagnostics or input', async () => {
    const next = vi.fn();
    const result = await guardServerFunction(request('{"password":"sensitive"'), next);

    expect((result as Response).status).toBe(HttpStatus.BAD_REQUEST);
    expect(await (result as Response).text()).not.toContain('sensitive');
    expect(next).not.toHaveBeenCalled();
});

test('logout accepts an empty POST stream reported with Content-Length zero', async () => {
    const input = new Request('http://localhost/_server/test', {
        method: HttpMethod.POST,
        body: '',
        headers: { 'content-length': '0' }
    });

    expect(await guardServerFunction(input, async () => ResultKind.LOGGED_OUT, ServerFunctionOperation.LOGOUT)).toBe(ResultKind.LOGGED_OUT);
});

test('unfinished bodies expire after five seconds', async () => {
    vi.useFakeTimers();

    const pending: Promise<unknown>[] = [];

    try {
        for (let index = 0; index < 2; index++) {
            const body = new ReadableStream<Uint8Array>();
            const input = new Request('http://localhost/_server/test', {
                method: HttpMethod.POST,
                headers: { 'Content-Type': 'application/json' },
                body,
                // @ts-expect-error Node requires duplex for streamed request bodies.
                duplex: 'half'
            });

            pending.push(guardServerFunction(input, () => 'unexpected'));
        }

        expect(await guardServerFunction(request('{}'), () => 'ok')).toBe('ok');

        await vi.advanceTimersByTimeAsync(5001);

        for (const result of await Promise.all(pending)) expect((result as Response).status).toBe(HttpStatus.BAD_REQUEST);
    } finally {
        vi.useRealTimers();
    }
});

test('public registration availability accepts GET and rejects POST', async () => {
    const get = new Request('http://localhost/_server/test');
    const next = vi.fn(() => ({ enabled: false }));

    expect(await guardServerFunction(get, next, ServerFunctionOperation.GET_REGISTRATION_AVAILABILITY)).toEqual({ enabled: false });

    const response = await guardServerFunction(request('{}'), next, ServerFunctionOperation.GET_REGISTRATION_AVAILABILITY);

    expect((response as Response).status).toBe(HttpStatus.METHOD_NOT_ALLOWED);
    expect(next).toHaveBeenCalledTimes(1);
});
