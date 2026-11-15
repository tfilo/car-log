import type { FuelLocation } from './fuel-location-schema';
import type { z } from 'zod';
import type { FuelType } from '../generated/prisma/enums';
import type { AuthErrorCode } from '../auth/auth-errors';
import type { ResultKind } from '../common/result-kind';
import type { SessionOutcome } from '../auth/auth.types';
import type { FuelErrorCode } from './fuel-errors';
import type { FuelUnit, fuelCurrency } from './fuel-values';
import type { updateFuelRecordSchema, fuelRecordListSchema, deleteFuelRecordSchema } from './fuel-schema';

export type FuelRecordData = {
    location: FuelLocation | null;
    id: string;
    vehicleId: string;
    fuelType: FuelType;
    occurredAt: string;
    odometer: number;
    quantity: number;
    quantityUnit: FuelUnit;
    totalPrice: number;
    unitPrice: number;
    currency: typeof fuelCurrency;
    isFull: boolean;
    previousRecordMissing: boolean;
    consumptionPer100Km: number | null;
    consumptionDistance: number | null;
    consumptionQuantity: number | null;
    createdAt: string;
    updatedAt: string;
};

export type FuelFailure = { kind: typeof ResultKind.ERROR; code: FuelErrorCode | typeof AuthErrorCode.AUTH_REQUIRED };

export type FuelValidationFailure = {
    kind: typeof ResultKind.INVALID;
    code: typeof FuelErrorCode.INVALID;
    fields: Partial<
        Record<
            | keyof z.input<typeof updateFuelRecordSchema>
            | keyof z.input<typeof fuelRecordListSchema>
            | keyof z.input<typeof deleteFuelRecordSchema>,
            string[]
        >
    >;
    formErrors: string[];
};

export type FuelReadResult = { kind: typeof ResultKind.FUEL_RECORD; record: FuelRecordData } | FuelFailure;

export type FuelListResult =
    { kind: typeof ResultKind.FUEL_RECORDS; records: FuelRecordData[]; page: number; pageSize: number; total: number } | FuelFailure;

export type FuelSaveResult = { kind: typeof ResultKind.CREATED | typeof ResultKind.UPDATED; record: FuelRecordData } | FuelFailure;

export type FuelDeleteResult = { kind: typeof ResultKind.DELETED; recordId: string } | FuelFailure;

export type FuelOperationResult = FuelReadResult | FuelListResult | FuelSaveResult | FuelDeleteResult;

export type FuelOutcome<Result> = SessionOutcome<Result>;

export type FuelReadResponse = FuelReadResult | FuelValidationFailure;

export type FuelListResponse = FuelListResult | FuelValidationFailure;

export type FuelSaveResponse = FuelSaveResult | FuelValidationFailure;

export type FuelDeleteResponse = FuelDeleteResult | FuelValidationFailure;
