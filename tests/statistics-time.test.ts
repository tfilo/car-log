import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { statisticsSchema } from '../src/statistics/statistics-schema';
import { statisticsRange, statisticsBucket, bucketDays } from '../src/statistics/statistics-time';
import { statisticsFormInput, statisticsFormSchema } from '../src/statistics/statistics-form-schema';
import { StatisticsPeriod, StatisticsBucketUnit, statisticsPointLimit } from '../src/statistics/statistics-values';

const vehicleId = randomUUID();

test('preset boundaries use the Bratislava month/year even across UTC midnight', () => {
    const now = new Date('2026-12-31T23:30:00Z');
    const range = (period: StatisticsPeriod) => statisticsRange(statisticsSchema.parse({ vehicleId, period }), now);

    expect(range(StatisticsPeriod.ALL)).toEqual({ from: null, until: null, fromDay: null, toDay: null });
    expect(range(StatisticsPeriod.THIS_MONTH)).toMatchObject({
        fromDay: '2027-01-01',
        toDay: '2027-01-31',
        from: '2026-12-31T23:00:00.000Z',
        until: '2027-01-31T23:00:00.000Z'
    });
    expect(range(StatisticsPeriod.LAST_MONTH)).toMatchObject({ fromDay: '2026-12-01', toDay: '2026-12-31' });
    expect(range(StatisticsPeriod.THIS_YEAR)).toMatchObject({ fromDay: '2027-01-01', toDay: '2027-12-31' });
    expect(range(StatisticsPeriod.LAST_YEAR)).toMatchObject({ fromDay: '2026-01-01', toDay: '2026-12-31' });
});

test.each([
    ['2026-03-29', '2026-03-28T23:00:00.000Z', '2026-03-29T22:00:00.000Z', 23],
    ['2026-10-25', '2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z', 25]
])('inclusive custom day %s respects daylight saving', (day, from, until, hours) => {
    const range = statisticsRange(statisticsSchema.parse({ vehicleId, period: StatisticsPeriod.CUSTOM, from: day, to: day }));

    expect(range).toMatchObject({ from, until, fromDay: day, toDay: day });
    expect((Date.parse(range.until!) - Date.parse(range.from!)) / 3_600_000).toBe(Number(hours));
});

test('custom dates are bounded, ordered and required; other presets reject hidden date parameters', () => {
    const custom = { vehicleId, period: StatisticsPeriod.CUSTOM };

    expect(statisticsSchema.safeParse(custom).success).toBe(false);
    expect(statisticsSchema.safeParse({ ...custom, from: '2026-02-30', to: '2026-03-01' }).success).toBe(false);
    expect(statisticsSchema.safeParse({ ...custom, from: '2026-04-02', to: '2026-04-01' }).success).toBe(false);
    expect(statisticsSchema.safeParse({ ...custom, from: '1899-01-01', to: '2026-01-01' }).success).toBe(false);
    expect(statisticsSchema.safeParse({ ...custom, from: '2026-01-01', to: '2101-01-01' }).success).toBe(false);
    expect(statisticsSchema.safeParse({ ...custom, from: '2024-02-29', to: '2024-02-29' }).success).toBe(true);
    expect(statisticsSchema.safeParse({ vehicleId, period: StatisticsPeriod.ALL, from: '2026-01-01' }).success).toBe(false);
    expect(statisticsSchema.safeParse({ vehicleId, userId: randomUUID() }).success).toBe(false);
    expect(statisticsSchema.safeParse({ ...custom, from: ' '.repeat(100_000), to: '2026-01-01' }).error?.issues).toMatchObject([
        { code: 'too_big', path: ['from'] }
    ]);
});

test('GUI ignores retained custom dates when a preset is chosen and validates custom inputs', () => {
    const form = { vehicleId, period: StatisticsPeriod.THIS_MONTH, from: '', to: '' };

    expect(statisticsFormSchema.safeParse(form).success).toBe(true);
    expect(statisticsFormInput(form)).toEqual({ vehicleId, period: StatisticsPeriod.THIS_MONTH });
    expect(statisticsFormSchema.safeParse({ ...form, period: StatisticsPeriod.CUSTOM }).success).toBe(false);
});

test('costs use calendar months; prices/consumption use days for short ranges and bounded larger groups for long histories', () => {
    expect(statisticsBucket('2026-01-01', '2026-01-31')).toEqual({ unit: StatisticsBucketUnit.DAY, step: 1 });
    expect(statisticsBucket('2026-01-01', '2026-01-31', true)).toEqual({ unit: StatisticsBucketUnit.MONTH, step: 1 });
    expect(bucketDays('2026-01-15', '2026-03-02', statisticsBucket('2026-01-15', '2026-03-02', true))).toEqual([
        '2026-01-01',
        '2026-02-01',
        '2026-03-01'
    ]);

    const long = statisticsBucket('0001-01-01', '9999-12-31', true);
    const days = bucketDays('0001-01-01', '9999-12-31', long);

    expect(long.unit).toBe(StatisticsBucketUnit.YEAR);
    expect(days.length).toBeLessThanOrEqual(statisticsPointLimit);
    expect(days[0]).toBe('0001-01-01');
    expect(days.at(-1)).toBe('9997-01-01');
});
