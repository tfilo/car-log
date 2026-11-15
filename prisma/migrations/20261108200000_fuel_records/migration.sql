CREATE TABLE "FuelRecord" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "vehicleId" UUID NOT NULL,
    "fuelType" "FuelType" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "odometer" DECIMAL(12,3) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "unitPrice" DECIMAL(18,6) NOT NULL,
    "isFull" BOOLEAN NOT NULL,
    "previousRecordMissing" BOOLEAN NOT NULL DEFAULT false,
    "consumptionPer100Km" DECIMAL(30,6),
    "consumptionDistance" DECIMAL(12,3),
    "consumptionQuantity" DECIMAL(18,3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "FuelRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FuelRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FuelRecord_quantity_range" CHECK ("quantity" > 0 AND "quantity" <= 999999.999),
    CONSTRAINT "FuelRecord_odometer_range" CHECK ("odometer" >= 0 AND "odometer" <= 999999999.999),
    CONSTRAINT "FuelRecord_price_range" CHECK ("totalPrice" >= 0 AND "totalPrice" <= 99999999.99 AND "unitPrice" >= 0 AND "unitPrice" <= 999999999999.999999),
    CONSTRAINT "FuelRecord_consumption_shape" CHECK (
        ("consumptionPer100Km" IS NULL AND "consumptionDistance" IS NULL AND "consumptionQuantity" IS NULL)
        OR ("isFull" AND "fuelType" <> 'ELECTRIC' AND "consumptionPer100Km" IS NOT NULL AND "consumptionPer100Km" >= 0
            AND "consumptionDistance" IS NOT NULL AND "consumptionDistance" > 0
            AND "consumptionQuantity" IS NOT NULL AND "consumptionQuantity" > 0)
    )
);

CREATE UNIQUE INDEX "FuelRecord_vehicleId_fuelType_occurredAt_key" ON "FuelRecord"("vehicleId", "fuelType", "occurredAt");
CREATE INDEX "FuelRecord_vehicleId_occurredAt_id_idx" ON "FuelRecord"("vehicleId", "occurredAt", "id");
