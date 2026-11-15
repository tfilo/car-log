import { statisticsKeys } from '../statistics/statistics-queries';
import { expenseKeys } from '../expenses/expense-queries';
import { fuelKeys } from '../fuel/fuel-queries';
import { useState } from 'react';
import type { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useServerFn } from '@tanstack/react-start';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { Button, Column, Flex, Grid, Page, Section, useAppForm } from '@tfilo/tope-ui';
import { FuelType } from '../generated/prisma/enums';
import { AuthErrorCode } from '../auth/auth-errors';
import { HttpMethod } from '../common/http';
import { createVehicle, updateVehicle } from '../vehicles/vehicles';
import { vehicleFormSchema } from '../vehicles/vehicle-form-schema';
import type { VehicleData } from '../vehicles/vehicle.types';
import { vehicleKeys } from '../vehicles/vehicle-queries';
import { getVehicleErrorKey } from '../vehicles/vehicle-errors';
import { pictureAccept } from '../vehicles/picture-policy';
import { translatedSchema } from '../i18n/form-schema';
import { replaceCurrentUser } from './session';
import { vehicleErrors } from './vehicle-feedback';
import { ErrorMessages } from './feedback';
import { DeleteVehicleDialog } from './delete-vehicle-dialog';

function values(vehicle?: VehicleData): z.input<typeof vehicleFormSchema> {
    return {
        manufacturer: vehicle?.manufacturer ?? '',
        model: vehicle?.model ?? '',
        licensePlate: vehicle?.licensePlate ?? '',
        vin: vehicle?.vin ?? '',
        color: vehicle?.color ?? '',
        registrationDate: vehicle?.registrationDate ?? '',
        fuelTypes: vehicle?.fuelTypes ?? [],
        picture: null
    };
}

export function VehicleForm({ initial }: { initial?: VehicleData }) {
    const { t } = useTranslation('vehicles');
    const create = useServerFn(createVehicle);
    const update = useServerFn(updateVehicle);
    const queryClient = useQueryClient();
    const router = useRouter();

    const [vehicle, setVehicle] = useState(initial);
    const [errors, setErrors] = useState<string[]>([]);
    const [deleting, setDeleting] = useState(false);
    const [pictureFailed, setPictureFailed] = useState(false);
    const [removingPicture, setRemovingPicture] = useState(false);

    const form = useAppForm({
        defaultValues: values(initial),
        validators: { onChange: translatedSchema(vehicleFormSchema, t) },
        onSubmit: async ({ value, formApi }) => {
            setErrors([]);
            setPictureFailed(false);

            try {
                const data = {
                    manufacturer: value.manufacturer,
                    model: value.model,
                    licensePlate: value.licensePlate,
                    vin: value.vin,
                    color: value.color,
                    registrationDate: value.registrationDate,
                    fuelTypes: value.fuelTypes
                };
                const result = vehicle ? await update({ data: { ...data, vehicleId: vehicle.id } }) : await create({ data });

                if ('code' in result) {
                    setErrors(vehicleErrors(result));

                    if (result.code === AuthErrorCode.AUTH_REQUIRED) await replaceCurrentUser(queryClient, null);

                    return;
                }

                setVehicle(result.vehicle);

                await queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
                await queryClient.invalidateQueries({ queryKey: fuelKeys.all });
                await queryClient.invalidateQueries({ queryKey: statisticsKeys.all });
                await queryClient.invalidateQueries({ queryKey: expenseKeys.all });

                if (value.picture) {
                    const response = await fetch(`/api/vehicle-pictures/${result.vehicle.id}`, {
                        method: HttpMethod.POST,
                        body: value.picture
                    });

                    if (!response.ok) {
                        const code = await response.text();

                        setPictureFailed(true);
                        setErrors([getVehicleErrorKey(code)]);

                        if (code === AuthErrorCode.AUTH_REQUIRED) await replaceCurrentUser(queryClient, null);

                        return;
                    }
                }

                formApi.reset(values(result.vehicle));
                await queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
                await queryClient.invalidateQueries({ queryKey: fuelKeys.all });
                await queryClient.invalidateQueries({ queryKey: statisticsKeys.all });
                await queryClient.invalidateQueries({ queryKey: expenseKeys.all });
                await router.navigate({ to: '/vehicles' });
            } catch (error) {
                setErrors([getVehicleErrorKey(error instanceof Error ? error.message : undefined)]);
            }
        }
    });

    async function removePicture() {
        if (!vehicle || removingPicture) return;

        setRemovingPicture(true);
        setErrors([]);

        try {
            const response = await fetch(`/api/vehicle-pictures/${vehicle.id}`, { method: HttpMethod.DELETE });

            if (!response.ok) {
                const code = await response.text();

                setErrors([getVehicleErrorKey(code)]);

                if (code === AuthErrorCode.AUTH_REQUIRED) await replaceCurrentUser(queryClient, null);

                return;
            }

            setVehicle({ ...vehicle, pictureUrl: null });

            await queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
            await queryClient.invalidateQueries({ queryKey: fuelKeys.all });
            await queryClient.invalidateQueries({ queryKey: statisticsKeys.all });
            await queryClient.invalidateQueries({ queryKey: expenseKeys.all });
        } catch (error) {
            setErrors([getVehicleErrorKey(error instanceof Error ? error.message : undefined)]);
        } finally {
            setRemovingPicture(false);
        }
    }

    return (
        <Page
            title={t(vehicle ? 'editHeading' : 'createHeading')}
            onBack={() => router.navigate({ to: '/vehicles' })}
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
                    <Grid>
                        <Column>
                            <form.AppField name='manufacturer'>
                                {(field) => (
                                    <field.Input
                                        label={t('fields.manufacturer')}
                                        maxLength={100}
                                        required
                                    />
                                )}
                            </form.AppField>
                        </Column>
                    </Grid>
                    <Grid>
                        <Column>
                            <form.AppField name='model'>
                                {(field) => (
                                    <field.Input
                                        label={t('fields.model')}
                                        maxLength={100}
                                        required
                                    />
                                )}
                            </form.AppField>
                        </Column>
                    </Grid>
                    <Grid>
                        <Column>
                            <form.AppField name='licensePlate'>
                                {(field) => (
                                    <field.Input
                                        label={t('fields.licensePlate')}
                                        maxLength={30}
                                    />
                                )}
                            </form.AppField>
                        </Column>
                    </Grid>
                    <Grid>
                        <Column>
                            <form.AppField name='vin'>
                                {(field) => (
                                    <field.Input
                                        label={t('fields.vin')}
                                        maxLength={32}
                                    />
                                )}
                            </form.AppField>
                        </Column>
                    </Grid>
                    <Grid>
                        <Column>
                            <form.AppField name='color'>
                                {(field) => (
                                    <field.Input
                                        label={t('fields.color')}
                                        maxLength={50}
                                    />
                                )}
                            </form.AppField>
                        </Column>
                    </Grid>
                    <Grid>
                        <Column>
                            <form.AppField name='registrationDate'>
                                {(field) => (
                                    <field.DateTimeInput
                                        type='date'
                                        label={t('fields.registrationDate')}
                                    />
                                )}
                            </form.AppField>
                        </Column>
                    </Grid>
                    <Grid>
                        <Column>
                            <form.AppField name='fuelTypes'>
                                {(field) => (
                                    <field.Select
                                        label={t('fields.fuelTypes')}
                                        multiple
                                        required
                                        allowEmptyOption
                                        options={Object.values(FuelType).map((type) => ({ value: type, label: t(`fuels.${type}`) }))}
                                    />
                                )}
                            </form.AppField>
                        </Column>
                    </Grid>
                    <Section title={t('picture.heading')}>
                        <div className='flex flex-col gap-lg'>
                            {vehicle?.pictureUrl && (
                                <>
                                    <img
                                        src={vehicle.pictureUrl}
                                        alt={t('picture.alt', { name: `${vehicle.manufacturer} ${vehicle.model}` })}
                                        className='max-h-[240px] w-full object-contain object-left'
                                    />
                                    <Button
                                        onClick={removePicture}
                                        disabled={removingPicture}
                                        variant='outline'
                                    >
                                        {t('picture.remove')}
                                    </Button>
                                </>
                            )}
                            <p className='text-sm'>{t('picture.help')}</p>
                            <Grid>
                                <Column>
                                    <form.AppField name='picture'>
                                        {(field) => (
                                            <field.FileInput
                                                label={t('fields.picture')}
                                                accept={pictureAccept}
                                            />
                                        )}
                                    </form.AppField>
                                </Column>
                            </Grid>
                        </div>
                    </Section>
                    {pictureFailed && <p role='status'>{t('picture.partialSave')}</p>}
                    <ErrorMessages
                        errors={errors}
                        namespace='vehicles'
                    />
                    <form.AppForm>
                        <form.Subscribe selector={(state) => state.isSubmitting}>
                            {(busy) => (
                                <Flex justify='between'>
                                    <form.SubscribeButton>{t(busy ? 'working' : 'save')}</form.SubscribeButton>
                                    {vehicle && (
                                        <Button
                                            variant='danger'
                                            disabled={busy}
                                            onClick={() => setDeleting(true)}
                                        >
                                            {t('delete.button')}
                                        </Button>
                                    )}
                                </Flex>
                            )}
                        </form.Subscribe>
                    </form.AppForm>
                </form>
            </Section>
            {vehicle && deleting && (
                <DeleteVehicleDialog
                    vehicle={vehicle}
                    onClose={() => setDeleting(false)}
                />
            )}
        </Page>
    );
}
