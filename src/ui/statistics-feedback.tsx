import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AuthErrorCode } from '../auth/auth-errors';
import { getStatisticsErrorKey } from '../statistics/statistics-errors';
import type { StatisticsFailure, StatisticsValidationFailure, StatisticsResult } from '../statistics/statistics.types';
import { replaceCurrentUser } from './session';

export function statisticsErrors(result: StatisticsFailure | StatisticsValidationFailure): string[] {
    if ('fields' in result) {
        const messages = [...Object.values(result.fields).flatMap((value) => value ?? []), ...result.formErrors];

        if (messages.length) return [...new Set(messages)];
    }

    return [getStatisticsErrorKey(result.code)];
}

export function useStatisticsAccess(result: StatisticsResult | StatisticsValidationFailure): void {
    const queryClient = useQueryClient();

    useEffect(() => {
        if ('code' in result && result.code === AuthErrorCode.AUTH_REQUIRED) void replaceCurrentUser(queryClient, null);
    }, [result, queryClient]);
}
