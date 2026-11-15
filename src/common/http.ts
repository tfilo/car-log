export const HttpMethod = {
    GET: 'GET',
    POST: 'POST',
    DELETE: 'DELETE'
} as const;

export type HttpMethod = (typeof HttpMethod)[keyof typeof HttpMethod];

export const HttpStatus = {
    OK: 200,
    CREATED: 201,
    ACCEPTED: 202,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    CONFLICT: 409,
    PAYLOAD_TOO_LARGE: 413,
    UNSUPPORTED_MEDIA_TYPE: 415,
    TOO_MANY_REQUESTS: 429,
    SERVICE_UNAVAILABLE: 503
} as const;

export type HttpStatus = (typeof HttpStatus)[keyof typeof HttpStatus];
