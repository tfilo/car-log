import { StatisticsBucketUnit } from './statistics-values';
import type { StatisticsBucket } from './statistics-time';

export function displayStatisticsDay(day: string): string {
    return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;
}

export function displayStatisticsBucket(day: string, bucket: StatisticsBucket): string {
    if (bucket.unit === StatisticsBucketUnit.DAY) return `${day.slice(8, 10)}.${day.slice(5, 7)}.`;
    if (bucket.unit === StatisticsBucketUnit.MONTH) return `${day.slice(5, 7)}.${day.slice(0, 4)}`;

    const year = Number(day.slice(0, 4));

    return bucket.step === 1 ? String(year) : `${year}–${year + bucket.step - 1}`;
}
