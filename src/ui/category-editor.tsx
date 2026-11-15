import type { z } from 'zod';
import { statisticsKeys } from '../statistics/statistics-queries';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useServerFn } from '@tanstack/react-start';
import { useQueryClient } from '@tanstack/react-query';
import { Column, Grid, Modal, useAppForm } from '@tfilo/tope-ui';
import type { CategoryData } from '../expenses/expense.types';
import { categorySchema, expenseInputLimits } from '../expenses/expense-schema';
import { createExpenseCategory, updateExpenseCategory } from '../expenses/expenses';
import { expenseKeys } from '../expenses/expense-queries';
import { AuthErrorCode } from '../auth/auth-errors';
import { replaceCurrentUser } from './session';
import { translatedSchema } from '../i18n/form-schema';
import { expenseErrors } from './expense-feedback';
import { getExpenseErrorKey } from '../expenses/expense-errors';
import { ErrorMessages } from './feedback';

export function CategoryEditor({
    category,
    onClose,
    onSaved
}: {
    category?: CategoryData;
    onClose: () => void;
    onSaved: () => void | Promise<void>;
}) {
    const { t } = useTranslation('expenses');
    const queryClient = useQueryClient();
    const create = useServerFn(createExpenseCategory);
    const update = useServerFn(updateExpenseCategory);

    const [errors, setErrors] = useState<string[]>([]);

    const defaultValues: z.input<typeof categorySchema> = {
        name: category?.name ?? '',
        serviceIntervalKm: category?.serviceIntervalKm ?? null,
        serviceIntervalMonths: category?.serviceIntervalMonths ?? null
    };

    const form = useAppForm({
        defaultValues,
        validators: { onChange: translatedSchema(categorySchema, t) },
        onSubmit: async ({ value }) => {
            setErrors([]);

            try {
                const result = category
                    ? await update({ data: { ...value, categoryId: category.id, isArchived: category.isArchived } })
                    : await create({ data: value });

                if ('code' in result) {
                    setErrors(expenseErrors(result));
                    if (result.code === AuthErrorCode.AUTH_REQUIRED) await replaceCurrentUser(queryClient, null);

                    return;
                }

                await queryClient.invalidateQueries({ queryKey: expenseKeys.all });
                await queryClient.invalidateQueries({ queryKey: statisticsKeys.all });
                await onSaved();
            } catch (error) {
                setErrors([getExpenseErrorKey(error instanceof Error ? error.message : undefined)]);
            }
        }
    });

    return (
        <form.Subscribe selector={(state) => state.isSubmitting}>
            {(busy) => (
                <Modal
                    openModal
                    title={t(category ? 'categories.editHeading' : 'categories.createHeading')}
                    aria-label={t(category ? 'categories.editHeading' : 'categories.createHeading')}
                    confirmLabel={t(busy ? 'working' : 'categories.save')}
                    onClose={async (confirmed) => {
                        if (busy) return;
                        if (confirmed) await form.handleSubmit();
                        else onClose();
                    }}
                    body={
                        <form
                            noValidate
                            className='flex flex-col gap-xl'
                            onSubmit={(event) => {
                                event.preventDefault();
                                if (!busy) void form.handleSubmit();
                            }}
                        >
                            <Grid maxRows={1}>
                                <Column>
                                    <form.AppField name='name'>
                                        {(field) => (
                                            <field.Input
                                                label={t('categories.name')}
                                                required
                                                maxLength={expenseInputLimits.categoryName}
                                            />
                                        )}
                                    </form.AppField>
                                </Column>
                                <Column>
                                    <form.AppField name='serviceIntervalKm'>
                                        {(field) => (
                                            <field.Input
                                                type='number'
                                                label={t('categories.serviceIntervalKm')}
                                                min={1}
                                                max={1000000}
                                                step={1}
                                            />
                                        )}
                                    </form.AppField>
                                </Column>
                                <Column>
                                    <form.AppField name='serviceIntervalMonths'>
                                        {(field) => (
                                            <field.Input
                                                type='number'
                                                label={t('categories.serviceIntervalMonths')}
                                                min={1}
                                                max={1200}
                                                step={1}
                                            />
                                        )}
                                    </form.AppField>
                                </Column>
                            </Grid>
                            <p className='text-sm'>{t('categories.serviceHelp')}</p>
                            <ErrorMessages
                                errors={errors}
                                namespace='expenses'
                            />
                        </form>
                    }
                />
            )}
        </form.Subscribe>
    );
}
