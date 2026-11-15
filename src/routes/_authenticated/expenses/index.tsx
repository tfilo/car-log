import { expenseListSearchSchema } from '../../../common/list-search';
import { displayNumber } from '../../../common/number';
/* eslint-disable react-refresh/only-export-components */
import { useCallback, useRef, useState, type ComponentProps, type RefObject } from 'react';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Column, Grid, Page, Table, createColumns, useAppForm } from '@tfilo/tope-ui';
import { TrashIcon } from '@heroicons/react/16/solid';
import { currentUserOptions, replaceCurrentUser } from '../../../ui/session';
import { AuthErrorCode } from '../../../auth/auth-errors';
import { expenseCategoriesOptions, expenseListOptions } from '../../../expenses/expense-queries';
import { fuelVehiclesOptions } from '../../../fuel/fuel-queries';
import type { VehicleData } from '../../../vehicles/vehicle.types';
import type { CategoryData, ExpenseData } from '../../../expenses/expense.types';
import { vehicleLabel } from '../../../fuel/fuel-format';
import { displayFuelTime } from '../../../fuel/fuel-time';
import { DeleteExpenseDialog } from '../../../ui/delete-expense-dialog';
import { MobileTableRow, TableRowMenu } from '../../../ui/mobile-table-row';
import { ErrorMessages } from '../../../ui/feedback';

type ExpenseRow = Omit<ExpenseData, 'comment'> & { comment: string };

const CategoryFilter = { ALL: 'all' } as const;

export const Route = createFileRoute('/_authenticated/expenses/')({
    validateSearch: expenseListSearchSchema,
    loaderDeps: ({ search }) => search,
    loader: async ({ context, deps }) => {
        const [vehicles] = await Promise.all([
            context.queryClient.query(fuelVehiclesOptions(context.user.id)),
            context.queryClient.query(expenseCategoriesOptions(context.user.id))
        ]);
        const vehicle = deps.vehicleId ? vehicles.find((item) => item.id === deps.vehicleId) : vehicles[0];

        if (vehicle) {
            await context.queryClient.query(
                expenseListOptions(context.user.id, {
                    vehicleId: vehicle.id,
                    categoryId: deps.categoryId,
                    page: deps.page ?? 0,
                    pageSize: 25
                })
            );
        }
    },
    component: ExpensesPage
});

function ExpensesPage() {
    const { t } = useTranslation('expenses');
    const router = useRouter();
    const { data: user } = useSuspenseQuery(currentUserOptions);
    const { data: vehicles } = useSuspenseQuery(fuelVehiclesOptions(user?.id ?? ''));
    const { data: categories } = useSuspenseQuery(expenseCategoriesOptions(user?.id ?? ''));
    const search = Route.useSearch();
    const pageRef = useRef(search.page ?? 0);
    const vehicle = search.vehicleId ? vehicles.find((item) => item.id === search.vehicleId) : vehicles[0];

    return (
        <Page title={t('heading')}>
            <div className='flex flex-wrap gap-md'>
                {vehicle && (
                    <Button
                        onClick={() =>
                            router.navigate({
                                to: '/expenses/new',
                                search: {
                                    vehicleId: vehicle.id,
                                    categoryId: search.categoryId,
                                    returnTo: { vehicleId: vehicle.id, categoryId: search.categoryId, page: pageRef.current }
                                }
                            })
                        }
                    >
                        {t('add')}
                    </Button>
                )}
                <Button
                    variant='secondary'
                    onClick={() => router.navigate({ to: '/expenses/categories' })}
                >
                    {t('categories.manage')}
                </Button>
            </div>
            {!vehicles.length ? (
                <>
                    <p>{t('noVehicles')}</p>
                    <Button onClick={() => router.navigate({ to: '/vehicles/new' })}>{t('addVehicle')}</Button>
                </>
            ) : !vehicle ? (
                <>
                    <ErrorMessages
                        namespace='expenses'
                        errors={['errors.vehicleNotFound']}
                    />
                    <Button onClick={() => router.navigate({ to: '/expenses', search: {} })}>{t('chooseVehicle')}</Button>
                </>
            ) : (
                <ExpenseHistory
                    key={`${vehicle.id}:${search.categoryId ?? ''}:${search.page ?? 0}`}
                    initialPage={search.page ?? 0}
                    pageRef={pageRef}
                    vehicle={vehicle}
                    vehicles={vehicles}
                    categories={categories}
                    categoryId={search.categoryId}
                    userId={user?.id ?? ''}
                />
            )}
        </Page>
    );
}

function ExpenseHistory({
    vehicle,
    vehicles,
    categories,
    categoryId,
    userId,
    initialPage,
    pageRef
}: {
    vehicle: VehicleData;
    vehicles: VehicleData[];
    categories: CategoryData[];
    categoryId?: string;
    userId: string;
    initialPage: number;
    pageRef: RefObject<number>;
}) {
    const { t } = useTranslation('expenses');
    const router = useRouter();
    const queryClient = useQueryClient();

    const [revision, setRevision] = useState(0);
    const [total, setTotal] = useState<number | null>(null);
    const [selected, setSelected] = useState<ExpenseData | null>(null);

    const filters = useAppForm({ defaultValues: { vehicleId: vehicle.id, categoryId: categoryId ?? CategoryFilter.ALL } });

    const onFetch = useCallback<NonNullable<ComponentProps<typeof Table<ExpenseRow>>['onFetch']>>(
        async (page, pageSize, _sort, signal) => {
            try {
                let result = await queryClient.query(expenseListOptions(userId, { vehicleId: vehicle.id, categoryId, page, pageSize }));
                const lastPage = Math.max(0, Math.ceil(result.total / pageSize) - 1);

                if (page > lastPage) {
                    result = await queryClient.query(
                        expenseListOptions(userId, { vehicleId: vehicle.id, categoryId, page: lastPage, pageSize })
                    );
                }

                if (!signal?.aborted) {
                    pageRef.current = result.page;
                    setTotal(result.total);
                }

                return {
                    data: result.expenses.map((expense) => ({ ...expense, comment: expense.comment ?? '' })),
                    page: result.page,
                    pageSize: result.pageSize,
                    totalRecords: result.total
                };
            } catch (error) {
                if (error instanceof Error && error.message === AuthErrorCode.AUTH_REQUIRED) await replaceCurrentUser(queryClient, null);

                throw error;
            }
        },
        [queryClient, userId, vehicle.id, categoryId, pageRef]
    );

    const columns = createColumns<ExpenseRow>([
        { header: t('occurredAt'), accessor: 'occurredAt', formatter: displayFuelTime },
        {
            header: t('category'),
            accessor: 'categoryName',
            cell: (expense) => (expense.categoryArchived ? t('archivedLabel', { name: expense.categoryName }) : expense.categoryName)
        },
        { header: t('odometer'), accessor: 'odometer', formatter: (value) => displayNumber(value, 0, 3) },
        { header: t('totalPrice'), accessor: 'totalPrice', formatter: (value) => `${displayNumber(value, 2)} €` },
        {
            header: t('comment'),
            accessor: 'comment',
            cell: (expense) => <span className='wrap-break-word whitespace-pre-wrap'>{expense.comment ?? ''}</span>
        },
        {
            header: t('actions'),
            accessor: 'id',
            additionalClassName: 'w-none whitespace-nowrap border-l text-right sticky right-none bg-white shadow-lg shadow-secondary-light',
            cell: (expense) => (
                <div className='ml-auto flex w-max justify-end gap-sm'>
                    <Button
                        icon={TrashIcon}
                        showChildren={false}
                        variant='danger'
                        onClick={() => setSelected(expense)}
                    >
                        {t('deleteRecord')}
                    </Button>
                </div>
            )
        }
    ]);

    return (
        <>
            <Grid>
                {vehicles.length > 1 && (
                    <Column>
                        <filters.AppField
                            name='vehicleId'
                            listeners={{
                                onChange: ({ value }) => {
                                    void router.navigate({ to: '/expenses', search: { vehicleId: value, categoryId } });
                                }
                            }}
                        >
                            {(field) => (
                                <field.Select
                                    label={t('vehicle')}
                                    options={vehicles.map((item) => ({ value: item.id, label: vehicleLabel(item) }))}
                                />
                            )}
                        </filters.AppField>
                    </Column>
                )}
                <Column>
                    <filters.AppField
                        name='categoryId'
                        listeners={{
                            onChange: ({ value }) => {
                                void router.navigate({
                                    to: '/expenses',
                                    search: { vehicleId: vehicle.id, categoryId: value === CategoryFilter.ALL ? undefined : value }
                                });
                            }
                        }}
                    >
                        {(field) => (
                            <field.Select
                                label={t('categoryFilter')}
                                options={[
                                    { value: CategoryFilter.ALL, label: t('allCategories') },
                                    ...categories.map((category) => ({
                                        value: category.id,
                                        label: category.isArchived ? t('archivedLabel', { name: category.name }) : category.name
                                    }))
                                ]}
                            />
                        )}
                    </filters.AppField>
                </Column>
            </Grid>
            <p className='text-sm'>{t('historyHelp')}</p>
            {total === 0 && <p role='status'>{t('empty')}</p>}
            <Table
                key={revision}
                columns={columns}
                onFetch={onFetch}
                pageSize={25}
                initialPage={initialPage}
                onRowClick={(expense) =>
                    router.navigate({
                        to: '/expenses/$expenseId',
                        params: { expenseId: expense.id },
                        search: { returnTo: { vehicleId: vehicle.id, categoryId, page: pageRef.current } }
                    })
                }
                renderMobileRow={(expense) => (
                    <MobileTableRow
                        title={expense.categoryArchived ? t('archivedLabel', { name: expense.categoryName }) : expense.categoryName}
                        value={`${displayNumber(expense.totalPrice, 2)} €`}
                        actions={
                            <TableRowMenu
                                label={t('actions')}
                                options={[{ label: t('deleteRecord'), icon: TrashIcon, onClick: () => setSelected(expense) }]}
                            />
                        }
                    >
                        <p className='text-secondary'>{displayFuelTime(expense.occurredAt)}</p>
                        <p>{displayNumber(expense.odometer, 0, 3)} km</p>
                        {expense.comment && <p className='whitespace-pre-wrap'>{expense.comment}</p>}
                    </MobileTableRow>
                )}
            />
            {selected && (
                <DeleteExpenseDialog
                    expense={selected}
                    onClose={() => setSelected(null)}
                    onDeleted={async () => {
                        pageRef.current = 0;
                        await router.navigate({ to: '/expenses', search: { vehicleId: vehicle.id, categoryId, page: 0 }, replace: true });
                        setSelected(null);
                        setRevision((value) => value + 1);
                    }}
                />
            )}
        </>
    );
}
