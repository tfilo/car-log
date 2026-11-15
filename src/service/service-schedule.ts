import { roundNumber } from '../common/number';

export const ServiceStatus = { NO_HISTORY: 'noHistory', UPCOMING: 'upcoming', WARNING: 'warning', DUE: 'due' } as const;
export type ServiceStatus = (typeof ServiceStatus)[keyof typeof ServiceStatus];

export type ServiceBaseline = {
    categoryId: string;
    name: string;
    serviceIntervalKm: number | null;
    serviceIntervalMonths: number | null;
    lastOdometer: number | null;
    lastOccurredAt: string | null;
};

export type ServiceSchedule = ServiceBaseline & {
    status: ServiceStatus;
    dueOdometer: number | null;
    dueDay: string | null;
    remainingKm: number | null;
    remainingDays: number | null;
};

function dayNumber(day: string): number {
    return Date.parse(`${day}T00:00:00Z`) / 86400000;
}

export function addCalendarMonths(day: string, months: number): string {
    const date = new Date(`${day}T00:00:00Z`);
    const originalDay = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    const end = new Date(date);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    date.setUTCDate(Math.min(originalDay, end.getUTCDate()));
    return date.toISOString().slice(0, 10);
}

// Inputs are owner-scoped service history and Bratislava calendar days, never estimated mileage.
export function serviceSchedule(
    baseline: ServiceBaseline,
    latestOdometer: number | null,
    lastDay: string | null,
    today: string
): ServiceSchedule {
    const dueOdometer =
        baseline.lastOdometer !== null && baseline.serviceIntervalKm !== null ? baseline.lastOdometer + baseline.serviceIntervalKm : null;
    const dueDay = lastDay && baseline.serviceIntervalMonths !== null ? addCalendarMonths(lastDay, baseline.serviceIntervalMonths) : null;
    const remainingKm =
        dueOdometer !== null && latestOdometer !== null && latestOdometer >= baseline.lastOdometer!
            ? roundNumber(dueOdometer - latestOdometer, 3)
            : null;
    const remainingDays = dueDay ? dayNumber(dueDay) - dayNumber(today) : null;
    let status: ServiceStatus = ServiceStatus.UPCOMING;

    if (!baseline.lastOccurredAt) status = ServiceStatus.NO_HISTORY;
    else if ((remainingKm !== null && remainingKm <= 0) || (remainingDays !== null && remainingDays <= 0)) status = ServiceStatus.DUE;
    else if (
        (remainingKm !== null && remainingKm <= baseline.serviceIntervalKm! * 0.05) ||
        (remainingDays !== null && remainingDays <= (dayNumber(dueDay!) - dayNumber(lastDay!)) * 0.05)
    )
        status = ServiceStatus.WARNING;

    return { ...baseline, status, dueOdometer, dueDay, remainingKm, remainingDays };
}
