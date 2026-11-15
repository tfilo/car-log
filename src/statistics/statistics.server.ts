import { serviceSchedule, type ServiceBaseline } from '../service/service-schedule';
import { roundNumber } from '../common/number';
import type { z } from 'zod';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { FuelType, UserStatus } from '../generated/prisma/enums';
import { db } from '../db.server';
import { validateSession, tokenHash } from '../auth/session.server';
import { AuthErrorCode } from '../auth/auth-errors';
import { ResultKind } from '../common/result-kind';
import { fuelUnits } from '../fuel/fuel-values';
import { localFuelTime, fuelTimeZone } from '../fuel/fuel-time';
import { statisticsSchema } from './statistics-schema';
import { StatisticsErrorCode } from './statistics-errors';
import { StatisticsBucketUnit } from './statistics-values';
import { statisticsRange, statisticsBucket, bucketDays, type StatisticsRange, type StatisticsBucket } from './statistics-time';
import type { StatisticsOutcome, FuelStatistics, CategoryStatistics, FuelPoint, StatisticsData, FuelPlace } from './statistics.types';

type FuelAggregate = {
    fuelType: FuelType;
    cost: number;
    quantity: number;
    distance: number;
    consumed: number;
    records: number;
    validIntervals: number;
    missingRecords: number;
};

type CategoryAggregate = CategoryStatistics;
type RawCostPoint = { day: string; fuel: number; other: number };
type RawFuelPoint = Pick<FuelAggregate, 'fuelType' | 'cost' | 'quantity' | 'distance' | 'consumed' | 'validIntervals'> & { day: string };
type LatestReading = { odometer: number; occurredAt: Date };

function inRange(range: StatisticsRange): Prisma.Sql {
    return Prisma.sql`
        ${range.from ? Prisma.sql`AND "occurredAt" >= ${new Date(range.from)}` : Prisma.empty}
        ${range.until ? Prisma.sql`AND "occurredAt" < ${new Date(range.until)}` : Prisma.empty}
    `;
}

function bucketExpression(bucket: StatisticsBucket): Prisma.Sql {
    if (bucket.unit === StatisticsBucketUnit.YEAR && bucket.step > 1) {
        return Prisma.sql`make_date(
            ((extract(year from "occurredAt" AT TIME ZONE ${fuelTimeZone})::int - 1) / ${bucket.step}::int) * ${bucket.step}::int + 1,
            1, 1
        )`;
    }

    return Prisma.sql`date_trunc(${bucket.unit}::text, "occurredAt" AT TIME ZONE ${fuelTimeZone})`;
}

function ratio(quantity: number, distance: number, multiplier = 1): number | null {
    if (distance <= 0) return null;

    return (quantity * multiplier) / distance;
}

function fuelSummary(type: FuelType, value?: FuelAggregate): FuelStatistics {
    return {
        fuelType: type,
        unit: fuelUnits[type],
        totalPrice: value?.cost ?? 0,
        quantity: value?.quantity ?? 0,
        records: value?.records ?? 0,
        averageUnitPrice: value ? ratio(value.cost, value.quantity) : null,
        consumptionPer100Km: type !== FuelType.ELECTRIC && value ? ratio(value.consumed, value.distance, 100) : null,
        consumptionDistance: value?.distance ?? 0,
        consumptionQuantity: value?.consumed ?? 0,
        validIntervals: type === FuelType.ELECTRIC ? 0 : (value?.validIntervals ?? 0),
        missingRecords: value?.missingRecords ?? 0
    };
}

export async function getOwnedStatistics(
    token: string | undefined,
    input: z.input<typeof statisticsSchema>,
    database: PrismaClient = db,
    now = new Date()
): Promise<StatisticsOutcome> {
    const parsed = statisticsSchema.parse(input);
    const range = statisticsRange(parsed, now);

    const session = token ? await validateSession(token, database) : null;

    if (!session || !token) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

    return database.$transaction(
        async (tx) => {
            await tx.$executeRaw`SET TRANSACTION READ ONLY`;

            // Recheck access in the same snapshot as the report, without renewing or locking.
            const activeSession = await tx.session.findFirst({
                where: {
                    tokenHash: tokenHash(token),
                    userId: session.user.id,
                    expiresAt: { gt: new Date() },
                    user: { status: UserStatus.ACTIVE }
                },
                select: { id: true }
            });

            if (!activeSession) return { result: { kind: ResultKind.ERROR, code: AuthErrorCode.AUTH_REQUIRED }, clearSession: true };

            const expiresAt = session.expiresAt;
            const vehicle = await tx.vehicle.findFirst({ where: { id: parsed.vehicleId, userId: session.user.id } });

            if (!vehicle) return { result: { kind: ResultKind.ERROR, code: StatisticsErrorCode.VEHICLE_NOT_FOUND }, expiresAt };

            const vehicleId = vehicle.id;
            const conditions = inRange(range);
            const latest = await tx.$queryRaw<LatestReading[]>`
                SELECT "odometer"::double precision, "occurredAt" FROM (
                    SELECT "odometer", "occurredAt" FROM "FuelRecord" WHERE "vehicleId" = ${vehicleId}::uuid
                    UNION ALL
                    SELECT "odometer", "occurredAt" FROM "Expense" WHERE "vehicleId" = ${vehicleId}::uuid
                ) AS readings
                ORDER BY "occurredAt" DESC, "odometer" DESC LIMIT 1
            `;
            const serviceHistory = await tx.$queryRaw<(Omit<ServiceBaseline, 'lastOccurredAt'> & { lastOccurredAt: Date | null })[]>`
                SELECT c.id AS "categoryId", c.name, c."serviceIntervalKm", c."serviceIntervalMonths",
                    last."odometer"::double precision AS "lastOdometer", last."occurredAt" AS "lastOccurredAt"
                FROM "ExpenseCategory" c
                LEFT JOIN LATERAL (
                    SELECT e."odometer", e."occurredAt" FROM "Expense" e
                    WHERE e."categoryId" = c.id AND e."userId" = c."userId" AND e."vehicleId" = ${vehicleId}::uuid
                    ORDER BY e."occurredAt" DESC, e."odometer" DESC, e.id DESC LIMIT 1
                ) last ON true
                WHERE c."userId" = ${session.user.id}::uuid AND NOT c."isArchived"
                    AND (c."serviceIntervalKm" IS NOT NULL OR c."serviceIntervalMonths" IS NOT NULL)
                ORDER BY c.name, c.id
            `;
            const serviceSchedules = serviceHistory.map((item) =>
                serviceSchedule(
                    { ...item, lastOccurredAt: item.lastOccurredAt?.toISOString() ?? null },
                    latest[0]?.odometer ?? null,
                    item.lastOccurredAt ? localFuelTime(item.lastOccurredAt.toISOString()).slice(0, 10) : null,
                    localFuelTime(now.toISOString()).slice(0, 10)
                )
            );
            const fuel = await tx.$queryRaw<FuelAggregate[]>`
                SELECT "fuelType", SUM("totalPrice")::double precision AS cost, SUM(quantity)::double precision AS quantity,
                    COALESCE(SUM("consumptionDistance"), 0)::double precision AS distance,
                    COALESCE(SUM("consumptionQuantity"), 0)::double precision AS consumed,
                    COUNT(*)::int AS records,
                    COUNT("consumptionDistance")::int AS "validIntervals",
                    COUNT(*) FILTER (WHERE "previousRecordMissing")::int AS "missingRecords"
                FROM "FuelRecord" WHERE "vehicleId" = ${vehicleId}::uuid ${conditions}
                GROUP BY "fuelType"
            `;
            const placeRows = await tx.$queryRaw<(Omit<FuelPlace, 'occurredAt'> & { occurredAt: Date })[]>`
                SELECT id, "fuelType", latitude, longitude, "occurredAt", quantity::double precision, "totalPrice"::double precision
                FROM "FuelRecord" WHERE "vehicleId" = ${vehicleId}::uuid
                    AND latitude IS NOT NULL AND longitude IS NOT NULL ${conditions}
                ORDER BY "occurredAt", id
            `;
            const fuelPlaces = placeRows.map((place) => ({ ...place, occurredAt: place.occurredAt.toISOString() }));
            const categories = await tx.$queryRaw<CategoryAggregate[]>`
                SELECT c.id, c.name, c."isArchived", SUM(e."totalPrice")::double precision AS "totalPrice", COUNT(*)::int AS records
                FROM "Expense" e JOIN "ExpenseCategory" c ON c.id = e."categoryId" AND c."userId" = e."userId"
                WHERE e."vehicleId" = ${vehicleId}::uuid ${conditions}
                GROUP BY c.id ORDER BY SUM(e."totalPrice") DESC, c.name, c.id
            `;
            const extent = await tx.$queryRaw<{ first: Date | null; last: Date | null }[]>`
                SELECT MIN("occurredAt") AS first, MAX("occurredAt") AS last FROM (
                    SELECT "occurredAt" FROM "FuelRecord" WHERE "vehicleId" = ${vehicleId}::uuid ${conditions}
                    UNION ALL
                    SELECT "occurredAt" FROM "Expense" WHERE "vehicleId" = ${vehicleId}::uuid ${conditions}
                ) AS events
            `;
            const fromDay =
                range.fromDay ??
                (extent[0].first
                    ? localFuelTime(extent[0].first.toISOString()).slice(0, 10)
                    : localFuelTime(now.toISOString()).slice(0, 10));
            const toDay = range.toDay ?? (extent[0].last ? localFuelTime(extent[0].last.toISOString()).slice(0, 10) : fromDay);
            const costBucket = statisticsBucket(fromDay, toDay, true);
            const fuelBucket = statisticsBucket(fromDay, toDay);
            const costExpression = bucketExpression(costBucket);
            const fuelExpression = bucketExpression(fuelBucket);

            const costRows = await tx.$queryRaw<RawCostPoint[]>`
                SELECT to_char(${costExpression}, 'YYYY-MM-DD') AS day, SUM(fuel)::double precision AS fuel, SUM(other)::double precision AS other
                FROM (
                    SELECT "occurredAt", "totalPrice" AS fuel, 0::numeric AS other FROM "FuelRecord"
                    WHERE "vehicleId" = ${vehicleId}::uuid ${conditions}
                    UNION ALL
                    SELECT "occurredAt", 0::numeric AS fuel, "totalPrice" AS other FROM "Expense"
                    WHERE "vehicleId" = ${vehicleId}::uuid ${conditions}
                ) AS costs GROUP BY 1 ORDER BY 1
            `;
            const fuelRows = await tx.$queryRaw<RawFuelPoint[]>`
                SELECT to_char(${fuelExpression}, 'YYYY-MM-DD') AS day, "fuelType",
                    SUM("totalPrice")::double precision AS cost, SUM(quantity)::double precision AS quantity,
                    COALESCE(SUM("consumptionDistance"), 0)::double precision AS distance,
                    COALESCE(SUM("consumptionQuantity"), 0)::double precision AS consumed,
                    COUNT("consumptionDistance")::int AS "validIntervals"
                FROM "FuelRecord" WHERE "vehicleId" = ${vehicleId}::uuid ${conditions}
                GROUP BY 1, "fuelType" ORDER BY 1, "fuelType"
            `;

            const fuels = vehicle.fuelTypes.map((type) =>
                fuelSummary(
                    type,
                    fuel.find((item) => item.fuelType === type)
                )
            );
            const fuelCosts = roundNumber(fuel.reduce((sum, item) => sum + item.cost, 0));
            const otherCosts = roundNumber(categories.reduce((sum, item) => sum + item.totalPrice, 0));
            const costMap = new Map(costRows.map((point) => [point.day, point]));
            const costs = bucketDays(fromDay, toDay, costBucket).map((day) => {
                const point = costMap.get(day);
                const fuel = point?.fuel ?? 0;
                const other = point?.other ?? 0;

                return { day, fuel, other, total: roundNumber(fuel + other) };
            });
            const fuelPoints: FuelPoint[] = fuelRows.map((point) => ({
                day: point.day,
                fuelType: point.fuelType,
                unitPrice: ratio(point.cost, point.quantity),
                consumptionPer100Km: point.fuelType === FuelType.ELECTRIC ? null : ratio(point.consumed, point.distance, 100),
                validIntervals: point.validIntervals
            }));
            const categoryChart: StatisticsData['categoryChart'] = categories.slice(0, 10).map((category) => ({
                id: category.id,
                name: category.name,
                totalPrice: category.totalPrice
            }));

            if (categories.length > 10) {
                const rest = roundNumber(categories.slice(10).reduce((sum, category) => sum + category.totalPrice, 0));
                categoryChart.push({ id: null, name: null, totalPrice: rest });
            }

            return {
                result: {
                    kind: ResultKind.STATISTICS,
                    statistics: {
                        vehicleId,
                        serviceSchedules,
                        fuelPlaces,
                        range,
                        latestOdometer: latest[0] ? latest[0].odometer : null,
                        latestOdometerAt: latest[0]?.occurredAt.toISOString() ?? null,
                        fuelCosts: fuelCosts,
                        otherCosts: otherCosts,
                        totalCosts: roundNumber(fuelCosts + otherCosts),
                        fuelRecords: fuel.reduce((sum, value) => sum + value.records, 0),
                        expenseRecords: categories.reduce((sum, value) => sum + value.records, 0),
                        fuels,
                        categories,
                        categoryChart,
                        costs,
                        fuelPoints,
                        costBucket,
                        fuelBucket
                    }
                },
                expiresAt
            };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
}
