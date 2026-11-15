import { FuelType } from '../generated/prisma/enums';

export const FuelPriceInput = {
    TOTAL: 'totalPrice',
    UNIT: 'unitPrice'
} as const;

export type FuelPriceInput = (typeof FuelPriceInput)[keyof typeof FuelPriceInput];

export const FuelUnit = {
    LITRE: 'L',
    KILOGRAM: 'kg',
    KILOWATT_HOUR: 'kWh'
} as const;

export type FuelUnit = (typeof FuelUnit)[keyof typeof FuelUnit];

export const fuelUnits = {
    [FuelType.PETROL]: FuelUnit.LITRE,
    [FuelType.DIESEL]: FuelUnit.LITRE,
    [FuelType.LPG]: FuelUnit.LITRE,
    [FuelType.CNG]: FuelUnit.KILOGRAM,
    [FuelType.ELECTRIC]: FuelUnit.KILOWATT_HOUR
} satisfies Record<FuelType, FuelUnit>;

export const fuelCurrency = 'EUR';

export const maximumTotalPrice = 99999999.99;
