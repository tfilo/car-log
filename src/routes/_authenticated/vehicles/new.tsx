/* eslint-disable react-refresh/only-export-components */
import { createFileRoute } from '@tanstack/react-router';
import { VehicleForm } from '../../../ui/vehicle-form';

export const Route = createFileRoute('/_authenticated/vehicles/new')({ component: NewVehiclePage });

function NewVehiclePage() {
    return <VehicleForm />;
}
