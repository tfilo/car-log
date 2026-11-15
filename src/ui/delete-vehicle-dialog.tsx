import { statisticsKeys } from '../statistics/statistics-queries';
import { expenseKeys } from '../expenses/expense-queries';
import { fuelKeys } from '../fuel/fuel-queries';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useServerFn } from '@tanstack/react-start';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { Modal } from '@tfilo/tope-ui';
import { deleteVehicle } from '../vehicles/vehicles';
import type { VehicleData } from '../vehicles/vehicle.types';
import { vehicleKeys } from '../vehicles/vehicle-queries';
import { getVehicleErrorKey } from '../vehicles/vehicle-errors';
import { ResultKind } from '../common/result-kind';
import { AuthErrorCode } from '../auth/auth-errors';
import { replaceCurrentUser } from './session';
import { vehicleErrors } from './vehicle-feedback';
import { ErrorMessages } from './feedback';

export function DeleteVehicleDialog({ vehicle, onClose }: { vehicle: VehicleData; onClose: () => void }) {
    const { t } = useTranslation('vehicles');
    const queryClient = useQueryClient();
    const router = useRouter();
    const remove = useServerFn(deleteVehicle);

    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);

    async function confirm(confirmed: boolean) {
        if (busy) return;

        if (!confirmed) {
            onClose();

            return;
        }

        setBusy(true);
        setErrors([]);

        try {
            const result = await remove({ data: { vehicleId: vehicle.id, confirmed: true } });

            if (result.kind !== ResultKind.DELETED) {
                setErrors(vehicleErrors(result));

                if (result.code === AuthErrorCode.AUTH_REQUIRED) await replaceCurrentUser(queryClient, null);

                return;
            }

            await queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
            await queryClient.invalidateQueries({ queryKey: fuelKeys.all });
            await queryClient.invalidateQueries({ queryKey: statisticsKeys.all });
            await queryClient.invalidateQueries({ queryKey: expenseKeys.all });
            await router.navigate({ to: '/vehicles', replace: true });
        } catch (error) {
            setErrors([getVehicleErrorKey(error instanceof Error ? error.message : undefined)]);
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal
            openModal={true}
            title={t('delete.heading')}
            aria-label={t('delete.heading')}
            variant='danger'
            confirmLabel={t(busy ? 'working' : 'delete.button')}
            onClose={confirm}
            body={
                <div className='flex flex-col gap-lg'>
                    <p className='font-bold'>
                        {vehicle.manufacturer} {vehicle.model}
                    </p>
                    {vehicle.licensePlate && (
                        <p>
                            {t('fields.licensePlate')}: {vehicle.licensePlate}
                        </p>
                    )}
                    {vehicle.vin && (
                        <p>
                            {t('fields.vin')}: {vehicle.vin}
                        </p>
                    )}
                    <p>{t('delete.warning')}</p>
                    <ErrorMessages
                        errors={errors}
                        namespace='vehicles'
                    />
                </div>
            }
        />
    );
}
