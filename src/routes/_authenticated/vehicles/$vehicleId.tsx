/* eslint-disable react-refresh/only-export-components */
import { createFileRoute } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { currentUserOptions } from '../../../ui/session';
import { VehicleForm } from '../../../ui/vehicle-form';
import { vehicleDetailsOptions } from '../../../vehicles/vehicle-queries';

export const Route = createFileRoute('/_authenticated/vehicles/$vehicleId')({
    loader: ({ context, params }) => context.queryClient.query(vehicleDetailsOptions(context.user.id, params.vehicleId)),
    component: EditVehiclePage
});

function EditVehiclePage() {
    const { vehicleId } = Route.useParams();
    const { data: user } = useSuspenseQuery(currentUserOptions);
    const { data: result } = useSuspenseQuery(vehicleDetailsOptions(user?.id ?? '', vehicleId));

    return (
        <VehicleForm
            key={result.vehicle.id}
            initial={result.vehicle}
        />
    );
}
