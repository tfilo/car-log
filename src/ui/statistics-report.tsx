import { MobileTableRow } from './mobile-table-row';
import { displayNumber } from '../common/number';
import { lazy, Suspense, useCallback } from 'react';
import { ClientOnly } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Column, Grid, Section, Table, createColumns } from '@tfilo/tope-ui';
import type { StatisticsData, CategoryStatistics } from '../statistics/statistics.types';
import { displayFuelTime } from '../fuel/fuel-time';
import { FuelType } from '../generated/prisma/enums';
import { displayStatisticsDay } from '../statistics/statistics-format';

const StatisticsCharts = lazy(() => import('./statistics-charts'));
const FuelPlacesMap = lazy(() => import('./fuel-places-map').catch(() => ({ default: MapUnavailable })));

function MapUnavailable() {
    const { t } = useTranslation('statistics');
    return <p>{t('places.mapUnavailable')}</p>;
}

export function StatisticsReport({ statistics }: { statistics: StatisticsData }) {
    const { t } = useTranslation('statistics');
    const categories = statistics.categories;
    const fetchCategories = useCallback(
        async (page: number, pageSize: number) => ({
            data: categories.slice(page * pageSize, (page + 1) * pageSize),
            page,
            pageSize,
            totalRecords: categories.length
        }),
        [categories]
    );

    const empty = statistics.fuelRecords + statistics.expenseRecords === 0;
    const columns = createColumns<CategoryStatistics>([
        {
            header: t('category'),
            accessor: 'name',
            cell: (category) => (category.isArchived ? t('archivedLabel', { name: category.name }) : category.name)
        },
        { header: t('categoryCount'), accessor: 'records' },
        { header: t('categoryTotal'), accessor: 'totalPrice', formatter: (value) => `${displayNumber(value, 2)} €` }
    ]);
    const summary = [
        { label: t('fuelCosts'), value: `${displayNumber(statistics.fuelCosts, 2)} €` },
        { label: t('otherCosts'), value: `${displayNumber(statistics.otherCosts, 2)} €` },
        { label: t('totalCosts'), value: `${displayNumber(statistics.totalCosts, 2)} €` },
        {
            label: t('latestOdometer'),
            value: statistics.latestOdometer === null ? t('unavailable') : `${displayNumber(statistics.latestOdometer)} km`
        }
    ];

    return (
        <>
            {statistics.range.fromDay && statistics.range.toDay && (
                <p>
                    {t('rangeLabel', {
                        from: displayStatisticsDay(statistics.range.fromDay),
                        to: displayStatisticsDay(statistics.range.toDay)
                    })}
                </p>
            )}
            <p className='text-sm'>{t('historyHelp')}</p>
            {empty && <p role='status'>{t('empty')}</p>}
            <Grid>
                {summary.map((item) => (
                    <Column key={item.label}>
                        <Section title={item.label}>
                            <p className='text-lg font-bold wrap-anywhere'>{item.value}</p>
                        </Section>
                    </Column>
                ))}
            </Grid>
            <p className='text-sm'>
                {t('odometerHelp')}
                {statistics.latestOdometerAt ? ` ${t('latestAt', { date: displayFuelTime(statistics.latestOdometerAt) })}` : ''}
            </p>
            <p className='text-sm'>{t('recordCount', { fuel: statistics.fuelRecords, other: statistics.expenseRecords })}</p>
            <Section title={t('fuels')}>
                <p className='text-sm'>{t('consumptionHelp')}</p>
                <Grid maxRows={2}>
                    {statistics.fuels.map((fuel) => (
                        <Column key={fuel.fuelType}>
                            <Section title={t(`vehicles:fuels.${fuel.fuelType}`)}>
                                <dl className='flex flex-col gap-md'>
                                    <div className='flex flex-wrap justify-between gap-md'>
                                        <dt>{t('fuelCosts')}</dt>
                                        <dd className='font-bold'>{displayNumber(fuel.totalPrice, 2)} €</dd>
                                    </div>
                                    <div className='flex flex-wrap justify-between gap-md'>
                                        <dt>{t('quantity')}</dt>
                                        <dd>
                                            {displayNumber(fuel.quantity)} {fuel.unit}
                                        </dd>
                                    </div>
                                    <div className='flex flex-wrap justify-between gap-md'>
                                        <dt>{t('unitPrice')}</dt>
                                        <dd>
                                            {fuel.averageUnitPrice === null
                                                ? t('unavailable')
                                                : `${displayNumber(fuel.averageUnitPrice)} €/${fuel.unit}`}
                                        </dd>
                                    </div>
                                    {fuel.fuelType !== FuelType.ELECTRIC && (
                                        <>
                                            <div className='flex flex-wrap justify-between gap-md'>
                                                <dt>{t('consumption')}</dt>
                                                <dd className='font-bold'>
                                                    {fuel.consumptionPer100Km === null
                                                        ? t('unavailable')
                                                        : `${displayNumber(fuel.consumptionPer100Km)} ${fuel.unit}/100 km`}
                                                </dd>
                                            </div>
                                            <div>
                                                <dt>{t('coverage')}</dt>
                                                <dd>
                                                    {t('coverageValue', {
                                                        count: fuel.validIntervals,
                                                        distance: displayNumber(fuel.consumptionDistance)
                                                    })}
                                                </dd>
                                            </div>
                                        </>
                                    )}
                                </dl>
                                {fuel.missingRecords > 0 && fuel.fuelType !== FuelType.ELECTRIC && (
                                    <p className='text-sm'>
                                        {t('missingHelp', { fuel: t(`vehicles:fuels.${fuel.fuelType}`), count: fuel.missingRecords })}
                                    </p>
                                )}
                                {fuel.fuelType === FuelType.ELECTRIC && <p className='text-sm'>{t('evHelp')}</p>}
                            </Section>
                        </Column>
                    ))}
                </Grid>
            </Section>
            <Section title={t('categoryTotals')}>
                {statistics.categories.length ? (
                    <Table
                        columns={columns}
                        onFetch={fetchCategories}
                        pageSize={10}
                        renderMobileRow={(category) => (
                            <MobileTableRow
                                title={category.isArchived ? t('archivedLabel', { name: category.name }) : category.name}
                                value={`${displayNumber(category.totalPrice, 2)} €`}
                            >
                                <p>
                                    {t('categoryCount')}: {category.records}
                                </p>
                            </MobileTableRow>
                        )}
                    />
                ) : (
                    <p>{t('noExpenses')}</p>
                )}
            </Section>
            {!empty && (
                <ClientOnly fallback={<p>{t('loadingCharts')}</p>}>
                    <Suspense fallback={<p>{t('loadingCharts')}</p>}>
                        <StatisticsCharts statistics={statistics} />
                    </Suspense>
                </ClientOnly>
            )}
            <Section title={t('places.heading')}>
                {statistics.fuelPlaces.length ? (
                    <>
                        <p className='text-sm'>{t('places.help', { count: statistics.fuelPlaces.length })}</p>
                        <ClientOnly fallback={<p>{t('places.loading')}</p>}>
                            <Suspense fallback={<p>{t('places.loading')}</p>}>
                                <FuelPlacesMap places={statistics.fuelPlaces} />
                            </Suspense>
                        </ClientOnly>
                    </>
                ) : (
                    <p>{t('places.empty')}</p>
                )}
            </Section>
        </>
    );
}
