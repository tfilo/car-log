import type { ExpenseListSearch } from '../common/list-search';
import { statisticsKeys } from '../statistics/statistics-queries';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useServerFn } from '@tanstack/react-start';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { Button, Column, Flex, Grid, Page, Section, useAppForm } from '@tfilo/tope-ui';
import type { VehicleData } from '../vehicles/vehicle.types';
import type { CategoryData, ExpenseData } from '../expenses/expense.types';
import { expenseInputLimits } from '../expenses/expense-schema';
import { expenseFormSchema, expenseFormInput, type ExpenseFormValues } from '../expenses/expense-form-schema';
import { createExpense, updateExpense } from '../expenses/expenses';
import { expenseKeys } from '../expenses/expense-queries';
import { vehicleLabel } from '../fuel/fuel-format';
import { fuelTimeCandidates, localFuelTime } from '../fuel/fuel-time';
import { AuthErrorCode } from '../auth/auth-errors';
import { replaceCurrentUser } from './session';
import { translatedSchema } from '../i18n/form-schema';
import { expenseErrors } from './expense-feedback';
import { getExpenseErrorKey } from '../expenses/expense-errors';
import { ErrorMessages } from './feedback';
import { DeleteExpenseDialog } from './delete-expense-dialog';

export function ExpenseForm({
    defaultCategoryId,
    vehicles,
    vehicle,
    categories,
    initial,
    defaultOccurredAt,
    returnTo
}: {
    vehicles: VehicleData[];
    vehicle: VehicleData;
    categories: CategoryData[];
    defaultCategoryId?: string;
    initial?: ExpenseData;
    defaultOccurredAt: string;
    returnTo?: ExpenseListSearch;
}) {
    const { t } = useTranslation('expenses');
    const router = useRouter();
    const queryClient = useQueryClient();
    const create = useServerFn(createExpense);
    const update = useServerFn(updateExpense);

    const [errors, setErrors] = useState<string[]>([]);
    const [deleting, setDeleting] = useState(false);

    const availableCategories = categories.filter((category) => !category.isArchived || category.id === initial?.categoryId);
    const instant = initial?.occurredAt ?? defaultOccurredAt;
    const defaultValues: ExpenseFormValues = {
        vehicleId: vehicle.id,
        categoryId:
            initial?.categoryId ??
            availableCategories.find((category) => category.id === defaultCategoryId)?.id ??
            availableCategories[0]?.id ??
            '',
        occurredAt: localFuelTime(instant),
        timeInstant: instant,
        odometer: initial?.odometer ?? null,
        totalPrice: initial?.totalPrice ?? null,
        comment: initial?.comment ?? ''
    };

    const form = useAppForm({
        defaultValues,
        validators: { onChange: translatedSchema(expenseFormSchema, t) },
        onSubmit: async ({ value }) => {
            setErrors([]);

            try {
                const data = expenseFormInput(value);
                const result = initial ? await update({ data: { ...data, expenseId: initial.id } }) : await create({ data });

                if ('code' in result) {
                    setErrors(expenseErrors(result));
                    if (result.code === AuthErrorCode.AUTH_REQUIRED) await replaceCurrentUser(queryClient, null);

                    return;
                }

                await queryClient.invalidateQueries({ queryKey: expenseKeys.all });
                await queryClient.invalidateQueries({ queryKey: statisticsKeys.all });
                await router.navigate({ to: '/expenses', search: returnTo ?? { vehicleId: result.expense.vehicleId } });
            } catch (error) {
                setErrors([getExpenseErrorKey(error instanceof Error ? error.message : undefined)]);
            }
        }
    });

    return (
        <Page
            title={t(initial ? 'editHeading' : 'createHeading')}
            onBack={() => router.navigate({ to: '/expenses', search: returnTo ?? { vehicleId: vehicle.id } })}
        >
            {!availableCategories.length ? (
                <>
                    <p>{t('noCategories')}</p>
                    <Button onClick={() => router.navigate({ to: '/expenses/categories' })}>{t('categories.manage')}</Button>
                </>
            ) : (
                <Section title={t('details')}>
                    <form
                        noValidate
                        className='flex flex-col gap-xl'
                        onSubmit={(event) => {
                            event.preventDefault();
                            void form.handleSubmit();
                        }}
                    >
                        {vehicles.length > 1 && (
                            <Grid>
                                <Column>
                                    <form.AppField name='vehicleId'>
                                        {(field) => (
                                            <field.Select
                                                label={t('vehicle')}
                                                required
                                                options={vehicles.map((item) => ({ value: item.id, label: vehicleLabel(item) }))}
                                            />
                                        )}
                                    </form.AppField>
                                </Column>
                            </Grid>
                        )}
                        <Grid>
                            <Column>
                                <form.AppField name='categoryId'>
                                    {(field) => (
                                        <field.Select
                                            label={t('category')}
                                            required
                                            options={availableCategories.map((category) => ({
                                                value: category.id,
                                                label: category.isArchived ? t('archivedLabel', { name: category.name }) : category.name
                                            }))}
                                        />
                                    )}
                                </form.AppField>
                            </Column>
                        </Grid>
                        {initial?.categoryArchived && <p className='text-sm'>{t('archivedHelp')}</p>}
                        <Grid>
                            <Column>
                                <form.AppField
                                    name='occurredAt'
                                    listeners={{ onChange: () => form.setFieldValue('timeInstant', '') }}
                                >
                                    {(field) => (
                                        <field.DateTimeInput
                                            type='dateTime'
                                            label={t('occurredAt')}
                                            maxLength={expenseInputLimits.localDateTime}
                                            required
                                        />
                                    )}
                                </form.AppField>
                            </Column>
                        </Grid>
                        <p className='text-sm'>{t('timeHelp')}</p>
                        <form.Subscribe selector={(state) => state.values.occurredAt}>
                            {(local) => {
                                const candidates = fuelTimeCandidates(local);

                                return candidates.length > 1 ? (
                                    <Grid>
                                        <Column>
                                            <form.AppField name='timeInstant'>
                                                {(field) => (
                                                    <field.Select
                                                        label={t('timeChoice')}
                                                        required
                                                        options={candidates.map((candidate, index) => ({
                                                            value:
                                                                localFuelTime(instant) === local &&
                                                                candidate.slice(0, 19) === instant.slice(0, 19)
                                                                    ? instant
                                                                    : candidate,
                                                            label: t('timeOccurrence', { count: index + 1 })
                                                        }))}
                                                    />
                                                )}
                                            </form.AppField>
                                        </Column>
                                    </Grid>
                                ) : null;
                            }}
                        </form.Subscribe>
                        <Grid>
                            <Column>
                                <form.AppField name='odometer'>
                                    {(field) => (
                                        <field.Input
                                            type='number'
                                            min={0}
                                            step='any'
                                            label={t('odometer')}
                                            inputMode='decimal'
                                            required
                                        />
                                    )}
                                </form.AppField>
                            </Column>
                        </Grid>
                        <Grid>
                            <Column>
                                <form.AppField name='totalPrice'>
                                    {(field) => (
                                        <field.Input
                                            type='number'
                                            min={0}
                                            step='any'
                                            label={t('totalPrice')}
                                            inputMode='decimal'
                                            required
                                        />
                                    )}
                                </form.AppField>
                            </Column>
                        </Grid>
                        <Grid>
                            <Column>
                                <form.AppField name='comment'>
                                    {(field) => (
                                        <field.TextArea
                                            label={t('comment')}
                                            maxLength={expenseInputLimits.comment}
                                        />
                                    )}
                                </form.AppField>
                            </Column>
                        </Grid>
                        <ErrorMessages
                            errors={errors}
                            namespace='expenses'
                        />
                        <form.AppForm>
                            <form.Subscribe selector={(state) => state.isSubmitting}>
                                {(busy) => (
                                    <Flex justify='between'>
                                        <form.SubscribeButton>{t(busy ? 'working' : 'save')}</form.SubscribeButton>
                                        {initial && (
                                            <Button
                                                variant='danger'
                                                disabled={busy}
                                                onClick={() => setDeleting(true)}
                                            >
                                                {t('deleteRecord')}
                                            </Button>
                                        )}
                                    </Flex>
                                )}
                            </form.Subscribe>
                        </form.AppForm>
                    </form>
                </Section>
            )}
            {initial && deleting && (
                <DeleteExpenseDialog
                    expense={initial}
                    onClose={() => setDeleting(false)}
                    onDeleted={() =>
                        router.navigate({ to: '/expenses', search: { ...(returnTo ?? { vehicleId: initial.vehicleId }), page: 0 } })
                    }
                />
            )}
        </Page>
    );
}
