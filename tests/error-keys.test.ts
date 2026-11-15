import { UserErrorCode, getUserErrorKey } from '../src/users/user-errors';
import { expect, test } from 'vitest';
import { AuthErrorCode } from '../src/auth/auth-errors';
import { ExpenseErrorCode, getExpenseErrorKey } from '../src/expenses/expense-errors';
import { FuelErrorCode, getFuelErrorKey } from '../src/fuel/fuel-errors';
import { StatisticsErrorCode, getStatisticsErrorKey } from '../src/statistics/statistics-errors';
import { VehicleErrorCode, getVehicleErrorKey } from '../src/vehicles/vehicle-errors';

test.each([
    { feature: 'users', lookup: getUserErrorKey, code: UserErrorCode.ADMIN_LAST_ACTIVE, key: 'errors.adminLastActive' },
    { feature: 'expenses', lookup: getExpenseErrorKey, code: ExpenseErrorCode.NOT_FOUND, key: 'errors.notFound' },
    { feature: 'fuel', lookup: getFuelErrorKey, code: FuelErrorCode.ODOMETER_ORDER, key: 'errors.odometerOrder' },
    { feature: 'statistics', lookup: getStatisticsErrorKey, code: StatisticsErrorCode.VEHICLE_NOT_FOUND, key: 'errors.vehicleNotFound' },
    { feature: 'vehicles', lookup: getVehicleErrorKey, code: VehicleErrorCode.PICTURE_TOO_LARGE, key: 'errors.pictureTooLarge' }
])('$feature resolves local errors and preserves namespaced auth/unknown fallbacks', ({ lookup, code, key }) => {
    expect(lookup(code)).toBe(key);
    expect(lookup(AuthErrorCode.AUTH_REQUIRED)).toBe('auth:errors.authRequired');
    expect(lookup(undefined)).toBe('auth:errors.unexpected');
    expect(lookup('toString')).toBe('auth:errors.unexpected');
});
