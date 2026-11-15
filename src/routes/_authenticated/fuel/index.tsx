import { fuelListSearchSchema } from '../../../common/list-search';
import { displayNumber } from '../../../common/number';
/* eslint-disable react-refresh/only-export-components */
import { useCallback, useRef, useState, type ComponentProps } from 'react';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Column, Grid, Page, Table, createColumns, useAppForm } from '@tfilo/tope-ui';
import { TrashIcon } from '@heroicons/react/16/solid';
import { FuelType } from '../../../generated/prisma/enums';
import { currentUserOptions, replaceCurrentUser } from '../../../ui/session';
import { AuthErrorCode } from '../../../auth/auth-errors';
import { fuelVehiclesOptions, fuelListOptions } from '../../../fuel/fuel-queries';
import type { VehicleData } from '../../../vehicles/vehicle.types';
import type { FuelRecordData } from '../../../fuel/fuel.types';
import { vehicleLabel } from '../../../fuel/fuel-format';
import { displayFuelTime } from '../../../fuel/fuel-time';
import { DeleteFuelDialog, type FuelDeleteDetails } from '../../../ui/delete-fuel-dialog';
import { MobileTableRow, TableRowMenu } from '../../../ui/mobile-table-row';
import { ErrorMessages } from '../../../ui/feedback';

const FuelFilter = { ALL: 'all' } as const;

export const Route = createFileRoute('/_authenticated/fuel/')({
    validateSearch: fuelListSearchSchema,
    loaderDeps: ({ search }) => search,
    loader: async ({ context, deps }) => {
        const vehicles = await context.queryClient.query(fuelVehiclesOptions(context.user.id));
        const vehicle = deps.vehicleId ? vehicles.find((item) => item.id === deps.vehicleId) : vehicles[0];

        if (vehicle) {
            await context.queryClient.query(
                fuelListOptions(context.user.id, {
                    vehicleId: vehicle.id,
                    fuelType: vehicle.fuelTypes.length > 1 ? deps.fuelType : undefined,
                    page: deps.page ?? 0,
                    pageSize: 25
                })
            );
        }
    },
    component: FuelPage
});

type FuelRow = Pick<
    FuelRecordData,
    | 'id'
    | 'vehicleId'
    | 'fuelType'
    | 'occurredAt'
    | 'odometer'
    | 'quantity'
    | 'quantityUnit'
    | 'totalPrice'
    | 'unitPrice'
    | 'isFull'
    | 'previousRecordMissing'
> & { consumption: number | undefined };

function row(record: FuelRecordData): FuelRow {
    return {
        id: record.id,
        vehicleId: record.vehicleId,
        fuelType: record.fuelType,
        occurredAt: record.occurredAt,
        odometer: record.odometer,
        quantity: record.quantity,
        quantityUnit: record.quantityUnit,
        totalPrice: record.totalPrice,
        unitPrice: record.unitPrice,
        isFull: record.isFull,
        previousRecordMissing: record.previousRecordMissing,
        consumption: record.consumptionPer100Km ?? undefined
    };
}

function FuelPage() {
    const { t } = useTranslation('fuel');
    const router = useRouter();
    const { data: user } = useSuspenseQuery(currentUserOptions);
    const { data: vehicles } = useSuspenseQuery(fuelVehiclesOptions(user?.id ?? ''));
    const search = Route.useSearch();
    const vehicle = search.vehicleId ? vehicles.find((item) => item.id === search.vehicleId) : vehicles[0];
    const fuelType = vehicle && vehicle.fuelTypes.length > 1 ? search.fuelType : undefined;

    return (
        <Page title={t('heading')}>
            {!vehicles.length ? (
                <>
                    <p>{t('noVehicles')}</p>
                    <Button onClick={() => router.navigate({ to: '/vehicles/new' })}>{t('addVehicle')}</Button>
                </>
            ) : !vehicle ? (
                <>
                    <ErrorMessages
                        namespace='fuel'
                        errors={['errors.vehicleNotFound']}
                    />
                    <Button onClick={() => router.navigate({ to: '/fuel', search: {} })}>{t('chooseVehicle')}</Button>
                </>
            ) : (
                <FuelHistory
                    key={`${vehicle.id}:${fuelType ?? ''}:${search.page ?? 0}`}
                    initialPage={search.page ?? 0}
                    vehicle={vehicle}
                    vehicles={vehicles}
                    fuelType={fuelType}
                    userId={user?.id ?? ''}
                />
            )}
        </Page>
    );
}

function FuelHistory({
    vehicle,
    vehicles,
    fuelType,
    userId,
    initialPage
}: {
    vehicle: VehicleData;
    vehicles: VehicleData[];
    fuelType?: FuelType;
    userId: string;
    initialPage: number;
}) {
    const { t } = useTranslation('fuel');
    const router = useRouter();
    const queryClient = useQueryClient();

    const pageRef = useRef(initialPage);

    const [revision, setRevision] = useState(0);
    const [total, setTotal] = useState<number | null>(null);
    const [selected, setSelected] = useState<FuelDeleteDetails | null>(null);

    const filterValues: { vehicleId: string; fuelType: FuelType | typeof FuelFilter.ALL } = {
        vehicleId: vehicle.id,
        fuelType: fuelType ?? FuelFilter.ALL
    };
    const filters = useAppForm({ defaultValues: filterValues });

    const onFetch = useCallback<NonNullable<ComponentProps<typeof Table<FuelRow>>['onFetch']>>(
        async (page, pageSize, _sort, signal) => {
            try {
                let result = await queryClient.query(fuelListOptions(userId, { vehicleId: vehicle.id, fuelType, page, pageSize }));
                const lastPage = Math.max(0, Math.ceil(result.total / pageSize) - 1);

                if (page > lastPage) {
                    result = await queryClient.query(
                        fuelListOptions(userId, { vehicleId: vehicle.id, fuelType, page: lastPage, pageSize })
                    );
                }

                if (!signal?.aborted) {
                    pageRef.current = result.page;
                    setTotal(result.total);
                }

                return { data: result.records.map(row), page: result.page, pageSize: result.pageSize, totalRecords: result.total };
            } catch (error) {
                if (error instanceof Error && error.message === AuthErrorCode.AUTH_REQUIRED) await replaceCurrentUser(queryClient, null);

                throw error;
            }
        },
        [queryClient, userId, vehicle.id, fuelType]
    );

    const columns = createColumns<FuelRow>([
        { header: t('occurredAt'), accessor: 'occurredAt', formatter: displayFuelTime },
        {
            header: t('quantityHeading'),
            accessor: 'quantity',
            cell: (record) => `${displayNumber(record.quantity, 0, 3)} ${record.quantityUnit}`
        },
        { header: t('totalPrice'), accessor: 'totalPrice', formatter: (value) => `${displayNumber(value, 2)} €` },
        {
            header: t('unitPriceOption'),
            accessor: 'unitPrice',
            cell: (record) => `${displayNumber(record.unitPrice)} €/${record.quantityUnit}`
        },
        {
            header: t('consumption'),
            accessor: 'consumption',
            cell: (record) =>
                record.consumption !== undefined ? `${displayNumber(record.consumption)} ${record.quantityUnit}/100 km` : t('unavailable')
        },
        { header: t('fuelType'), accessor: 'fuelType', formatter: (type) => t(`vehicles:fuels.${type}`) },
        { header: t('odometer'), accessor: 'odometer', formatter: (value) => displayNumber(value, 0, 3) },
        { header: t('fullHeading'), accessor: 'isFull', formatter: (value) => t(value ? 'auth:common.yes' : 'auth:common.no') },
        {
            header: t('previousRecordMissing'),
            accessor: 'previousRecordMissing',
            formatter: (value) => t(value ? 'auth:common.yes' : 'auth:common.no')
        },
        {
            header: t('actions'),
            accessor: 'id',
            additionalClassName: 'w-none whitespace-nowrap border-l text-right sticky right-none bg-white shadow-lg shadow-secondary-light',
            cell: (record) => (
                <div className='ml-auto flex w-max justify-end gap-sm'>
                    <Button
                        icon={TrashIcon}
                        showChildren={false}
                        variant='danger'
                        onClick={() => setSelected(record)}
                    >
                        {t('deleteRecord')}
                    </Button>
                </div>
            )
        }
    ]);

    return (
        <>
            <Button
                onClick={() =>
                    router.navigate({
                        to: '/fuel/new',
                        search: { vehicleId: vehicle.id, returnTo: { vehicleId: vehicle.id, fuelType, page: pageRef.current } }
                    })
                }
            >
                {t('add')}
            </Button>
            {(vehicles.length > 1 || vehicle.fuelTypes.length > 1) && (
                <Grid>
                    {vehicles.length > 1 && (
                        <Column>
                            <filters.AppField
                                name='vehicleId'
                                listeners={{
                                    onChange: ({ value }) => {
                                        void router.navigate({ to: '/fuel', search: { vehicleId: value } });
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
                    {vehicle.fuelTypes.length > 1 && (
                        <Column>
                            <filters.AppField
                                name='fuelType'
                                listeners={{
                                    onChange: ({ value }) => {
                                        void router.navigate({
                                            to: '/fuel',
                                            search: { vehicleId: vehicle.id, fuelType: value === FuelFilter.ALL ? undefined : value }
                                        });
                                    }
                                }}
                            >
                                {(field) => (
                                    <field.Select
                                        label={t('fuelFilter')}
                                        options={[
                                            { value: FuelFilter.ALL, label: t('allFuels') },
                                            ...vehicle.fuelTypes.map((type) => ({ value: type, label: t(`vehicles:fuels.${type}`) }))
                                        ]}
                                    />
                                )}
                            </filters.AppField>
                        </Column>
                    )}
                </Grid>
            )}
            <p className='text-sm'>{t('historyHelp')}</p>
            {total === 0 && <p role='status'>{t('empty')}</p>}
            <Table
                key={revision}
                columns={columns}
                onFetch={onFetch}
                pageSize={25}
                initialPage={initialPage}
                onRowClick={(record) =>
                    router.navigate({
                        to: '/fuel/$recordId',
                        params: { recordId: record.id },
                        search: { returnTo: { vehicleId: vehicle.id, fuelType, page: pageRef.current } }
                    })
                }
                renderMobileRow={(record) => (
                    <MobileTableRow
                        title={`${t(`vehicles:fuels.${record.fuelType}`)} · ${displayNumber(record.quantity, 0, 3)} ${record.quantityUnit}`}
                        value={`${displayNumber(record.totalPrice, 2)} €`}
                        actions={
                            <TableRowMenu
                                label={t('actions')}
                                options={[{ label: t('deleteRecord'), icon: TrashIcon, onClick: () => setSelected(record) }]}
                            />
                        }
                    >
                        <p className='text-secondary'>{displayFuelTime(record.occurredAt)}</p>
                        <p>
                            {displayNumber(record.odometer, 0, 3)} km ·{' '}
                            {t(record.isFull ? (record.fuelType === FuelType.ELECTRIC ? 'fullCharge' : 'fullTank') : 'partialFill')}
                        </p>
                        <p className='text-secondary'>
                            {t('unitPriceOption')}: {displayNumber(record.unitPrice)} €/{record.quantityUnit}
                        </p>
                        {record.previousRecordMissing && <p className='text-secondary'>{t('previousRecordMissing')}</p>}
                        {record.consumption !== undefined && (
                            <p className='text-secondary'>
                                {t('consumption')}: {displayNumber(record.consumption, 0, 2)} {record.quantityUnit}/100 km
                            </p>
                        )}
                    </MobileTableRow>
                )}
            />
            {selected && (
                <DeleteFuelDialog
                    record={selected}
                    onClose={() => setSelected(null)}
                    onDeleted={async () => {
                        pageRef.current = 0;
                        await router.navigate({ to: '/fuel', search: { vehicleId: vehicle.id, fuelType, page: 0 }, replace: true });
                        setSelected(null);
                        setRevision((value) => value + 1);
                    }}
                />
            )}
        </>
    );
}
