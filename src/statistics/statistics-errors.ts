import { getAuthErrorKey } from '../auth/auth-errors.ts';

export const StatisticsErrorCode = {
    INVALID: 'STATISTICS_INVALID',
    VEHICLE_NOT_FOUND: 'STATISTICS_VEHICLE_NOT_FOUND',
    UNAVAILABLE: 'STATISTICS_UNAVAILABLE'
} as const;

export type StatisticsErrorCode = (typeof StatisticsErrorCode)[keyof typeof StatisticsErrorCode];

export const statisticsErrorKeys = {
    [StatisticsErrorCode.INVALID]: 'errors.invalid',
    [StatisticsErrorCode.VEHICLE_NOT_FOUND]: 'errors.vehicleNotFound',
    [StatisticsErrorCode.UNAVAILABLE]: 'errors.unavailable'
} satisfies Record<StatisticsErrorCode, string>;

export function getStatisticsErrorKey(code: unknown): string {
    if (typeof code === 'string' && Object.hasOwn(statisticsErrorKeys, code)) return statisticsErrorKeys[code as StatisticsErrorCode];

    return `auth:${getAuthErrorKey(code)}`;
}
