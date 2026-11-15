import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { AuthErrorCode, getAuthErrorKey } from '../auth/auth-errors';
import { ResultKind } from '../common/result-kind';
import { getCurrentUser } from '../auth/auth';
import type { SessionUser } from '../auth/session.server';

export const currentUserKey = ['currentUser'] as const;

export const currentUserOptions = queryOptions({
    queryKey: currentUserKey,
    queryFn: async ({ signal }): Promise<SessionUser | null> => {
        const result = await getCurrentUser({ signal });

        if (result.kind === ResultKind.AUTHENTICATED) return result.user;
        if (result.kind === ResultKind.ANONYMOUS) return null;

        throw new Error(result.code);
    },
    staleTime: 0,
    retry: false,
    refetchInterval: 60_000
});

// Remove data from the previous account without detaching current-user observers.
export async function replaceCurrentUser(queryClient: QueryClient, user: SessionUser | null): Promise<void> {
    await queryClient.cancelQueries();
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== currentUserKey[0] });
    queryClient.setQueryData(currentUserKey, user);
}

export function transportErrorKey(error: unknown): string {
    return getAuthErrorKey(error instanceof Error ? error.message : AuthErrorCode.AUTH_UNAVAILABLE);
}

export function responseErrorKeys(result: {
    code: AuthErrorCode;
    fields?: Partial<Record<string, string[]>>;
    formErrors?: string[];
}): string[] {
    const validation = [...Object.values(result.fields ?? {}).flatMap((errors) => errors ?? []), ...(result.formErrors ?? [])];

    return validation.length ? [...new Set(validation)] : [getAuthErrorKey(result.code)];
}
