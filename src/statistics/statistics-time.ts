import type { z } from 'zod';
import { localFuelTime, resolveFuelTime } from '../fuel/fuel-time';
import type { statisticsSchema } from './statistics-schema';
import { StatisticsPeriod, StatisticsBucketUnit, statisticsPointLimit } from './statistics-values';

export type StatisticsRange = { from: string | null; until: string | null; fromDay: string | null; toDay: string | null };

export type StatisticsBucket = { unit: StatisticsBucketUnit; step: number };

function calendarDay(year: number, month: number, day = 1): string {
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);

    return date.toISOString().slice(0, 10);
}

export function nextCalendarDay(day: string): string {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);

    return date.toISOString().slice(0, 10);
}

function midnight(day: string): string {
    const result = resolveFuelTime(`${day}T00:00:00`, '');

    if (!result) throw new Error('Unable to resolve report calendar boundary.');

    return result;
}

export function statisticsRange(input: z.output<typeof statisticsSchema>, now = new Date()): StatisticsRange {
    if (input.period === StatisticsPeriod.ALL) return { from: null, until: null, fromDay: null, toDay: null };

    const local = localFuelTime(now.toISOString());
    const year = Number(local.slice(0, 4));
    const month = Number(local.slice(5, 7));
    let fromDay: string;
    let untilDay: string;

    switch (input.period) {
        case StatisticsPeriod.THIS_MONTH:
            fromDay = calendarDay(year, month);
            untilDay = calendarDay(year, month + 1);
            break;
        case StatisticsPeriod.LAST_MONTH:
            fromDay = calendarDay(year, month - 1);
            untilDay = calendarDay(year, month);
            break;
        case StatisticsPeriod.THIS_YEAR:
            fromDay = calendarDay(year, 1);
            untilDay = calendarDay(year + 1, 1);
            break;
        case StatisticsPeriod.LAST_YEAR:
            fromDay = calendarDay(year - 1, 1);
            untilDay = calendarDay(year, 1);
            break;
        case StatisticsPeriod.CUSTOM:
            // The shared schema guarantees both days and their ordering.
            fromDay = input.from!;
            untilDay = nextCalendarDay(input.to!);
            break;
    }

    const lastDay = new Date(`${untilDay}T00:00:00Z`);
    lastDay.setUTCDate(lastDay.getUTCDate() - 1);

    return { from: midnight(fromDay), until: midnight(untilDay), fromDay, toDay: lastDay.toISOString().slice(0, 10) };
}

export function statisticsBucket(fromDay: string, toDay: string, monthly = false): StatisticsBucket {
    const days = Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000) + 1;

    if (!monthly && days <= statisticsPointLimit) return { unit: StatisticsBucketUnit.DAY, step: 1 };

    const firstYear = Number(fromDay.slice(0, 4));
    const lastYear = Number(toDay.slice(0, 4));
    const months = (lastYear - firstYear) * 12 + Number(toDay.slice(5, 7)) - Number(fromDay.slice(5, 7)) + 1;

    if (months <= statisticsPointLimit) return { unit: StatisticsBucketUnit.MONTH, step: 1 };

    // Aligned year groups keep even unusually long histories bounded.
    let step = Math.ceil((lastYear - firstYear + 1) / statisticsPointLimit);
    while (Math.floor((lastYear - 1) / step) - Math.floor((firstYear - 1) / step) + 1 > statisticsPointLimit) step++;

    return { unit: StatisticsBucketUnit.YEAR, step };
}

export function bucketDay(day: string, bucket: StatisticsBucket): string {
    if (bucket.unit === StatisticsBucketUnit.DAY) return day;
    if (bucket.unit === StatisticsBucketUnit.MONTH) return day.slice(0, 7) + '-01';

    const year = Math.floor((Number(day.slice(0, 4)) - 1) / bucket.step) * bucket.step + 1;

    return `${String(year).padStart(4, '0')}-01-01`;
}

export function bucketDays(from: string, to: string, bucket: StatisticsBucket): string[] {
    const days: string[] = [];
    const last = bucketDay(to, bucket);
    let current = bucketDay(from, bucket);

    while (current <= last && days.length < statisticsPointLimit) {
        days.push(current);
        if (current === last) break;
        const year = Number(current.slice(0, 4));
        const month = Number(current.slice(5, 7));

        if (bucket.unit === StatisticsBucketUnit.DAY) current = nextCalendarDay(current);
        else if (bucket.unit === StatisticsBucketUnit.MONTH) current = calendarDay(year, month + 1);
        else current = calendarDay(year + bucket.step, 1);
    }

    return days;
}
