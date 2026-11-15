import { createServerFn } from '@tanstack/react-start';
import type { z } from 'zod';
import { HttpMethod } from '../common/http';
import { statisticsSchema } from './statistics-schema';
import { getOwnedStatistics } from './statistics.server';
import { validateStatisticsInput, executeStatisticsOperation } from './statistics-response.server';
import type { StatisticsResponse } from './statistics.types';

export const getStatistics = createServerFn({ method: HttpMethod.GET })
    .validator((input: z.input<typeof statisticsSchema>) => validateStatisticsInput(statisticsSchema, input))
    .handler(({ data }): Promise<StatisticsResponse> => executeStatisticsOperation(data, getOwnedStatistics));
