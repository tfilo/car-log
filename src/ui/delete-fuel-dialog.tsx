import { displayNumber } from '../common/number';
import { statisticsKeys } from '../statistics/statistics-queries';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useServerFn } from '@tanstack/react-start';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@tfilo/tope-ui';
import { deleteFuelRecord } from '../fuel/fuel';
import type { FuelRecordData } from '../fuel/fuel.types';
import { fuelKeys } from '../fuel/fuel-queries';
import { displayFuelTime } from '../fuel/fuel-time';
import { ResultKind } from '../common/result-kind';
import { AuthErrorCode } from '../auth/auth-errors';
import { replaceCurrentUser } from './session';
import { fuelErrors } from './fuel-feedback';
import { getFuelErrorKey } from '../fuel/fuel-errors';
import { ErrorMessages } from './feedback';

export type FuelDeleteDetails = Pick<
    FuelRecordData,
    'id' | 'vehicleId' | 'occurredAt' | 'fuelType' | 'quantity' | 'quantityUnit' | 'totalPrice'
>;

export function DeleteFuelDialog({
    record,
    onClose,
    onDeleted
}: {
    record: FuelDeleteDetails;
    onClose: () => void;
    onDeleted: () => void | Promise<void>;
}) {
    const { t } = useTranslation('fuel');
    const queryClient = useQueryClient();
    const remove = useServerFn(deleteFuelRecord);

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
            const result = await remove({ data: { recordId: record.id, confirmed: true } });

            if (result.kind !== ResultKind.DELETED) {
                setErrors(fuelErrors(result));
                if (result.code === AuthErrorCode.AUTH_REQUIRED) await replaceCurrentUser(queryClient, null);

                return;
            }

            await queryClient.invalidateQueries({ queryKey: fuelKeys.all });
            await queryClient.invalidateQueries({ queryKey: statisticsKeys.all });
            await onDeleted();
        } catch (error) {
            setErrors([getFuelErrorKey(error instanceof Error ? error.message : undefined)]);
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal
            openModal
            title={t('deleteHeading')}
            aria-label={t('deleteHeading')}
            variant='danger'
            confirmLabel={t(busy ? 'working' : 'deleteRecord')}
            onClose={confirm}
            body={
                <div className='flex flex-col gap-lg'>
                    <p className='font-bold'>
                        {displayFuelTime(record.occurredAt)} · {t(`vehicles:fuels.${record.fuelType}`)}
                    </p>
                    <p>
                        {displayNumber(record.quantity, 0, 3)} {record.quantityUnit} · {displayNumber(record.totalPrice, 2)} €
                    </p>
                    <p>{t('deleteWarning')}</p>
                    <ErrorMessages
                        errors={errors}
                        namespace='fuel'
                    />
                </div>
            }
        />
    );
}
