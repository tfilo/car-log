/* eslint-disable react-refresh/only-export-components */
import { useState, useTransition } from 'react';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Card, Column, Grid, Page, TablePagination } from '@tfilo/tope-ui';
import { currentUserOptions } from '../../../ui/session';
import { vehicleListOptions } from '../../../vehicles/vehicle-queries';

export const Route = createFileRoute('/_authenticated/vehicles/')({
    loader: ({ context }) => context.queryClient.query(vehicleListOptions(context.user.id, 0)),
    component: VehiclesPage
});

function VehiclesPage() {
    const { t } = useTranslation('vehicles');
    const router = useRouter();
    const { data: user } = useSuspenseQuery(currentUserOptions);

    const [page, setPage] = useState(0);

    const [pending, startTransition] = useTransition();

    const query = useSuspenseQuery(vehicleListOptions(user?.id ?? '', page));

    const result = query.data;

    const totalPages = Math.ceil(result.total / result.pageSize);

    function changePage(nextPage: number) {
        if (pending) return;

        startTransition(() => setPage(Math.max(0, Math.min(nextPage, totalPages - 1))));
    }

    return (
        <Page title={t('heading')}>
            <Button onClick={() => router.navigate({ to: '/vehicles/new' })}>{t('add')}</Button>
            {!result.total && <p>{t('empty')}</p>}
            <Grid>
                {result.vehicles.map((vehicle) => (
                    <Column key={vehicle.id}>
                        <Card
                            imageUrl={vehicle.pictureUrl ?? undefined}
                            title={`${vehicle.manufacturer} ${vehicle.model}`}
                            description={[vehicle.fuelTypes.map((type) => t(`fuels.${type}`)).join(', '), vehicle.licensePlate]
                                .filter(Boolean)
                                .join(' · ')}
                            onClick={() => router.navigate({ to: '/vehicles/$vehicleId', params: { vehicleId: vehicle.id } })}
                        />
                    </Column>
                ))}
            </Grid>
            <fieldset
                disabled={pending}
                aria-busy={pending}
                className='min-w-none'
            >
                <TablePagination
                    page={page}
                    totalPages={totalPages}
                    onPrevPage={() => changePage(page - 1)}
                    onNextPage={() => changePage(page + 1)}
                    onPageChange={changePage}
                />
            </fieldset>
        </Page>
    );
}
