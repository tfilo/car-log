import { HttpMethod, HttpStatus } from '../common/http';
import { AuthErrorCode } from '../auth/auth-errors';
import { ServerFunctionOperation } from './server-function-operations';
import { serverFunctionError } from './server-function-error.server';

const maxBodyBytes = 8192;

async function bodyIsTooLarge(request: Request, maximum = maxBodyBytes): Promise<boolean> {
    if (Number(request.headers.get('content-length')) > maximum) return true;

    // Bound the body before TanStack deserializes its RPC envelope. A clone
    // preserves the original stream for the framework's parser.
    const reader = request.clone().body?.getReader();

    if (!reader) return false;

    let bytes = 0;
    let timedOut = false;
    const chunks: Uint8Array[] = [];
    const cancelBody = () => {
        // Cancel both tee branches without waiting for either individually.
        void reader.cancel().catch(() => {});
        void request.body?.cancel().catch(() => {});
    };
    const deadline = setTimeout(() => {
        timedOut = true;
        cancelBody();
    }, 5000);

    request.signal.addEventListener('abort', cancelBody, { once: true });

    try {
        while (true) {
            const chunk = await reader.read();

            if (timedOut || request.signal.aborted) throw new Error('Request body read was interrupted.');
            if (chunk.done) break;

            bytes += chunk.value.byteLength;

            if (bytes > maximum) {
                cancelBody();

                return true;
            }

            chunks.push(chunk.value);
        }
    } finally {
        clearTimeout(deadline);
        request.signal.removeEventListener('abort', cancelBody);
        reader.releaseLock();
    }

    const body = new Uint8Array(bytes);
    let offset = 0;

    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }

    // Keep malformed JSON (and its potentially sensitive parser diagnostics)
    // out of TanStack's error serialization.
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));

    return false;
}

export async function guardServerFunction<T>(
    request: Request,
    next: () => T | Promise<T>,
    operation: ServerFunctionOperation = ServerFunctionOperation.REGISTER
): Promise<T | Response> {
    const credentialOperation =
        operation === ServerFunctionOperation.REGISTER ||
        operation === ServerFunctionOperation.LOGIN ||
        operation === ServerFunctionOperation.UPDATE_MY_PROFILE ||
        operation === ServerFunctionOperation.RESET_PASSWORD;
    const resetRequest = operation === ServerFunctionOperation.REQUEST_PASSWORD_RESET;

    const expectedMethod =
        operation === ServerFunctionOperation.GET_TRANSFER_STATUS ||
        operation === ServerFunctionOperation.GET_EXPORT_DOWNLOAD ||
        operation === ServerFunctionOperation.LIST_EXPENSES ||
        operation === ServerFunctionOperation.GET_EXPENSE ||
        operation === ServerFunctionOperation.LIST_EXPENSE_CATEGORIES ||
        operation === ServerFunctionOperation.GET_STATISTICS ||
        operation === ServerFunctionOperation.GET_CURRENT_USER ||
        operation === ServerFunctionOperation.GET_REGISTRATION_AVAILABILITY ||
        operation === ServerFunctionOperation.LIST_USERS ||
        operation === ServerFunctionOperation.LIST_VEHICLES ||
        operation === ServerFunctionOperation.GET_VEHICLE ||
        operation === ServerFunctionOperation.LIST_FUEL_RECORDS ||
        operation === ServerFunctionOperation.GET_FUEL_RECORD
            ? HttpMethod.GET
            : HttpMethod.POST;

    if (request.method !== expectedMethod)
        return serverFunctionError(AuthErrorCode.REQUEST_METHOD_NOT_ALLOWED, HttpStatus.METHOD_NOT_ALLOWED, { Allow: expectedMethod });
    if (request.url.length > maxBodyBytes) return serverFunctionError(AuthErrorCode.REQUEST_BODY_TOO_LARGE, HttpStatus.PAYLOAD_TOO_LARGE);

    const hasBody = request.body !== null && request.headers.get('content-length') !== '0';

    if (
        (credentialOperation || resetRequest || operation === ServerFunctionOperation.CONFIRM_EMAIL || hasBody) &&
        request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
    ) {
        return serverFunctionError(AuthErrorCode.REQUEST_CONTENT_TYPE_UNSUPPORTED, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }

    try {
        if (hasBody && (await bodyIsTooLarge(request, operation === ServerFunctionOperation.IMPORT_ARCHIVE ? 140001000 : maxBodyBytes)))
            return serverFunctionError(AuthErrorCode.REQUEST_BODY_TOO_LARGE, HttpStatus.PAYLOAD_TOO_LARGE);
    } catch {
        return serverFunctionError(AuthErrorCode.REQUEST_BODY_INVALID, HttpStatus.BAD_REQUEST);
    }

    return next();
}
