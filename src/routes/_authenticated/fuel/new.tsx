import { fuelReturnSearchSchema } from '../../../common/list-search';
/* eslint-disable react-refresh/only-export-components */
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Page } from '@tfilo/tope-ui';
import { z } from 'zod';
import { fuelVehiclesOptions } from '../../../fuel/fuel-queries';
import { currentUserOptions } from '../../../ui/session';
import { FuelForm } from '../../../ui/fuel-form';

export const Route = createFileRoute('/_authenticated/fuel/new')({
    validateSearch: fuelReturnSearchSchema.extend({ vehicleId: z.uuid().optional().catch(undefined) }),
    loader: async ({ context }) => {
        await context.queryClient.query(fuelVehiclesOptions(context.user.id));
        return { occurredAt: new Date().toISOString() };
    },
    component: NewFuelPage
});

function NewFuelPage() {
    const { t } = useTranslation('fuel');
    const router = useRouter();
    const { data: user } = useSuspenseQuery(currentUserOptions);
    const { data: vehicles } = useSuspenseQuery(fuelVehiclesOptions(user?.id ?? ''));
    const { vehicleId, returnTo } = Route.useSearch();
    const { occurredAt } = Route.useLoaderData();
    const vehicle = vehicleId ? vehicles.find((item) => item.id === vehicleId) : vehicles[0];

    if (!vehicle)
        return (
            <Page
                title={t('createHeading')}
                onBack={() => router.navigate({ to: '/fuel', search: returnTo ?? {} })}
            >
                <p>{t(vehicles.length ? 'errors.vehicleNotFound' : 'noVehicles')}</p>
                {!vehicles.length && <Button onClick={() => router.navigate({ to: '/vehicles/new' })}>{t('addVehicle')}</Button>}
            </Page>
        );

    return (
        <FuelForm
            returnTo={returnTo}
            vehicles={vehicles}
            vehicle={vehicle}
            defaultOccurredAt={occurredAt}
        />
    );
}
