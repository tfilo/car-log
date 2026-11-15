import { AuthErrorCode } from './auth/auth-errors';
import { currentUserKey, replaceCurrentUser } from './ui/session';
import { createRouter } from '@tanstack/react-router';
import { QueryClient, QueryCache } from '@tanstack/react-query';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import { routeTree } from './routeTree.gen';

export function getRouter() {
    const queryClient = new QueryClient({
        queryCache: new QueryCache({
            onError: (error) => {
                if (error.message === AuthErrorCode.AUTH_REQUIRED) void replaceCurrentUser(queryClient, null);
                else if (error.message === AuthErrorCode.ADMIN_REQUIRED) void queryClient.invalidateQueries({ queryKey: currentUserKey });
            }
        }),
        defaultOptions: {
            queries: { staleTime: 30_000 }
        }
    });

    const router = createRouter({
        routeTree,
        context: { queryClient },
        scrollRestoration: true,
        defaultPreload: 'intent',
        defaultPreloadStaleTime: 0
    });

    setupRouterSsrQueryIntegration({
        router,
        queryClient
    });

    return router;
}
