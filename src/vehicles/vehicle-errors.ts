import { getAuthErrorKey } from '../auth/auth-errors.ts';

export const VehicleErrorCode = {
    FUEL_IN_USE: 'VEHICLE_FUEL_IN_USE',
    INVALID: 'VEHICLE_INVALID',
    NOT_FOUND: 'VEHICLE_NOT_FOUND',
    UNAVAILABLE: 'VEHICLE_UNAVAILABLE',
    PICTURE_INVALID: 'VEHICLE_PICTURE_INVALID',
    PICTURE_TOO_LARGE: 'VEHICLE_PICTURE_TOO_LARGE'
} as const;

export type VehicleErrorCode = (typeof VehicleErrorCode)[keyof typeof VehicleErrorCode];

export const vehicleErrorKeys = {
    [VehicleErrorCode.FUEL_IN_USE]: 'errors.fuelInUse',
    [VehicleErrorCode.INVALID]: 'errors.invalid',
    [VehicleErrorCode.NOT_FOUND]: 'errors.notFound',
    [VehicleErrorCode.UNAVAILABLE]: 'errors.unavailable',
    [VehicleErrorCode.PICTURE_INVALID]: 'errors.pictureInvalid',
    [VehicleErrorCode.PICTURE_TOO_LARGE]: 'errors.pictureTooLarge'
} satisfies Record<VehicleErrorCode, string>;

export function getVehicleErrorKey(code: unknown): string {
    if (typeof code === 'string' && Object.hasOwn(vehicleErrorKeys, code)) return vehicleErrorKeys[code as VehicleErrorCode];

    return `auth:${getAuthErrorKey(code)}`;
}
