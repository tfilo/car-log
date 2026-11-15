import type { HttpStatus } from '../common/http';
import type { AuthErrorCode } from '../auth/auth-errors';

export function serverFunctionError(code: AuthErrorCode, status: HttpStatus, headers?: Record<string, string>): Response {
    // Plain text makes the generated RPC caller reject with the stable code.
    // The GUI maps that code to an i18next key; raw internal errors stay private.
    return new Response(code, {
        status,
        headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/plain; charset=utf-8',
            'X-App-Error-Code': code,
            ...headers
        }
    });
}
