import { LogOperation } from '../log-operations.server';
import { logServerError } from '../logging.server';
import { getSessionToken } from '../auth/session-cookie.server';
import { applicationOrigin } from '../common/request-security.server';
import { AuthErrorCode } from '../auth/auth-errors';
import { ResultKind } from '../common/result-kind';
import { HttpMethod, HttpStatus } from '../common/http';
import { getOwnedVehicle } from './vehicles.server';
import { getVehiclePicture, saveVehiclePicture, removeVehiclePicture } from './pictures.server';
import { vehicleIdSchema } from './vehicle-schema';
import { VehicleErrorCode } from './vehicle-errors';
import { pictureMaxBytes } from './picture-policy';
import { applyVehicleSession, vehicleErrorStatus } from './vehicle-response.server';
import type { VehicleFailure } from './vehicle.types';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

function failure(
    code: VehicleFailure['code'],
    token: string | undefined,
    session: { expiresAt?: Date; clearSession?: boolean } = {}
): Response {
    applyVehicleSession(session, token);

    return new Response(code, { status: vehicleErrorStatus[code], headers });
}

async function readBody(request: Request): Promise<Buffer | null> {
    if (Number(request.headers.get('content-length')) > pictureMaxBytes) return null;

    const reader = request.body?.getReader();

    if (!reader) return Buffer.alloc(0);

    const chunks: Uint8Array[] = [];
    let size = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            size += value.byteLength;

            if (size > pictureMaxBytes) {
                await reader.cancel();

                return null;
            }

            chunks.push(value);
        }

        return Buffer.concat(chunks, size);
    } finally {
        reader.releaseLock();
    }
}

export async function handleVehiclePicture(request: Request, vehicleId: string): Promise<Response> {
    const token = getSessionToken();

    if (!vehicleIdSchema.safeParse({ vehicleId }).success) return failure(VehicleErrorCode.NOT_FOUND, token);

    const write = request.method !== HttpMethod.GET;

    if (write && request.headers.get('origin') !== applicationOrigin(request)) {
        return new Response(AuthErrorCode.REQUEST_FORBIDDEN, { status: HttpStatus.FORBIDDEN, headers });
    }

    try {
        if (request.method === HttpMethod.GET) {
            const outcome = await getVehiclePicture(token, vehicleId);

            if ('bytes' in outcome) {
                applyVehicleSession(outcome, token);

                return new Response(new Uint8Array(outcome.bytes), { headers: { ...headers, 'Content-Type': 'image/jpeg' } });
            }

            if (outcome.result.kind === ResultKind.ERROR) return failure(outcome.result.code, token, outcome);

            return failure(VehicleErrorCode.NOT_FOUND, token);
        }

        const access = await getOwnedVehicle(token, { vehicleId });

        if (access.result.kind === ResultKind.ERROR) return failure(access.result.code, token, access);

        applyVehicleSession(access, token);

        if (request.method === HttpMethod.DELETE) {
            const outcome = await removeVehiclePicture(token, vehicleId);

            if (outcome.result.kind === ResultKind.ERROR) return failure(outcome.result.code, token, outcome);

            applyVehicleSession(outcome, token);

            return new Response(null, { status: HttpStatus.NO_CONTENT, headers });
        }

        const body = await readBody(request);

        if (body === null) return failure(VehicleErrorCode.PICTURE_TOO_LARGE, token);

        const outcome = await saveVehiclePicture(token, vehicleId, body);

        if (outcome.result.kind === ResultKind.ERROR) return failure(outcome.result.code, token, outcome);

        applyVehicleSession(outcome, token);

        return new Response(null, { status: HttpStatus.NO_CONTENT, headers });
    } catch (error) {
        logServerError(LogOperation.VEHICLE_PICTURE_REQUEST, error);

        return failure(VehicleErrorCode.UNAVAILABLE, token);
    }
}
