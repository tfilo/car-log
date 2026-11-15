import { ResultKind } from '../common/result-kind';
import { queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import { getStatistics } from './statistics';
import type { statisticsSchema } from './statistics-schema';

export const statisticsKeys = {
    all: ['statistics'] as const,
    report: (userId: string, input: z.input<typeof statisticsSchema>) => ['statistics', userId, input] as const
};

export function statisticsOptions(userId: string, input: z.input<typeof statisticsSchema>) {
    return queryOptions({
        queryKey: statisticsKeys.report(userId, input),
        queryFn: async ({ signal }) => {
            const result = await getStatistics({ data: input, signal });

            if (result.kind !== ResultKind.STATISTICS) throw new Error(result.code);

            return result;
        },
        retry: false
    });
}
