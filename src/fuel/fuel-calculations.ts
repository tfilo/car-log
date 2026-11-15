import { roundNumber } from '../common/number';
import { FuelType } from '../generated/prisma/enums';
import { FuelPriceInput, maximumTotalPrice } from './fuel-values';
import type { z } from 'zod';
import type { fuelRecordSchema } from './fuel-schema';

export type FuelConsumption = {
    consumptionPer100Km: number | null;
    consumptionDistance: number | null;
    consumptionQuantity: number | null;
};

export type ConsumptionRecord = {
    id: string;
    quantity: number;
    odometer: number;
    isFull: boolean;
    previousRecordMissing: boolean;
};

export function calculateFuelPrice(
    input: Pick<z.output<typeof fuelRecordSchema>, 'quantity' | 'price'>
): { totalPrice: number; unitPrice: number } | null {
    const totalPrice =
        input.price.type === FuelPriceInput.TOTAL ? input.price.totalPrice : roundNumber(input.quantity * input.price.unitPrice);

    if (!Number.isFinite(totalPrice) || totalPrice > maximumTotalPrice) return null;

    return { totalPrice, unitPrice: roundNumber(totalPrice / input.quantity, 6) };
}

// Input is one vehicle/fuel timeline, already ordered chronologically.
export function calculateFuelConsumption(records: readonly ConsumptionRecord[], fuelType: FuelType): Map<string, FuelConsumption> {
    const results = new Map<string, FuelConsumption>();
    let baseline: ConsumptionRecord | null = null;
    let quantity = 0;

    for (const record of records) {
        const consumption: FuelConsumption = { consumptionPer100Km: null, consumptionDistance: null, consumptionQuantity: null };

        results.set(record.id, consumption);

        if (fuelType === FuelType.ELECTRIC) continue;

        if (record.previousRecordMissing) {
            baseline = null;
            quantity = 0;
        }

        if (baseline) quantity = roundNumber(quantity + record.quantity, 3);

        if (record.isFull) {
            if (baseline) {
                const distance = roundNumber(record.odometer - baseline.odometer, 3);

                if (distance > 0) {
                    consumption.consumptionDistance = distance;
                    consumption.consumptionQuantity = quantity;
                    consumption.consumptionPer100Km = roundNumber((quantity * 100) / distance, 6);
                }
            }

            baseline = record;
            quantity = 0;
        }
    }

    return results;
}
