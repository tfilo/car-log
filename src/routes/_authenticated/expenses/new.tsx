import { expenseReturnSearchSchema } from '../../../common/list-search';
/* eslint-disable react-refresh/only-export-components */
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Page } from '@tfilo/tope-ui';
import { z } from 'zod';
import { fuelVehiclesOptions } from '../../../fuel/fuel-queries';
import { expenseCategoriesOptions } from '../../../expenses/expense-queries';
import { currentUserOptions } from '../../../ui/session';
import { ExpenseForm } from '../../../ui/expense-form';

export const Route = createFileRoute('/_authenticated/expenses/new')({
    validateSearch: expenseReturnSearchSchema.extend({
        vehicleId: z.uuid().optional().catch(undefined),
        categoryId: z.uuid().optional().catch(undefined)
    }),
    loader: async ({ context }) => {
        await Promise.all([
            context.queryClient.query(fuelVehiclesOptions(context.user.id)),
            context.queryClient.query(expenseCategoriesOptions(context.user.id))
        ]);

        return { occurredAt: new Date().toISOString() };
    },
    component: NewExpensePage
});

function NewExpensePage() {
    const { t } = useTranslation('expenses');
    const router = useRouter();
    const { data: user } = useSuspenseQuery(currentUserOptions);
    const { data: vehicles } = useSuspenseQuery(fuelVehiclesOptions(user?.id ?? ''));
    const { data: categories } = useSuspenseQuery(expenseCategoriesOptions(user?.id ?? ''));
    const { vehicleId, categoryId, returnTo } = Route.useSearch();
    const { occurredAt } = Route.useLoaderData();
    const vehicle = vehicleId ? vehicles.find((item) => item.id === vehicleId) : vehicles[0];

    if (!vehicle)
        return (
            <Page
                title={t('createHeading')}
                onBack={() => router.navigate({ to: '/expenses', search: returnTo ?? {} })}
            >
                <p>{t(vehicles.length ? 'errors.vehicleNotFound' : 'noVehicles')}</p>
                {!vehicles.length && <Button onClick={() => router.navigate({ to: '/vehicles/new' })}>{t('addVehicle')}</Button>}
            </Page>
        );

    return (
        <ExpenseForm
            returnTo={returnTo}
            vehicles={vehicles}
            vehicle={vehicle}
            categories={categories}
            defaultCategoryId={categoryId}
            defaultOccurredAt={occurredAt}
        />
    );
}
