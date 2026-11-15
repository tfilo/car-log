ALTER TABLE "User" ADD COLUMN "storeFuelLocation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FuelRecord"
    ADD COLUMN "locationManuallyAdjusted" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "latitude" DOUBLE PRECISION,
    ADD COLUMN "longitude" DOUBLE PRECISION,
    ADD COLUMN "locationAccuracy" DOUBLE PRECISION,
    ADD COLUMN "locationCapturedAt" TIMESTAMPTZ(3),
    ADD CONSTRAINT "FuelRecord_location_check" CHECK (
        ("latitude" IS NULL AND "longitude" IS NULL AND "locationAccuracy" IS NULL AND "locationCapturedAt" IS NULL)
        OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL AND "locationAccuracy" IS NOT NULL AND "locationCapturedAt" IS NOT NULL
            AND "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180 AND "locationAccuracy" BETWEEN 0 AND 40075000)
    );
