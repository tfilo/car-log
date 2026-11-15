import { describe, expect, it } from 'vitest';
import { addCalendarMonths, serviceSchedule, ServiceStatus, type ServiceBaseline } from '../src/service/service-schedule';
import { categorySchema } from '../src/expenses/expense-schema';

const baseline: ServiceBaseline = {
    categoryId: 'synthetic',
    name: 'Synthetic oil',
    serviceIntervalKm: 10000,
    serviceIntervalMonths: null,
    lastOdometer: 80000,
    lastOccurredAt: '2026-01-31T11:00:00Z'
};

describe('service schedules', () => {
    it('handles month ends, leap years and calendar years', () => {
        expect(addCalendarMonths('2024-01-31', 1)).toBe('2024-02-29');
        expect(addCalendarMonths('2024-02-29', 12)).toBe('2025-02-28');
        expect(addCalendarMonths('2026-12-31', 2)).toBe('2027-02-28');
    });

    it('warns at 95 percent and becomes due at the exact kilometre limit', () => {
        expect(serviceSchedule(baseline, 89499.999, '2026-01-31', '2026-02-01').status).toBe(ServiceStatus.UPCOMING);
        expect(serviceSchedule(baseline, 89500, '2026-01-31', '2026-02-01').status).toBe(ServiceStatus.WARNING);
        expect(serviceSchedule(baseline, 90000, '2026-01-31', '2026-02-01').status).toBe(ServiceStatus.DUE);
        expect(serviceSchedule(baseline, 90001, '2026-01-31', '2026-02-01').remainingKm).toBe(-1);
    });

    it('supports time only and lets either limit win', () => {
        const timeOnly = { ...baseline, serviceIntervalKm: null, serviceIntervalMonths: 1 };
        expect(serviceSchedule(timeOnly, null, '2026-01-31', '2026-02-26').status).toBe(ServiceStatus.UPCOMING);
        expect(serviceSchedule(timeOnly, null, '2026-01-31', '2026-02-27').status).toBe(ServiceStatus.WARNING);
        expect(serviceSchedule(timeOnly, null, '2026-01-31', '2026-02-28').status).toBe(ServiceStatus.DUE);
        expect(serviceSchedule({ ...timeOnly, serviceIntervalKm: 10000 }, 89500, '2026-01-31', '2026-02-28').status).toBe(
            ServiceStatus.DUE
        );
    });

    it('does not invent a baseline or distance for inconsistent odometers', () => {
        expect(serviceSchedule({ ...baseline, lastOccurredAt: null, lastOdometer: null }, 90000, null, '2026-02-28').status).toBe(
            ServiceStatus.NO_HISTORY
        );
        expect(serviceSchedule(baseline, 79000, '2026-01-31', '2026-02-28').remainingKm).toBeNull();
    });

    it('validates optional intervals and rejects zero, fractions and excessive values', () => {
        expect(categorySchema.safeParse({ name: 'Synthetic', serviceIntervalKm: null, serviceIntervalMonths: 12 }).success).toBe(true);
        for (const value of [0, -1, 1.5, 1000001, Infinity])
            expect(categorySchema.safeParse({ name: 'Synthetic', serviceIntervalKm: value }).success).toBe(false);
        expect(categorySchema.safeParse({ name: 'Synthetic', serviceIntervalMonths: 1201 }).success).toBe(false);
    });
});
