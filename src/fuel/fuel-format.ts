import { calculateFuelPrice } from './fuel-calculations';
import { FuelPriceInput } from './fuel-values';
import { fuelRecordSchema } from './fuel-schema';
import type { VehicleData } from '../vehicles/vehicle.types';

export function vehicleLabel(vehicle: VehicleData): string {
    return `${vehicle.manufacturer} ${vehicle.model}${vehicle.licensePlate ? ` · ${vehicle.licensePlate}` : ''}`;
}

export function fuelPricePreview(
    quantity: number | null,
    type: FuelPriceInput,
    amount: number | null
): { totalPrice: number; unitPrice: number } | null {
    const parsedQuantity = fuelRecordSchema.shape.quantity.safeParse(quantity);
    const parsedPrice = fuelRecordSchema.shape.price.safeParse(
        type === FuelPriceInput.TOTAL ? { type, totalPrice: amount } : { type, unitPrice: amount }
    );

    if (!parsedQuantity.success || !parsedPrice.success) return null;

    return calculateFuelPrice({ quantity: parsedQuantity.data, price: parsedPrice.data });
}
