import { HttpStatus } from './common/http';
import { AuthErrorCode } from './auth/auth-errors';
import { createCsrfMiddleware, createMiddleware, createServerOnlyFn, createStart } from '@tanstack/react-start';
import { guardServerFunction } from './server-functions/server-function-guard.server';
import { serverFunctionError } from './server-functions/server-function-error.server';
import { applicationOrigin } from './common/request-security.server';
import { getServerFunctionOperation } from './server-functions/server-function-operation.server';

const csrfFailureResponse = createServerOnlyFn(() => serverFunctionError(AuthErrorCode.REQUEST_FORBIDDEN, HttpStatus.FORBIDDEN));

const csrfOrigin = createServerOnlyFn((origin: string, { request }: { request: Request }) => origin === applicationOrigin(request));

const csrfMiddleware = createCsrfMiddleware({
    filter: ({ handlerType }) => handlerType === 'serverFn',
    origin: csrfOrigin,
    failureResponse: csrfFailureResponse
});

const serverFunctionMiddleware = createMiddleware().server(async ({ request, handlerType, next }) => {
    if (handlerType !== 'serverFn') return next();

    const operation = getServerFunctionOperation(request);

    if (!operation) return serverFunctionError(AuthErrorCode.REQUEST_FORBIDDEN, HttpStatus.FORBIDDEN);

    return guardServerFunction(request, () => next(), operation);
});

// CSRF and transport validation apply to every RPC.
export const startInstance = createStart(() => ({
    requestMiddleware: [csrfMiddleware, serverFunctionMiddleware]
}));
