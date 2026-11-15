import { fuelReturnSearchSchema } from '../../../common/list-search';
/* eslint-disable react-refresh/only-export-components */
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Page } from '@tfilo/tope-ui';
import { fuelRecordOptions, fuelVehiclesOptions } from '../../../fuel/fuel-queries';
import { currentUserOptions } from '../../../ui/session';
import { FuelForm } from '../../../ui/fuel-form';
import { ErrorMessages } from '../../../ui/feedback';

export const Route = createFileRoute('/_authenticated/fuel/$recordId')({
    validateSearch: fuelReturnSearchSchema,
    loader: ({ context, params }) =>
        Promise.all([
            context.queryClient.query(fuelVehiclesOptions(context.user.id)),
            context.queryClient.query(fuelRecordOptions(context.user.id, params.recordId))
        ]),
    component: EditFuelPage
});

function EditFuelPage() {
    const { t } = useTranslation('fuel');
    const router = useRouter();
    const { data: user } = useSuspenseQuery(currentUserOptions);
    const { recordId } = Route.useParams();
    const { returnTo } = Route.useSearch();
    const { data: vehicles } = useSuspenseQuery(fuelVehiclesOptions(user?.id ?? ''));
    const { data: result } = useSuspenseQuery(fuelRecordOptions(user?.id ?? '', recordId));

    const vehicle = vehicles.find((item) => item.id === result.record.vehicleId);

    if (!vehicle)
        return (
            <Page
                title={t('editHeading')}
                onBack={() => router.navigate({ to: '/fuel', search: returnTo ?? {} })}
            >
                <ErrorMessages
                    namespace='fuel'
                    errors={['errors.vehicleNotFound']}
                />
            </Page>
        );

    return (
        <FuelForm
            returnTo={returnTo}
            key={result.record.id}
            initial={result.record}
            vehicles={vehicles}
            vehicle={vehicle}
            defaultOccurredAt={result.record.occurredAt}
        />
    );
}
