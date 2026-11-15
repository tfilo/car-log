import type { UserListResult } from './user.types';
import { ResultKind } from '../common/result-kind';
import { queryOptions, type UseQueryOptions } from '@tanstack/react-query';
import { listUsers } from './users';

export const userKeys = {
    all: ['managedUsers'] as const,
    list: (page: number, pageSize: number) => [...userKeys.all, page, pageSize] as const
};

type UserListQueryResult = Extract<UserListResult, { kind: typeof ResultKind.USERS }>;

export function managedUsersOptions(page: number, pageSize: number): UseQueryOptions<UserListQueryResult> {
    return queryOptions<UserListQueryResult>({
        queryKey: userKeys.list(page, pageSize),
        queryFn: async ({ signal }) => {
            const result = await listUsers({ data: { page, pageSize }, signal });

            if (result.kind !== ResultKind.USERS) throw new Error(result.code);

            return result;
        },
        retry: false
    });
}
