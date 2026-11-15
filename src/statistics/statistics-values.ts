export const StatisticsPeriod = {
    ALL: 'all',
    THIS_MONTH: 'thisMonth',
    LAST_MONTH: 'lastMonth',
    THIS_YEAR: 'thisYear',
    LAST_YEAR: 'lastYear',
    CUSTOM: 'custom'
} as const;

export type StatisticsPeriod = (typeof StatisticsPeriod)[keyof typeof StatisticsPeriod];

export const StatisticsBucketUnit = { DAY: 'day', MONTH: 'month', YEAR: 'year' } as const;

export type StatisticsBucketUnit = (typeof StatisticsBucketUnit)[keyof typeof StatisticsBucketUnit];

export const statisticsPointLimit = 120;
