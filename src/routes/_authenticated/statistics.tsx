/* eslint-disable react-refresh/only-export-components */
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Column, Grid, Page, Section, useAppForm } from '@tfilo/tope-ui';
import { z } from 'zod';
import { fuelVehiclesOptions } from '../../fuel/fuel-queries';
import { vehicleLabel } from '../../fuel/fuel-format';
import { localFuelTime } from '../../fuel/fuel-time';
import type { VehicleData } from '../../vehicles/vehicle.types';
import { StatisticsPeriod } from '../../statistics/statistics-values';
import { statisticsOptions } from '../../statistics/statistics-queries';
import { statisticsFormSchema, statisticsFormInput, type StatisticsFormValues } from '../../statistics/statistics-form-schema';
import { currentUserOptions } from '../../ui/session';
import { translatedSchema } from '../../i18n/form-schema';
import { StatisticsReport } from '../../ui/statistics-report';

const searchSchema = z.object({
    vehicleId: z.uuid().optional().catch(undefined),
    period: z.enum(StatisticsPeriod).default(StatisticsPeriod.ALL).catch(StatisticsPeriod.ALL),
    from: z.string().max(10).optional().catch(undefined),
    to: z.string().max(10).optional().catch(undefined)
});

export const Route = createFileRoute('/_authenticated/statistics')({
    validateSearch: searchSchema,
    loaderDeps: ({ search }) => search,
    loader: async ({ context, deps }) => {
        const vehicles = await context.queryClient.query(fuelVehiclesOptions(context.user.id));
        const vehicleId = deps.vehicleId ?? vehicles[0]?.id;

        if (vehicleId) await context.queryClient.query(statisticsOptions(context.user.id, { ...deps, vehicleId }));

        return { today: localFuelTime(new Date().toISOString()).slice(0, 10), vehicleId };
    },
    component: StatisticsPage
});

function StatisticsPage() {
    const { t } = useTranslation('statistics');
    const router = useRouter();
    const { data: user } = useSuspenseQuery(currentUserOptions);
    const { data: vehicles } = useSuspenseQuery(fuelVehiclesOptions(user?.id ?? ''));
    const search = Route.useSearch();
    const { today, vehicleId } = Route.useLoaderData();

    return (
        <Page title={t('heading')}>
            {!vehicleId ? (
                <>
                    <p>{t('noVehicles')}</p>
                    <Button onClick={() => router.navigate({ to: '/vehicles/new' })}>{t('addVehicle')}</Button>
                </>
            ) : (
                <VehicleStatistics
                    key={`${vehicleId}:${search.period}:${search.from ?? ''}:${search.to ?? ''}`}
                    userId={user?.id ?? ''}
                    vehicles={vehicles}
                    values={{
                        vehicleId,
                        period: search.period,
                        from: search.from ?? today.slice(0, 7) + '-01',
                        to: search.to ?? today
                    }}
                />
            )}
        </Page>
    );
}

function VehicleStatistics({ userId, vehicles, values }: { userId: string; vehicles: VehicleData[]; values: StatisticsFormValues }) {
    const { t } = useTranslation('statistics');
    const router = useRouter();
    const search = Route.useSearch();
    const { data: result } = useSuspenseQuery(statisticsOptions(userId, { ...search, vehicleId: values.vehicleId }));

    const form = useAppForm({
        defaultValues: values,
        validators: { onChange: translatedSchema(statisticsFormSchema, t) },
        onSubmit: async ({ value }) => {
            await router.navigate({ to: '/statistics', search: statisticsFormInput(value) });
        }
    });

    return (
        <>
            <Section>
                <form
                    noValidate
                    className='flex flex-col gap-lg'
                    onSubmit={(event) => {
                        event.preventDefault();
                        void form.handleSubmit();
                    }}
                >
                    <Grid>
                        {vehicles.length > 1 && (
                            <Column>
                                <form.AppField name='vehicleId'>
                                    {(field) => (
                                        <field.Select
                                            label={t('vehicle')}
                                            required
                                            options={vehicles.map((vehicle) => ({ value: vehicle.id, label: vehicleLabel(vehicle) }))}
                                        />
                                    )}
                                </form.AppField>
                            </Column>
                        )}
                        <Column>
                            <form.AppField name='period'>
                                {(field) => (
                                    <field.Select
                                        label={t('period')}
                                        required
                                        options={Object.values(StatisticsPeriod).map((period) => ({
                                            value: period,
                                            label: t(`periods.${period}`)
                                        }))}
                                    />
                                )}
                            </form.AppField>
                        </Column>
                    </Grid>
                    <form.Subscribe selector={(state) => state.values.period}>
                        {(period) =>
                            period === StatisticsPeriod.CUSTOM ? (
                                <Grid>
                                    <Column>
                                        <form.AppField name='from'>
                                            {(field) => (
                                                <field.DateTimeInput
                                                    type='date'
                                                    label={t('from')}
                                                    required
                                                    maxLength={10}
                                                />
                                            )}
                                        </form.AppField>
                                    </Column>
                                    <Column>
                                        <form.AppField name='to'>
                                            {(field) => (
                                                <field.DateTimeInput
                                                    type='date'
                                                    label={t('to')}
                                                    required
                                                    maxLength={10}
                                                />
                                            )}
                                        </form.AppField>
                                    </Column>
                                </Grid>
                            ) : null
                        }
                    </form.Subscribe>
                    <form.AppForm>
                        <form.Subscribe selector={(state) => state.isSubmitting}>
                            {(busy) => <form.SubscribeButton>{t(busy ? 'working' : 'apply')}</form.SubscribeButton>}
                        </form.Subscribe>
                    </form.AppForm>
                </form>
            </Section>
            <StatisticsReport statistics={result.statistics} />
        </>
    );
}
