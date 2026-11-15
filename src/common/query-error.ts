import { userErrorKeys, type UserErrorCode } from '../users/user-errors';
import { AuthErrorCode, getAuthErrorKey } from '../auth/auth-errors';
import { expenseErrorKeys, type ExpenseErrorCode } from '../expenses/expense-errors';
import { fuelErrorKeys, type FuelErrorCode } from '../fuel/fuel-errors';
import { statisticsErrorKeys, type StatisticsErrorCode } from '../statistics/statistics-errors';
import { vehicleErrorKeys, type VehicleErrorCode } from '../vehicles/vehicle-errors';

export function queryErrorKey(error: unknown): string {
    const code = error instanceof Error ? error.message : undefined;

    if (typeof code !== 'string') return `auth:${getAuthErrorKey(AuthErrorCode.AUTH_UNAVAILABLE)}`;
    if (Object.hasOwn(expenseErrorKeys, code)) return `expenses:${expenseErrorKeys[code as ExpenseErrorCode]}`;
    if (Object.hasOwn(fuelErrorKeys, code)) return `fuel:${fuelErrorKeys[code as FuelErrorCode]}`;
    if (Object.hasOwn(statisticsErrorKeys, code)) return `statistics:${statisticsErrorKeys[code as StatisticsErrorCode]}`;
    if (Object.hasOwn(vehicleErrorKeys, code)) return `vehicles:${vehicleErrorKeys[code as VehicleErrorCode]}`;

    if (Object.hasOwn(userErrorKeys, code)) return `auth:${userErrorKeys[code as UserErrorCode]}`;

    const authCode = Object.values(AuthErrorCode).some((value) => value === code) ? code : AuthErrorCode.AUTH_UNAVAILABLE;

    return `auth:${getAuthErrorKey(authCode)}`;
}
