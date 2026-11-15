import { statisticsKeys } from '../statistics/statistics-queries';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useServerFn } from '@tanstack/react-start';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '@tfilo/tope-ui';
import { deleteExpenseCategory } from '../expenses/expenses';
import type { CategoryData } from '../expenses/expense.types';
import { expenseKeys } from '../expenses/expense-queries';
import { AuthErrorCode } from '../auth/auth-errors';
import { ResultKind } from '../common/result-kind';
import { replaceCurrentUser } from './session';
import { expenseErrors } from './expense-feedback';
import { getExpenseErrorKey } from '../expenses/expense-errors';
import { ErrorMessages } from './feedback';

export function DeleteCategoryDialog({
    category,
    onClose,
    onDeleted
}: {
    category: CategoryData;
    onClose: () => void;
    onDeleted: () => void | Promise<void>;
}) {
    const { t } = useTranslation('expenses');
    const queryClient = useQueryClient();
    const remove = useServerFn(deleteExpenseCategory);

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
            const result = await remove({ data: { categoryId: category.id, confirmed: true } });

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
            title={t('categories.deleteHeading')}
            aria-label={t('categories.deleteHeading')}
            variant='danger'
            confirmLabel={t(busy ? 'working' : 'categories.delete')}
            onClose={confirm}
            body={
                <div className='flex flex-col gap-lg'>
                    <p className='font-bold'>{category.name}</p>
                    <p>{t('categories.deleteWarning')}</p>
                    <ErrorMessages
                        errors={errors}
                        namespace='expenses'
                    />
                </div>
            }
        />
    );
}
