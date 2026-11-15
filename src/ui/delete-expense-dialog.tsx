import { displayNumber } from '../common/number';
import { statisticsKeys } from '../statistics/statistics-queries';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useServerFn } from '@tanstack/react-start';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@tfilo/tope-ui';
import { deleteExpense } from '../expenses/expenses';
import type { ExpenseData } from '../expenses/expense.types';
import { expenseKeys } from '../expenses/expense-queries';
import { displayFuelTime } from '../fuel/fuel-time';
import { AuthErrorCode } from '../auth/auth-errors';
import { ResultKind } from '../common/result-kind';
import { replaceCurrentUser } from './session';
import { expenseErrors } from './expense-feedback';
import { getExpenseErrorKey } from '../expenses/expense-errors';
import { ErrorMessages } from './feedback';

export function DeleteExpenseDialog({
    expense,
    onClose,
    onDeleted
}: {
    expense: ExpenseData;
    onClose: () => void;
    onDeleted: () => void | Promise<void>;
}) {
    const { t } = useTranslation('expenses');
    const queryClient = useQueryClient();
    const remove = useServerFn(deleteExpense);

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
            const result = await remove({ data: { expenseId: expense.id, confirmed: true } });

            if (result.kind !== ResultKind.DELETED) {
                setErrors(expenseErrors(result));
                if (result.code === AuthErrorCode.AUTH_REQUIRED) await replaceCurrentUser(queryClient, null);

                return;
            }

            await queryClient.invalidateQueries({ queryKey: expenseKeys.all });
            await queryClient.invalidateQueries({ queryKey: statisticsKeys.all });
            await onDeleted();
        } catch (error) {
            setErrors([getExpenseErrorKey(error instanceof Error ? error.message : undefined)]);
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
                        {expense.categoryName} · {displayFuelTime(expense.occurredAt)}
                    </p>
                    <p>{displayNumber(expense.totalPrice, 2)} €</p>
                    <p>{t('deleteWarning')}</p>
                    <ErrorMessages
                        errors={errors}
                        namespace='expenses'
                    />
                </div>
            }
        />
    );
}
