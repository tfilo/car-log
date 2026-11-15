import { displayNumber } from '../common/number';
import { useTranslation } from 'react-i18next';
import { Column, Grid, Section, useAppForm } from '@tfilo/tope-ui';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { FuelType } from '../generated/prisma/enums';
import { fuelUnits } from '../fuel/fuel-values';
import { displayStatisticsBucket } from '../statistics/statistics-format';
import type { StatisticsData } from '../statistics/statistics.types';
import type { StatisticsBucket } from '../statistics/statistics-time';

const axisNumber = new Intl.NumberFormat('sk-SK', { notation: 'compact', maximumFractionDigits: 2 });

function ChartTooltip({ title, entries }: { title: string; entries: { label: string; value: string }[] }) {
    return (
        <div
            className='rounded-sm border bg-white p-md'
            style={{ maxWidth: 260 }}
        >
            <p className='font-bold'>{title}</p>
            {entries.map((entry) => (
                <p key={entry.label}>
                    {entry.label}: {entry.value}
                </p>
            ))}
        </div>
    );
}

function BucketHelp({ bucket }: { bucket: StatisticsBucket }) {
    const { t } = useTranslation('statistics');

    return (
        <p className='text-sm'>
            {t('bucketHelp', { bucket: bucket.step > 1 ? t('yearGroups', { count: bucket.step }) : t(`buckets.${bucket.unit}`) })}
        </p>
    );
}

export default function StatisticsCharts({ statistics }: { statistics: StatisticsData }) {
    const { t } = useTranslation('statistics');
    const form = useAppForm({
        defaultValues: { fuelType: statistics.fuels.find((fuel) => fuel.records > 0)?.fuelType ?? statistics.fuels[0].fuelType }
    });
    const costs = statistics.costs;
    const categories = statistics.categoryChart.map((point) => ({
        id: point.id ?? '',
        name: point.name ?? t('remainingCategories'),
        price: point.totalPrice
    }));

    return (
        <>
            <Grid maxRows={2}>
                <Column>
                    <Section title={t('costChart')}>
                        <BucketHelp bucket={statistics.costBucket} />
                        <figure
                            aria-label={t('costChart')}
                            className='min-w-none'
                        >
                            <ResponsiveContainer
                                width='100%'
                                height={300}
                                minWidth={0}
                            >
                                <BarChart
                                    data={costs}
                                    margin={{ top: 12, right: 8, bottom: 8, left: 0 }}
                                    accessibilityLayer
                                >
                                    <CartesianGrid
                                        stroke='var(--border-color-default)'
                                        strokeDasharray='3 3'
                                    />
                                    <XAxis
                                        dataKey='day'
                                        tickFormatter={(day: string) => displayStatisticsBucket(day, statistics.costBucket)}
                                        minTickGap={24}
                                    />
                                    <YAxis
                                        width={60}
                                        tickFormatter={(value: number) => axisNumber.format(value)}
                                    />
                                    <Tooltip
                                        content={({ active, label }) => {
                                            const point = statistics.costs.find((point) => point.day === label);
                                            return active && point ? (
                                                <ChartTooltip
                                                    title={displayStatisticsBucket(point.day, statistics.costBucket)}
                                                    entries={[
                                                        { label: t('fuelCosts'), value: `${displayNumber(point.fuel, 2)}\u00a0€` },
                                                        { label: t('otherCosts'), value: `${displayNumber(point.other, 2)}\u00a0€` },
                                                        { label: t('totalCosts'), value: `${displayNumber(point.total, 2)}\u00a0€` }
                                                    ]}
                                                />
                                            ) : null;
                                        }}
                                    />
                                    <Legend
                                        content={() => (
                                            <div className='flex flex-wrap justify-center gap-md'>
                                                <span className='flex items-center gap-sm'>
                                                    <span
                                                        aria-hidden
                                                        className='bg-primary'
                                                        style={{ width: 12, height: 12 }}
                                                    />
                                                    {t('fuelCosts')}
                                                </span>
                                                <span className='flex items-center gap-sm'>
                                                    <span
                                                        aria-hidden
                                                        className='bg-secondary'
                                                        style={{ width: 12, height: 12 }}
                                                    />
                                                    {t('otherCosts')}
                                                </span>
                                            </div>
                                        )}
                                    />
                                    <Bar
                                        dataKey='fuel'
                                        name={t('fuelCosts')}
                                        stackId='costs'
                                        fill='var(--color-primary)'
                                        isAnimationActive={false}
                                    />
                                    <Bar
                                        dataKey='other'
                                        name={t('otherCosts')}
                                        stackId='costs'
                                        fill='var(--color-secondary)'
                                        isAnimationActive={false}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        </figure>
                    </Section>
                </Column>
                <Column>
                    <Section title={t('categoryChart')}>
                        {categories.length ? (
                            <figure
                                aria-label={t('categoryChart')}
                                className='min-w-none'
                            >
                                <ResponsiveContainer
                                    width='100%'
                                    height={Math.max(240, categories.length * 40 + 48)}
                                    minWidth={0}
                                >
                                    <BarChart
                                        data={categories}
                                        layout='vertical'
                                        margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
                                        accessibilityLayer
                                    >
                                        <CartesianGrid
                                            stroke='var(--border-color-default)'
                                            strokeDasharray='3 3'
                                        />
                                        <XAxis
                                            type='number'
                                            tickFormatter={(value: number) => axisNumber.format(value)}
                                        />
                                        <YAxis
                                            type='category'
                                            dataKey='id'
                                            width={120}
                                            tickFormatter={(id: string) => {
                                                const name = categories.find((point) => point.id === id)?.name ?? '';
                                                return name.length > 20 ? name.slice(0, 19) + '…' : name;
                                            }}
                                        />
                                        <Tooltip
                                            content={({ active, label }) => {
                                                const point = statistics.categoryChart.find((point) => (point.id ?? '') === label);
                                                return active && point ? (
                                                    <ChartTooltip
                                                        title={point.name ?? t('remainingCategories')}
                                                        entries={[
                                                            {
                                                                label: t('otherCosts'),
                                                                value: `${displayNumber(point.totalPrice, 2)}\u00a0€`
                                                            }
                                                        ]}
                                                    />
                                                ) : null;
                                            }}
                                        />
                                        <Bar
                                            dataKey='price'
                                            name={t('otherCosts')}
                                            fill='var(--color-primary)'
                                            isAnimationActive={false}
                                        />
                                    </BarChart>
                                </ResponsiveContainer>
                            </figure>
                        ) : (
                            <p>{t('noExpenses')}</p>
                        )}
                        {statistics.categories.length > 10 && <p className='text-sm'>{t('categoryChartHelp')}</p>}
                    </Section>
                </Column>
            </Grid>
            {statistics.fuels.length > 1 && (
                <Grid>
                    <Column>
                        <form.AppField name='fuelType'>
                            {(field) => (
                                <field.Select
                                    label={t('chartFuel')}
                                    options={statistics.fuels.map((fuel) => ({
                                        value: fuel.fuelType,
                                        label: t(`vehicles:fuels.${fuel.fuelType}`)
                                    }))}
                                />
                            )}
                        </form.AppField>
                    </Column>
                </Grid>
            )}
            <form.Subscribe selector={(state) => state.values.fuelType}>
                {(fuelType) => (
                    <FuelCharts
                        statistics={statistics}
                        fuelType={fuelType}
                    />
                )}
            </form.Subscribe>
        </>
    );
}

function FuelCharts({ statistics, fuelType }: { statistics: StatisticsData; fuelType: FuelType }) {
    const { t } = useTranslation('statistics');
    const points = statistics.fuelPoints.filter((point) => point.fuelType === fuelType);
    const unit = fuelUnits[fuelType];
    const charts = [
        { key: 'unitPrice', title: t('priceChart', { unit }), help: t('priceHelp'), unit: `€/${unit}`, empty: t('noPrices') },
        {
            key: 'consumptionPer100Km',
            title: t('consumptionChart', { unit }),
            help: t('consumptionHelp'),
            unit: `${unit}/100 km`,
            empty: t('noConsumption')
        }
    ] as const;
    // Bucket keys are calendar dates encoded at UTC midnight, independent of the device timezone.
    const coordinates = points.map((point) => ({
        day: point.day,
        timestamp: Date.parse(point.day + 'T00:00:00Z'),
        unitPrice: point.unitPrice,
        consumptionPer100Km: point.consumptionPer100Km
    }));

    return (
        <Grid maxRows={2}>
            {charts.map((chart) => (
                <Column key={chart.key}>
                    <Section title={chart.title}>
                        {chart.key === 'consumptionPer100Km' && fuelType === FuelType.ELECTRIC ? (
                            <p>{t('evHelp')}</p>
                        ) : (
                            <>
                                <p className='text-sm'>{chart.help}</p>
                                <BucketHelp bucket={statistics.fuelBucket} />
                                {points.some((point) => point[chart.key] !== null) ? (
                                    <figure
                                        aria-label={chart.title}
                                        className='min-w-none'
                                    >
                                        <ResponsiveContainer
                                            width='100%'
                                            height={300}
                                            minWidth={0}
                                        >
                                            <LineChart
                                                data={coordinates}
                                                margin={{ top: 12, right: 16, bottom: 8, left: 0 }}
                                                accessibilityLayer
                                            >
                                                <CartesianGrid
                                                    stroke='var(--border-color-default)'
                                                    strokeDasharray='3 3'
                                                />
                                                <XAxis
                                                    dataKey='timestamp'
                                                    type='number'
                                                    scale='utc'
                                                    domain={['dataMin', 'dataMax']}
                                                    tickFormatter={(value: number) =>
                                                        displayStatisticsBucket(
                                                            new Date(value).toISOString().slice(0, 10),
                                                            statistics.fuelBucket
                                                        )
                                                    }
                                                    minTickGap={24}
                                                />
                                                <YAxis
                                                    width={60}
                                                    tickFormatter={(value: number) => axisNumber.format(value)}
                                                    domain={[0, 'auto']}
                                                />
                                                <Tooltip
                                                    content={({ active, label }) => {
                                                        const point = points.find(
                                                            (point) => Date.parse(point.day + 'T00:00:00Z') === label
                                                        );
                                                        const value = point?.[chart.key];
                                                        return active && point && value !== null && value !== undefined ? (
                                                            <ChartTooltip
                                                                title={displayStatisticsBucket(point.day, statistics.fuelBucket)}
                                                                entries={[
                                                                    {
                                                                        label: chart.title,
                                                                        value: `${displayNumber(value)}\u00a0${chart.unit}`
                                                                    }
                                                                ]}
                                                            />
                                                        ) : null;
                                                    }}
                                                />
                                                <Line
                                                    dataKey={chart.key}
                                                    name={chart.title}
                                                    type='linear'
                                                    stroke={chart.key === 'unitPrice' ? 'var(--color-primary)' : 'var(--color-success)'}
                                                    strokeWidth={2}
                                                    dot={{ r: 3 }}
                                                    connectNulls={false}
                                                    isAnimationActive={false}
                                                />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </figure>
                                ) : (
                                    <p>{chart.empty}</p>
                                )}
                            </>
                        )}
                    </Section>
                </Column>
            ))}
        </Grid>
    );
}
