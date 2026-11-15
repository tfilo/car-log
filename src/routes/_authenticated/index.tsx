/* eslint-disable react-refresh/only-export-components */
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Page, Section } from '@tfilo/tope-ui';
import { TruckIcon } from '@heroicons/react/16/solid';
import { fuelVehiclesOptions } from '../../fuel/fuel-queries';
import { statisticsOptions } from '../../statistics/statistics-queries';
import { StatisticsPeriod } from '../../statistics/statistics-values';
import { FuelType } from '../../generated/prisma/enums';
import { displayNumber } from '../../common/number';
import { currentUserOptions } from '../../ui/session';
import type { VehicleData } from '../../vehicles/vehicle.types';
import { ServiceReminders } from '../../ui/service-reminders';

export const Route = createFileRoute('/_authenticated/')({
    loader: async ({ context }) => {
        const vehicles = await context.queryClient.query(fuelVehiclesOptions(context.user.id));
        await Promise.all(
            vehicles.map((vehicle) =>
                context.queryClient.query(statisticsOptions(context.user.id, { vehicleId: vehicle.id, period: StatisticsPeriod.ALL }))
            )
        );
    },
    component: HomePage
});

function HomePage() {
    const { t } = useTranslation('auth');
    const router = useRouter();
    const { data: user } = useSuspenseQuery(currentUserOptions);
    const { data: vehicles } = useSuspenseQuery(fuelVehiclesOptions(user?.id ?? ''));

    return (
        <Page title={t('home.heading')}>
            <p>{t('home.welcome')}</p>
            <Section title={t('home.vehicles')}>
                {!vehicles.length ? (
                    <>
                        <p>{t('home.noVehicles')}</p>
                        <Button onClick={() => router.navigate({ to: '/vehicles/new' })}>{t('vehicles:add')}</Button>
                    </>
                ) : (
                    <>
                        <p className='text-sm text-secondary'>{t('home.historyHelp')}</p>
                        <ul>
                            {vehicles.map((vehicle) => (
                                <VehicleOverview
                                    key={vehicle.id}
                                    vehicle={vehicle}
                                    userId={user?.id ?? ''}
                                />
                            ))}
                        </ul>
                    </>
                )}
            </Section>
        </Page>
    );
}

function VehicleOverview({ vehicle, userId }: { vehicle: VehicleData; userId: string }) {
    const { t } = useTranslation('auth');
    const router = useRouter();
    const { data: result } = useSuspenseQuery(statisticsOptions(userId, { vehicleId: vehicle.id, period: StatisticsPeriod.ALL }));

    return (
        <li className='flex flex-col gap-md border-b pt-lg last:border-b-0'>
            <Button
                variant='transparent'
                icon={TruckIcon}
                onClick={() => router.navigate({ to: '/vehicles/$vehicleId', params: { vehicleId: vehicle.id } })}
            >
                {vehicle.manufacturer} {vehicle.model}
            </Button>
            <>
                <ServiceReminders
                    schedules={result.statistics.serviceSchedules}
                    vehicleId={vehicle.id}
                    vehicleName={`${vehicle.manufacturer} ${vehicle.model}`}
                    mileageAt={result.statistics.latestOdometerAt}
                />
                <dl className='flex flex-col gap-md'>
                    <div className='flex flex-wrap justify-between gap-md'>
                        <dt>{t('home.mileage')}</dt>
                        <dd>
                            {result.statistics.latestOdometer === null
                                ? t('home.unavailable')
                                : `${displayNumber(result.statistics.latestOdometer, 0, 3)} km`}
                        </dd>
                    </div>
                    {vehicle.fuelTypes
                        .filter((type) => type !== FuelType.ELECTRIC)
                        .map((type) => {
                            const fuel = result.statistics.fuels.find((item) => item.fuelType === type);
                            return (
                                <div
                                    key={type}
                                    className='flex flex-wrap justify-between gap-md'
                                >
                                    <dt>
                                        {t('home.consumption')} · {t(`vehicles:fuels.${type}`)}
                                    </dt>
                                    <dd>
                                        {fuel?.consumptionPer100Km == null
                                            ? t('home.unavailable')
                                            : `${displayNumber(fuel.consumptionPer100Km)} ${fuel.unit}/100 km`}
                                    </dd>
                                </div>
                            );
                        })}
                </dl>
            </>
        </li>
    );
}
