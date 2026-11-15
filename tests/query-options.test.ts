import { UserErrorCode } from '../src/users/user-errors';
import { beforeEach, expect, test, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { AuthErrorCode } from '../src/auth/auth-errors';
import { ResultKind } from '../src/common/result-kind';
import { listVehicles, getVehicle } from '../src/vehicles/vehicles';
import { getExpense, listExpenseCategories, listExpenses } from '../src/expenses/expenses';
import { getFuelRecord, listFuelRecords } from '../src/fuel/fuel';
import { getStatistics } from '../src/statistics/statistics';
import { listUsers } from '../src/users/users';
import { vehicleListOptions, vehicleDetailsOptions } from '../src/vehicles/vehicle-queries';
import { expenseCategoriesOptions, expenseCategoryPageOptions, expenseOptions, expenseListOptions } from '../src/expenses/expense-queries';
import { fuelVehiclesOptions, fuelRecordOptions, fuelListOptions } from '../src/fuel/fuel-queries';
import { statisticsOptions } from '../src/statistics/statistics-queries';
import { StatisticsPeriod } from '../src/statistics/statistics-values';
import { managedUsersOptions } from '../src/users/user-queries';
import { queryErrorKey } from '../src/common/query-error';
import { ExpenseErrorCode } from '../src/expenses/expense-errors';
import { VehicleErrorCode } from '../src/vehicles/vehicle-errors';

vi.mock('../src/vehicles/vehicles', () => ({ listVehicles: vi.fn(), getVehicle: vi.fn() }));
vi.mock('../src/expenses/expenses', () => ({ getExpense: vi.fn(), listExpenseCategories: vi.fn(), listExpenses: vi.fn() }));
vi.mock('../src/fuel/fuel', () => ({ getFuelRecord: vi.fn(), listFuelRecords: vi.fn() }));
vi.mock('../src/statistics/statistics', () => ({ getStatistics: vi.fn() }));
vi.mock('../src/users/users', () => ({ listUsers: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

const options = [
    { name: 'vehicle list', run: (client: QueryClient) => client.fetchQuery(vehicleListOptions('owner', 0)), rpc: listVehicles },
    { name: 'vehicle detail', run: (client: QueryClient) => client.fetchQuery(vehicleDetailsOptions('owner', 'vehicle')), rpc: getVehicle },
    {
        name: 'category page',
        run: (client: QueryClient) => client.fetchQuery(expenseCategoryPageOptions(0, 25)),
        rpc: listExpenseCategories
    },
    {
        name: 'all categories',
        run: (client: QueryClient) => client.fetchQuery(expenseCategoriesOptions('owner')),
        rpc: listExpenseCategories
    },
    { name: 'expense detail', run: (client: QueryClient) => client.fetchQuery(expenseOptions('owner', 'expense')), rpc: getExpense },
    {
        name: 'expense list',
        run: (client: QueryClient) => client.fetchQuery(expenseListOptions('owner', { vehicleId: 'vehicle', page: 0, pageSize: 25 })),
        rpc: listExpenses
    },
    { name: 'all vehicles', run: (client: QueryClient) => client.fetchQuery(fuelVehiclesOptions('owner')), rpc: listVehicles },
    { name: 'fuel detail', run: (client: QueryClient) => client.fetchQuery(fuelRecordOptions('owner', 'record')), rpc: getFuelRecord },
    {
        name: 'fuel list',
        run: (client: QueryClient) => client.fetchQuery(fuelListOptions('owner', { vehicleId: 'vehicle', page: 0, pageSize: 25 })),
        rpc: listFuelRecords
    },
    {
        name: 'statistics',
        run: (client: QueryClient) => client.fetchQuery(statisticsOptions('owner', { vehicleId: 'vehicle', period: StatisticsPeriod.ALL })),
        rpc: getStatistics
    },
    { name: 'users', run: (client: QueryClient) => client.fetchQuery(managedUsersOptions(0, 25)), rpc: listUsers }
];

test.each(options)('$name forwards cancellation and caches failures as errors', async ({ run, rpc }) => {
    const client = new QueryClient();
    vi.mocked(rpc).mockResolvedValue({ kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED });

    // Invoke through QueryClient so both the query state and its signal are exercised.
    await expect(run(client)).rejects.toThrow(AuthErrorCode.AUTH_REQUIRED);
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(client.getQueryCache().getAll()[0].state.status).toBe('error');
    expect(client.getQueryCache().getAll()[0].state.data).toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
    client.clear();
});

test('category pagination stops at an empty page even with a stale total', async () => {
    const client = new QueryClient();
    vi.mocked(listExpenseCategories).mockResolvedValueOnce({
        kind: ResultKind.EXPENSE_CATEGORIES,
        categories: [],
        total: 5,
        page: 0,
        pageSize: 100
    });

    await expect(client.fetchQuery(expenseCategoriesOptions('owner'))).resolves.toEqual([]);
    expect(listExpenseCategories).toHaveBeenCalledTimes(1);
    client.clear();
});

test('query errors map known codes to localized messages without exposing unexpected error text', () => {
    expect(queryErrorKey(new Error(UserErrorCode.ACCOUNT_UNAVAILABLE))).toBe('auth:errors.accountUnavailable');
    expect(queryErrorKey(new Error(ExpenseErrorCode.NOT_FOUND))).toBe('expenses:errors.notFound');
    expect(queryErrorKey(new Error(VehicleErrorCode.NOT_FOUND))).toBe('vehicles:errors.notFound');
    expect(queryErrorKey(new Error('Synthetic internal detail'))).toBe('auth:errors.authUnavailable');
});
