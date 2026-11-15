import { expenseReturnSearchSchema } from '../../../common/list-search';
/* eslint-disable react-refresh/only-export-components */
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Page } from '@tfilo/tope-ui';
import { fuelVehiclesOptions } from '../../../fuel/fuel-queries';
import { expenseOptions, expenseCategoriesOptions } from '../../../expenses/expense-queries';
import { currentUserOptions } from '../../../ui/session';
import { ExpenseForm } from '../../../ui/expense-form';
import { ErrorMessages } from '../../../ui/feedback';

export const Route = createFileRoute('/_authenticated/expenses/$expenseId')({
    validateSearch: expenseReturnSearchSchema,
    loader: ({ context, params }) =>
        Promise.all([
            context.queryClient.query(fuelVehiclesOptions(context.user.id)),
            context.queryClient.query(expenseCategoriesOptions(context.user.id)),
            context.queryClient.query(expenseOptions(context.user.id, params.expenseId))
        ]),
    component: EditExpensePage
});

function EditExpensePage() {
    const { t } = useTranslation('expenses');
    const router = useRouter();
    const { data: user } = useSuspenseQuery(currentUserOptions);
    const { expenseId } = Route.useParams();
    const { returnTo } = Route.useSearch();
    const { data: vehicles } = useSuspenseQuery(fuelVehiclesOptions(user?.id ?? ''));
    const { data: categories } = useSuspenseQuery(expenseCategoriesOptions(user?.id ?? ''));
    const { data: result } = useSuspenseQuery(expenseOptions(user?.id ?? '', expenseId));

    const vehicle = vehicles.find((item) => item.id === result.expense.vehicleId);

    if (!vehicle)
        return (
            <Page
                title={t('editHeading')}
                onBack={() => router.navigate({ to: '/expenses', search: returnTo ?? {} })}
            >
                <ErrorMessages
                    namespace='expenses'
                    errors={['errors.vehicleNotFound']}
                />
            </Page>
        );

    return (
        <ExpenseForm
            returnTo={returnTo}
            key={result.expense.id}
            initial={result.expense}
            vehicles={vehicles}
            vehicle={vehicle}
            categories={categories}
            defaultOccurredAt={result.expense.occurredAt}
        />
    );
}
