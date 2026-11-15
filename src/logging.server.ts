// Only use fixed configuration guidance here, never configuration values or input.
export class ConfigurationError extends Error {}

const diagnosticCodes = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EACCES',
    'EPERM',
    'ENOSPC',
    'EROFS',
    'ENOENT',
    'EIO',
    'EAUTH',
    'ECONNECTION',
    'ESOCKET',
    'ETLS',
    'EENVELOPE',
    'EMESSAGE',
    'ESTREAM',
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    '23503',
    '23505',
    '40001',
    '40P01',
    '42P01',
    '42703',
    '53300',
    '57P01'
]);

const errorTypes = new Set([
    'Error',
    'TypeError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'AggregateError',
    'PrismaClientKnownRequestError',
    'PrismaClientUnknownRequestError',
    'PrismaClientInitializationError',
    'PrismaClientValidationError',
    'PrismaClientRustPanicError'
]);

function diagnosticCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') return;

    const code = 'code' in error ? error.code : 'errorCode' in error ? error.errorCode : undefined;

    if (typeof code === 'string' && (diagnosticCodes.has(code) || /^P\d{4}$/.test(code))) return code;
}

export function logServerError(operation: string, error: unknown): void {
    const cause = error instanceof AggregateError ? error.errors[0] : error instanceof Error ? error.cause : undefined;

    // Never serialize arbitrary messages, stacks, causes, metadata, or request data.
    console.error(
        JSON.stringify({
            time: new Date().toISOString(),
            level: 'error',
            operation,
            error: error instanceof ConfigurationError ? error.message : 'Unexpected server failure.',
            type:
                error instanceof ConfigurationError
                    ? 'ConfigurationError'
                    : error instanceof Error && errorTypes.has(error.name)
                      ? error.name
                      : 'UnknownError',
            code: diagnosticCode(error),
            causeCode: diagnosticCode(cause)
        })
    );
}
