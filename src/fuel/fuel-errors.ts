import { getAuthErrorKey } from '../auth/auth-errors.ts';

export const FuelErrorCode = {
    INVALID: 'FUEL_INVALID',
    NOT_FOUND: 'FUEL_NOT_FOUND',
    VEHICLE_NOT_FOUND: 'FUEL_VEHICLE_NOT_FOUND',
    TYPE_UNSUPPORTED: 'FUEL_TYPE_UNSUPPORTED',
    TIMESTAMP_CONFLICT: 'FUEL_TIMESTAMP_CONFLICT',
    ODOMETER_ORDER: 'FUEL_ODOMETER_ORDER',
    PRICE_RANGE: 'FUEL_PRICE_RANGE',
    UNAVAILABLE: 'FUEL_UNAVAILABLE'
} as const;

export type FuelErrorCode = (typeof FuelErrorCode)[keyof typeof FuelErrorCode];

export const fuelErrorKeys = {
    [FuelErrorCode.INVALID]: 'errors.invalid',
    [FuelErrorCode.NOT_FOUND]: 'errors.notFound',
    [FuelErrorCode.VEHICLE_NOT_FOUND]: 'errors.vehicleNotFound',
    [FuelErrorCode.TYPE_UNSUPPORTED]: 'errors.typeUnsupported',
    [FuelErrorCode.TIMESTAMP_CONFLICT]: 'errors.timestampConflict',
    [FuelErrorCode.ODOMETER_ORDER]: 'errors.odometerOrder',
    [FuelErrorCode.PRICE_RANGE]: 'errors.priceRange',
    [FuelErrorCode.UNAVAILABLE]: 'errors.unavailable'
} satisfies Record<FuelErrorCode, string>;

export function getFuelErrorKey(code: unknown): string {
    if (typeof code === 'string' && Object.hasOwn(fuelErrorKeys, code)) return fuelErrorKeys[code as FuelErrorCode];

    return `auth:${getAuthErrorKey(code)}`;
}
