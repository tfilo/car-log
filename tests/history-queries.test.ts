import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { getRouter } from '../src/router';
import { AuthErrorCode } from '../src/auth/auth-errors';
import { ResultKind } from '../src/common/result-kind';
import { FuelType } from '../src/generated/prisma/enums';
import { listFuelRecords } from '../src/fuel/fuel';
import { fuelListOptions } from '../src/fuel/fuel-queries';
import { FuelErrorCode } from '../src/fuel/fuel-errors';
import type { FuelListResponse } from '../src/fuel/fuel.types';
import { listExpenses } from '../src/expenses/expenses';
import { expenseListOptions } from '../src/expenses/expense-queries';
import { ExpenseErrorCode } from '../src/expenses/expense-errors';
import type { ExpenseListResponse } from '../src/expenses/expense.types';

vi.mock('../src/routeTree.gen', async () => {
    const { createRootRoute } = await import('@tanstack/react-router');

    return { routeTree: createRootRoute() };
});

vi.mock('../src/vehicles/vehicles', () => ({ listVehicles: vi.fn() }));
vi.mock('../src/fuel/fuel', () => ({ getFuelRecord: vi.fn(), listFuelRecords: vi.fn() }));
vi.mock('../src/expenses/expenses', () => ({ getExpense: vi.fn(), listExpenseCategories: vi.fn(), listExpenses: vi.fn() }));

let client: QueryClient;

beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    client = getRouter().options.context.queryClient;
});

afterEach(() => {
    client.clear();
    vi.useRealTimers();
});

test('fuel history retries a failed RPC immediately and caches only the recovered page', async () => {
    const input = { vehicleId: '00000000-0000-4000-8000-000000000001', fuelType: FuelType.PETROL, page: 0, pageSize: 25 };
    const options = fuelListOptions('synthetic-user', input);
    const success = { kind: ResultKind.FUEL_RECORDS, records: [], page: 0, pageSize: 25, total: 0 } satisfies FuelListResponse;

    vi.mocked(listFuelRecords)
        .mockResolvedValueOnce({ kind: ResultKind.ERROR, code: FuelErrorCode.UNAVAILABLE })
        .mockResolvedValue(success);

    await expect(client.query(options)).rejects.toThrow(FuelErrorCode.UNAVAILABLE);
    expect(client.getQueryState(options.queryKey)?.status).toBe('error');
    expect(client.getQueryData(options.queryKey)).toBeUndefined();

    expect(await client.query(options)).toEqual(success);
    expect(await client.query(options)).toEqual(success);
    expect(listFuelRecords).toHaveBeenCalledTimes(2);
    expect(listFuelRecords).toHaveBeenLastCalledWith({ data: input, signal: expect.any(AbortSignal) });
});

test('expense history retries a failed RPC immediately and caches only the recovered page', async () => {
    const input = {
        vehicleId: '00000000-0000-4000-8000-000000000001',
        categoryId: '00000000-0000-4000-8000-000000000002',
        page: 0,
        pageSize: 25
    };
    const options = expenseListOptions('synthetic-user', input);
    const success = { kind: ResultKind.EXPENSES, expenses: [], page: 0, pageSize: 25, total: 0 } satisfies ExpenseListResponse;

    vi.mocked(listExpenses)
        .mockResolvedValueOnce({ kind: ResultKind.ERROR, code: ExpenseErrorCode.UNAVAILABLE })
        .mockResolvedValue(success);

    await expect(client.query(options)).rejects.toThrow(ExpenseErrorCode.UNAVAILABLE);
    expect(client.getQueryState(options.queryKey)?.status).toBe('error');
    expect(client.getQueryData(options.queryKey)).toBeUndefined();

    expect(await client.query(options)).toEqual(success);
    expect(await client.query(options)).toEqual(success);
    expect(listExpenses).toHaveBeenCalledTimes(2);
    expect(listExpenses).toHaveBeenLastCalledWith({ data: input, signal: expect.any(AbortSignal) });
});

test('fuel history preserves authentication failures as errors without caching them as data', async () => {
    const options = fuelListOptions('synthetic-user', { vehicleId: '00000000-0000-4000-8000-000000000001', page: 0, pageSize: 25 });

    vi.mocked(listFuelRecords).mockResolvedValue({ kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED });

    await expect(client.query(options)).rejects.toThrow(AuthErrorCode.AUTH_REQUIRED);
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
    expect(listFuelRecords).toHaveBeenCalledOnce();
});

test('expense history preserves authentication failures as errors without caching them as data', async () => {
    const options = expenseListOptions('synthetic-user', { vehicleId: '00000000-0000-4000-8000-000000000001', page: 0, pageSize: 25 });

    vi.mocked(listExpenses).mockResolvedValue({ kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED });

    await expect(client.query(options)).rejects.toThrow(AuthErrorCode.AUTH_REQUIRED);
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
    expect(listExpenses).toHaveBeenCalledOnce();
});
