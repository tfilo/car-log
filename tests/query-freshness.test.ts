import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { QueryObserver, type QueryClient } from '@tanstack/react-query';
import { getRouter } from '../src/router';
import { currentUserOptions } from '../src/ui/session';

// Exercise the real QueryClient configuration without importing page components.
vi.mock('../src/routeTree.gen', async () => {
    const { createRootRoute } = await import('@tanstack/react-router');

    return { routeTree: createRootRoute() };
});

let client: QueryClient;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
    client = getRouter().options.context.queryClient;
});

afterEach(() => {
    client.clear();
    vi.useRealTimers();
});

test('loader data is reused on mount and navigation during the freshness window', async () => {
    const queryFn = vi.fn(async () => 'vehicle');
    const options = { queryKey: ['vehicles', 'synthetic-user'], queryFn };

    await client.query(options);
    const observer = new QueryObserver(client, options);
    const unsubscribe = observer.subscribe(() => {});

    try {
        await vi.advanceTimersByTimeAsync(29_000);
        expect(await client.query(options)).toBe('vehicle');
        expect(queryFn).toHaveBeenCalledOnce();
    } finally {
        unsubscribe();
    }
});

test('navigation refreshes expired data and the next mount reuses it', async () => {
    const queryFn = vi.fn(async () => 'statistics');
    const options = { queryKey: ['statistics', 'synthetic-user'], queryFn };

    await client.query(options);
    await vi.advanceTimersByTimeAsync(30_001);
    await client.query(options);
    const unsubscribe = new QueryObserver(client, options).subscribe(() => {});

    try {
        expect(queryFn).toHaveBeenCalledTimes(2);
    } finally {
        unsubscribe();
    }
});

test('mutation invalidation refreshes inactive cached data before the freshness window ends', async () => {
    let model = 'Before save';
    const queryFn = vi.fn(async () => model);
    const options = { queryKey: ['vehicles', 'synthetic-user'], queryFn };

    expect(await client.query(options)).toBe('Before save');
    model = 'After save';
    await client.invalidateQueries({ queryKey: ['vehicles'] });

    expect(await client.query(options)).toBe('After save');
    expect(queryFn).toHaveBeenCalledTimes(2);
});

test('session checks keep their own freshness and renewal policy', () => {
    expect(client.defaultQueryOptions(currentUserOptions)).toMatchObject({
        staleTime: 0,
        refetchInterval: 60_000,
        retry: false
    });
});
