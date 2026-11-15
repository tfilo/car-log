import type { z } from 'zod';
import type { updateVehicleSchema, deleteVehicleSchema, vehicleListSchema } from './vehicle-schema';
import type { FuelType } from '../generated/prisma/enums';
import type { AuthErrorCode } from '../auth/auth-errors';
import type { ResultKind } from '../common/result-kind';
import type { SessionOutcome } from '../auth/auth.types';
import type { VehicleErrorCode } from './vehicle-errors';

export type VehicleData = {
    id: string;
    manufacturer: string;
    model: string;
    licensePlate: string | null;
    vin: string | null;
    color: string | null;
    registrationDate: string | null;
    fuelTypes: FuelType[];
    pictureUrl: string | null;
    createdAt: string;
    updatedAt: string;
};

export type VehicleFailure = { kind: typeof ResultKind.ERROR; code: VehicleErrorCode | typeof AuthErrorCode.AUTH_REQUIRED };

export type VehicleValidationFailure = {
    kind: typeof ResultKind.INVALID;
    code: typeof VehicleErrorCode.INVALID;
    fields: Partial<
        Record<
            | keyof z.input<typeof updateVehicleSchema>
            | keyof z.input<typeof deleteVehicleSchema>
            | keyof NonNullable<z.input<typeof vehicleListSchema>>,
            string[]
        >
    >;
    formErrors: string[];
};

export type VehicleResult = { kind: typeof ResultKind.VEHICLE; vehicle: VehicleData } | VehicleFailure;

export type VehicleListResult =
    { kind: typeof ResultKind.VEHICLES; vehicles: VehicleData[]; page: number; pageSize: number; total: number } | VehicleFailure;

export type VehicleSaveResult = { kind: typeof ResultKind.CREATED | typeof ResultKind.UPDATED; vehicle: VehicleData } | VehicleFailure;

export type VehicleDeleteResult = { kind: typeof ResultKind.DELETED; vehicleId: string } | VehicleFailure;

export type VehicleOperationResult = VehicleResult | VehicleListResult | VehicleSaveResult | VehicleDeleteResult;

export type VehicleResponse = VehicleResult | VehicleListResult | VehicleSaveResult | VehicleDeleteResult | VehicleValidationFailure;

export type VehicleOutcome<Result> = SessionOutcome<Result>;

export type VehicleReadResponse = VehicleResult | VehicleValidationFailure | VehicleFailure;

export type VehicleListResponse = VehicleListResult | VehicleValidationFailure | VehicleFailure;

export type VehicleSaveResponse = VehicleSaveResult | VehicleValidationFailure | VehicleFailure;

export type VehicleDeleteResponse = VehicleDeleteResult | VehicleValidationFailure | VehicleFailure;
