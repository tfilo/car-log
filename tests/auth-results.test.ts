import { UserErrorCode } from '../src/users/user-errors';
import type { getStatistics } from '../src/statistics/statistics';
import type { getOwnedStatistics } from '../src/statistics/statistics.server';
import type { StatisticsErrorCode } from '../src/statistics/statistics-errors';
import type { StatisticsResult } from '../src/statistics/statistics.types';
import type * as expenseRpc from '../src/expenses/expenses';
import type { ExpenseErrorCode } from '../src/expenses/expense-errors';
import type { ExpenseSaveResult, CategorySaveResult } from '../src/expenses/expense.types';
import type { createOwnedExpense } from '../src/expenses/expenses.server';
import type { createOwnedCategory } from '../src/expenses/categories.server';
import type { FuelErrorCode } from '../src/fuel/fuel-errors';
import type { createFuelRecord, updateFuelRecord, getFuelRecord, listFuelRecords, deleteFuelRecord } from '../src/fuel/fuel';
import type { createOwnedFuelRecord } from '../src/fuel/fuel.server';
import type { FuelSaveResult, FuelFailure } from '../src/fuel/fuel.types';
import { ResultKind } from '../src/common/result-kind';
import { expectTypeOf, test } from 'vitest';
import type { AuthErrorCode } from '../src/auth/auth-errors';
import type { AuthFailure, ProfileResult, SessionOutcome } from '../src/auth/auth.types';
import type { UserListResult, ManageUserResult, DeleteAccountResult } from '../src/users/user.types';
import type { listManagedUsers, manageUserAccount, deleteOwnUserAccount } from '../src/users/users.server';
import type { applyUserResponse } from '../src/users/user-response.server';
import type { updateUserProfile } from '../src/auth/profile.server';
import type {
    register,
    login,
    getCurrentUser,
    logout,
    updateMyProfile,
    confirmEmail,
    requestEmailVerification,
    requestPasswordReset,
    resetPassword
} from '../src/auth/auth';
import type { listUsers, manageUser, deleteMyAccount } from '../src/users/users';
import type { VehicleErrorCode } from '../src/vehicles/vehicle-errors';
import type { VehicleListResult, VehicleSaveResult, VehicleFailure } from '../src/vehicles/vehicle.types';
import type { listVehicles, getVehicle, createVehicle, updateVehicle, deleteVehicle } from '../src/vehicles/vehicles';
import type { listOwnedVehicles, createOwnedVehicle } from '../src/vehicles/vehicles.server';

type ErrorCodes<Result> = Result extends { code: infer Code } ? Code : never;

type RpcResults = Awaited<
    ReturnType<
        | typeof register
        | typeof login
        | typeof getCurrentUser
        | typeof logout
        | typeof updateMyProfile
        | typeof confirmEmail
        | typeof requestEmailVerification
        | typeof requestPasswordReset
        | typeof resetPassword
        | typeof listUsers
        | typeof manageUser
        | typeof deleteMyAccount
    >
>;

test('account RPC error codes belong to their feature registries', () => {
    expectTypeOf<Exclude<ErrorCodes<RpcResults>, AuthErrorCode | UserErrorCode>>().toEqualTypeOf<never>();
    expectTypeOf<AuthFailure['code']>().toEqualTypeOf<AuthErrorCode>();
    expectTypeOf<Extract<UserErrorCode, AuthErrorCode>>().toEqualTypeOf<never>();
});

test('service outcomes use the declared discriminated result contracts', () => {
    expectTypeOf<Awaited<ReturnType<typeof listManagedUsers>>['result']>().toEqualTypeOf<UserListResult>();
    expectTypeOf<Awaited<ReturnType<typeof manageUserAccount>>['result']>().toEqualTypeOf<ManageUserResult>();
    expectTypeOf<Awaited<ReturnType<typeof deleteOwnUserAccount>>['result']>().toEqualTypeOf<DeleteAccountResult>();
    expectTypeOf<Awaited<ReturnType<typeof updateUserProfile>>['result']>().toEqualTypeOf<ProfileResult>();
});

test('literal assertions cannot bypass error-code and response-helper contracts', () => {
    const misspelled = { kind: ResultKind.ERROR, code: 'AUTH_REQUIERD' } as const;

    expectTypeOf(misspelled.code).toEqualTypeOf<'AUTH_REQUIERD'>();
    expectTypeOf<typeof misspelled extends AuthFailure ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<SessionOutcome<typeof misspelled> extends Parameters<typeof applyUserResponse>[0] ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<{ kind: typeof ResultKind.UPDATED } extends ManageUserResult ? true : false>().toEqualTypeOf<false>();
});

test('self-deletion exposes only the administrator-specific last-admin error', () => {
    type SelfDeletionCodes = ErrorCodes<Awaited<ReturnType<typeof deleteMyAccount>>>;

    expectTypeOf<Extract<SelfDeletionCodes, `ADMIN_${string}`>>().toEqualTypeOf<typeof UserErrorCode.ADMIN_LAST_ACTIVE>();
});

test('vehicle RPCs and services retain typed error codes and named results', () => {
    type VehicleRpcResults = Awaited<
        ReturnType<typeof listVehicles | typeof getVehicle | typeof createVehicle | typeof updateVehicle | typeof deleteVehicle>
    >;

    expectTypeOf<Exclude<ErrorCodes<VehicleRpcResults>, VehicleErrorCode | typeof AuthErrorCode.AUTH_REQUIRED>>().toEqualTypeOf<never>();
    expectTypeOf<Awaited<ReturnType<typeof listOwnedVehicles>>['result']>().toEqualTypeOf<VehicleListResult>();
    expectTypeOf<Awaited<ReturnType<typeof createOwnedVehicle>>['result']>().toEqualTypeOf<VehicleSaveResult>();
    expectTypeOf<
        { kind: typeof ResultKind.ERROR; code: 'VEHICLE_NOT_FOND' } extends VehicleFailure ? true : false
    >().toEqualTypeOf<false>();
});

test('fuel RPCs keep error registries and named service results', () => {
    type FuelRpcResults = Awaited<
        ReturnType<
            typeof createFuelRecord | typeof updateFuelRecord | typeof getFuelRecord | typeof listFuelRecords | typeof deleteFuelRecord
        >
    >;

    expectTypeOf<Exclude<ErrorCodes<FuelRpcResults>, FuelErrorCode | typeof AuthErrorCode.AUTH_REQUIRED>>().toEqualTypeOf<never>();
    expectTypeOf<Awaited<ReturnType<typeof createOwnedFuelRecord>>['result']>().toEqualTypeOf<FuelSaveResult>();
    expectTypeOf<{ kind: typeof ResultKind.ERROR; code: 'FUEL_NOT_FOND' } extends FuelFailure ? true : false>().toEqualTypeOf<false>();
});

test('expense RPCs and category services keep bounded error registries and named results', () => {
    type ExpenseRpcResults = Awaited<
        ReturnType<
            | typeof expenseRpc.createExpense
            | typeof expenseRpc.listExpenses
            | typeof expenseRpc.getExpense
            | typeof expenseRpc.updateExpense
            | typeof expenseRpc.deleteExpense
            | typeof expenseRpc.listExpenseCategories
            | typeof expenseRpc.createExpenseCategory
            | typeof expenseRpc.updateExpenseCategory
            | typeof expenseRpc.deleteExpenseCategory
        >
    >;

    expectTypeOf<Exclude<ErrorCodes<ExpenseRpcResults>, ExpenseErrorCode | typeof AuthErrorCode.AUTH_REQUIRED>>().toEqualTypeOf<never>();
    expectTypeOf<Awaited<ReturnType<typeof createOwnedExpense>>['result']>().toEqualTypeOf<ExpenseSaveResult>();
    expectTypeOf<Awaited<ReturnType<typeof createOwnedCategory>>['result']>().toEqualTypeOf<CategorySaveResult>();
});

test('statistics RPC and service preserve named results and typed error codes', () => {
    type ReportResponse = Awaited<ReturnType<typeof getStatistics>>;

    expectTypeOf<Exclude<ErrorCodes<ReportResponse>, StatisticsErrorCode | typeof AuthErrorCode.AUTH_REQUIRED>>().toEqualTypeOf<never>();
    expectTypeOf<Awaited<ReturnType<typeof getOwnedStatistics>>['result']>().toEqualTypeOf<StatisticsResult>();
});
