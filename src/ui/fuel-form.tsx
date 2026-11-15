import type { FuelListSearch } from '../common/list-search';
import type { FuelLocation } from '../fuel/fuel-location-schema';
import { fuelInputLimits } from '../fuel/fuel-input-limits';
import { displayNumber } from '../common/number';
import { statisticsKeys } from '../statistics/statistics-queries';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useServerFn } from '@tanstack/react-start';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { ClientOnly, useRouter } from '@tanstack/react-router';
import { Button, Column, Flex, Grid, Page, Section, useAppForm } from '@tfilo/tope-ui';
import { FuelType } from '../generated/prisma/enums';
import type { VehicleData } from '../vehicles/vehicle.types';
import type { FuelRecordData } from '../fuel/fuel.types';
import { FuelPriceInput, fuelUnits } from '../fuel/fuel-values';
import { fuelFormSchema, fuelFormInput, type FuelFormValues } from '../fuel/fuel-form-schema';
import { fuelPricePreview, vehicleLabel } from '../fuel/fuel-format';
import { fuelTimeCandidates, localFuelTime, displayFuelTime } from '../fuel/fuel-time';
import { createFuelRecord, updateFuelRecord } from '../fuel/fuel';
import { fuelKeys } from '../fuel/fuel-queries';
import { AuthErrorCode } from '../auth/auth-errors';
import { useFuelLocation, LocationStatus } from './use-fuel-location';
import { currentUserOptions, replaceCurrentUser } from './session';
import { translatedSchema } from '../i18n/form-schema';
import { fuelErrors } from './fuel-feedback';
import { getFuelErrorKey } from '../fuel/fuel-errors';
import { ErrorMessages } from './feedback';
import { DeleteFuelDialog } from './delete-fuel-dialog';

function MapUnavailable() {
    const { t } = useTranslation('fuel');
    return <p className='text-sm'>{t('location.mapUnavailable')}</p>;
}

const LocationMap = lazy(() => import('./location-map').catch(() => ({ default: MapUnavailable })));

export function FuelForm({
    vehicles,
    vehicle,
    initial,
    defaultOccurredAt,
    returnTo
}: {
    vehicles: VehicleData[];
    vehicle: VehicleData;
    initial?: FuelRecordData;
    defaultOccurredAt: string;
    returnTo?: FuelListSearch;
}) {
    const { t } = useTranslation('fuel');
    const router = useRouter();
    const queryClient = useQueryClient();
    const create = useServerFn(createFuelRecord);
    const update = useServerFn(updateFuelRecord);
    const { data: user } = useSuspenseQuery(currentUserOptions);
    const capture = useFuelLocation(!initial && Boolean(user?.storeFuelLocation));
    const [adjustedLocation, setAdjustedLocation] = useState<FuelLocation | null>(null);
    const location = adjustedLocation ?? initial?.location ?? capture.location;

    const [errors, setErrors] = useState<string[]>([]);
    const [deleting, setDeleting] = useState(false);

    const instant = initial?.occurredAt ?? defaultOccurredAt;
    const defaultValues: FuelFormValues = {
        vehicleId: vehicle.id,
        fuelType: initial?.fuelType ?? vehicle.fuelTypes[0],
        occurredAt: localFuelTime(instant),
        timeInstant: instant,
        odometer: initial?.odometer ?? null,
        quantity: initial?.quantity ?? null,
        priceType: FuelPriceInput.TOTAL,
        priceAmount: initial?.totalPrice ?? null,
        isFull: initial?.isFull ?? true,
        previousRecordMissing: initial?.previousRecordMissing ?? false
    };

    const form = useAppForm({
        defaultValues,
        validators: { onChange: translatedSchema(fuelFormSchema, t) },
        onSubmit: async ({ value }) => {
            setErrors([]);

            try {
                const data = fuelFormInput(value);
                const result = initial
                    ? await update({
                          data: {
                              ...data,
                              recordId: initial.id,
                              ...(adjustedLocation
                                  ? { location: { latitude: adjustedLocation.latitude, longitude: adjustedLocation.longitude } }
                                  : {})
                          }
                      })
                    : await create({ data: { ...data, ...(location ? { location } : {}) } });

                if ('code' in result) {
                    setErrors(fuelErrors(result));
                    if (result.code === AuthErrorCode.AUTH_REQUIRED) await replaceCurrentUser(queryClient, null);

                    return;
                }

                await queryClient.invalidateQueries({ queryKey: fuelKeys.all });
                await queryClient.invalidateQueries({ queryKey: statisticsKeys.all });
                await router.navigate({ to: '/fuel', search: returnTo ?? { vehicleId: result.record.vehicleId } });
            } catch (error) {
                setErrors([getFuelErrorKey(error instanceof Error ? error.message : undefined)]);
            }
        }
    });

    return (
        <Page
            title={t(initial ? 'editHeading' : 'createHeading')}
            onBack={() => router.navigate({ to: '/fuel', search: returnTo ?? { vehicleId: vehicle.id } })}
        >
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
                                <form.AppField
                                    name='vehicleId'
                                    listeners={{
                                        onChange: ({ value }) => {
                                            const selected = vehicles.find((item) => item.id === value);
                                            if (selected) form.setFieldValue('fuelType', selected.fuelTypes[0]);
                                        }
                                    }}
                                >
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
                    <form.Subscribe selector={(state) => state.values.vehicleId}>
                        {(vehicleId) => {
                            const fuels = vehicles.find((item) => item.id === vehicleId)?.fuelTypes ?? [];

                            return (
                                <Grid>
                                    <Column>
                                        <form.AppField name='fuelType'>
                                            {(field) => (
                                                <field.Select
                                                    label={t('fuelType')}
                                                    required
                                                    options={fuels.map((fuel) => ({ value: fuel, label: t(`vehicles:fuels.${fuel}`) }))}
                                                />
                                            )}
                                        </form.AppField>
                                    </Column>
                                </Grid>
                            );
                        }}
                    </form.Subscribe>
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
                                        maxLength={fuelInputLimits.localDateTime}
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
                    <form.Subscribe selector={(state) => state.values.fuelType}>
                        {(fuelType) => (
                            <>
                                <Grid>
                                    <Column>
                                        <form.AppField name='quantity'>
                                            {(field) => (
                                                <field.Input
                                                    type='number'
                                                    min={0}
                                                    step='any'
                                                    label={t('quantity', { unit: fuelUnits[fuelType] })}
                                                    inputMode='decimal'
                                                    required
                                                />
                                            )}
                                        </form.AppField>
                                    </Column>
                                </Grid>
                                <Grid>
                                    <Column>
                                        <form.AppField name='isFull'>
                                            {(field) => (
                                                <field.Switch label={t(fuelType === FuelType.ELECTRIC ? 'fullCharge' : 'fullTank')} />
                                            )}
                                        </form.AppField>
                                    </Column>
                                </Grid>
                                {fuelType === FuelType.ELECTRIC && <p className='text-sm'>{t('evHelp')}</p>}
                            </>
                        )}
                    </form.Subscribe>
                    <Grid>
                        <Column>
                            <form.AppField name='previousRecordMissing'>
                                {(field) => <field.Switch label={t('previousRecordMissing')} />}
                            </form.AppField>
                        </Column>
                    </Grid>
                    <p className='text-sm'>{t('missingHelp')}</p>
                    <Grid>
                        <Column>
                            <form.AppField
                                name='priceType'
                                listeners={{
                                    onChange: ({ value }) => {
                                        const previousType = value === FuelPriceInput.TOTAL ? FuelPriceInput.UNIT : FuelPriceInput.TOTAL;
                                        const preview = fuelPricePreview(
                                            form.getFieldValue('quantity'),
                                            previousType,
                                            form.getFieldValue('priceAmount')
                                        );
                                        form.setFieldValue(
                                            'priceAmount',
                                            preview ? (value === FuelPriceInput.TOTAL ? preview.totalPrice : preview.unitPrice) : null
                                        );
                                    }
                                }}
                            >
                                {(field) => (
                                    <field.Select
                                        label={t('priceType')}
                                        options={[
                                            { value: FuelPriceInput.TOTAL, label: t('totalPrice') },
                                            { value: FuelPriceInput.UNIT, label: t('unitPriceOption') }
                                        ]}
                                    />
                                )}
                            </form.AppField>
                        </Column>
                    </Grid>
                    <form.Subscribe selector={(state) => [state.values.priceType, state.values.fuelType] as const}>
                        {([priceType, fuelType]) => (
                            <Grid>
                                <Column>
                                    <form.AppField name='priceAmount'>
                                        {(field) => (
                                            <field.Input
                                                type='number'
                                                min={0}
                                                step='any'
                                                label={t(priceType === FuelPriceInput.TOTAL ? 'totalPrice' : 'unitPrice', {
                                                    unit: fuelUnits[fuelType]
                                                })}
                                                inputMode='decimal'
                                                required
                                            />
                                        )}
                                    </form.AppField>
                                </Column>
                            </Grid>
                        )}
                    </form.Subscribe>
                    <form.Subscribe selector={(state) => state.values}>
                        {(value) => {
                            const preview = fuelPricePreview(value.quantity, value.priceType, value.priceAmount);

                            return preview ? (
                                <p role='status'>
                                    {t('pricePreview', {
                                        total: displayNumber(preview.totalPrice, 2),
                                        unitPrice: displayNumber(preview.unitPrice, 0, 6),
                                        unit: fuelUnits[value.fuelType]
                                    })}
                                </p>
                            ) : null;
                        }}
                    </form.Subscribe>
                    <ErrorMessages
                        errors={errors}
                        namespace='fuel'
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
            {!initial && capture.status === LocationStatus.LOADING && <p role='status'>{t('location.loading')}</p>}
            {!initial && capture.status === LocationStatus.UNAVAILABLE && <p role='status'>{t('location.unavailable')}</p>}
            {location && (
                <Section title={t('location.heading')}>
                    {location.manuallyAdjusted ? (
                        <p className='text-sm'>{t('location.manuallyAdjusted')}</p>
                    ) : (
                        <>
                            <p className='text-sm'>{t('location.capturedAt', { date: displayFuelTime(location.capturedAt) })}</p>
                            <p className='text-sm'>{t('location.accuracy', { metres: Math.round(location.accuracy) })}</p>
                        </>
                    )}
                    <p className='text-sm'>{t('location.dragHelp')}</p>
                    <ClientOnly>
                        <Suspense fallback={<p>{t('location.loadingMap')}</p>}>
                            <LocationMap
                                location={location}
                                onMove={(latitude, longitude) =>
                                    setAdjustedLocation({ ...location, latitude, longitude, manuallyAdjusted: true })
                                }
                            />
                        </Suspense>
                    </ClientOnly>
                    <p className='text-sm'>
                        {t('location.coordinates', { latitude: location.latitude.toFixed(6), longitude: location.longitude.toFixed(6) })}
                    </p>
                </Section>
            )}
            {initial && deleting && (
                <DeleteFuelDialog
                    record={initial}
                    onClose={() => setDeleting(false)}
                    onDeleted={() =>
                        router.navigate({ to: '/fuel', search: { ...(returnTo ?? { vehicleId: initial.vehicleId }), page: 0 } })
                    }
                />
            )}
        </Page>
    );
}
