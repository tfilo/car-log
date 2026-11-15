import type { ServiceSchedule } from '../service/service-schedule';
import type { z } from 'zod';
import type { AuthErrorCode } from '../auth/auth-errors';
import type { ResultKind } from '../common/result-kind';
import type { SessionOutcome } from '../auth/auth.types';
import type { FuelType } from '../generated/prisma/enums';
import type { FuelUnit } from '../fuel/fuel-values';
import type { StatisticsErrorCode } from './statistics-errors';
import type { statisticsSchema } from './statistics-schema';
import type { StatisticsRange, StatisticsBucket } from './statistics-time';

export type FuelStatistics = {
    fuelType: FuelType;
    unit: FuelUnit;
    totalPrice: number;
    quantity: number;
    records: number;
    averageUnitPrice: number | null;
    consumptionPer100Km: number | null;
    consumptionDistance: number;
    consumptionQuantity: number;
    validIntervals: number;
    missingRecords: number;
};

export type CategoryStatistics = { id: string; name: string; isArchived: boolean; totalPrice: number; records: number };

export type CostPoint = { day: string; fuel: number; other: number; total: number };

export type FuelPoint = {
    day: string;
    fuelType: FuelType;
    unitPrice: number | null;
    consumptionPer100Km: number | null;
    validIntervals: number;
};

export type FuelPlace = {
    id: string;
    fuelType: FuelType;
    latitude: number;
    longitude: number;
    occurredAt: string;
    quantity: number;
    totalPrice: number;
};

export type StatisticsData = {
    fuelPlaces: FuelPlace[];
    serviceSchedules: ServiceSchedule[];
    vehicleId: string;
    range: StatisticsRange;
    latestOdometer: number | null;
    latestOdometerAt: string | null;
    fuelCosts: number;
    otherCosts: number;
    totalCosts: number;
    fuelRecords: number;
    expenseRecords: number;
    fuels: FuelStatistics[];
    categories: CategoryStatistics[];
    categoryChart: { id: string | null; name: string | null; totalPrice: number }[];
    costs: CostPoint[];
    fuelPoints: FuelPoint[];
    costBucket: StatisticsBucket;
    fuelBucket: StatisticsBucket;
};

export type StatisticsFailure = { kind: typeof ResultKind.ERROR; code: StatisticsErrorCode | typeof AuthErrorCode.AUTH_REQUIRED };

export type StatisticsValidationFailure = {
    kind: typeof ResultKind.INVALID;
    code: typeof StatisticsErrorCode.INVALID;
    fields: Partial<Record<keyof z.input<typeof statisticsSchema>, string[]>>;
    formErrors: string[];
};

export type StatisticsResult = { kind: typeof ResultKind.STATISTICS; statistics: StatisticsData } | StatisticsFailure;

export type StatisticsOutcome = SessionOutcome<StatisticsResult>;

export type StatisticsResponse = StatisticsResult | StatisticsValidationFailure;
