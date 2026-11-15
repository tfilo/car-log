CREATE TYPE "FuelType" AS ENUM ('PETROL', 'DIESEL', 'LPG', 'CNG', 'ELECTRIC');

CREATE TABLE "PictureFile" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "key" TEXT NOT NULL,
    "deleteAfter" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PictureFile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PictureFile_key_format" CHECK ("key" ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$')
);
CREATE UNIQUE INDEX "PictureFile_key_key" ON "PictureFile"("key");
CREATE INDEX "PictureFile_deleteAfter_idx" ON "PictureFile"("deleteAfter");

CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "userId" UUID NOT NULL,
    "manufacturer" VARCHAR(100) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "licensePlate" VARCHAR(30),
    "vin" VARCHAR(32),
    "color" VARCHAR(50),
    "registrationDate" DATE,
    "fuelTypes" "FuelType"[] NOT NULL,
    "pictureId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Vehicle_fuelTypes_nonempty" CHECK (cardinality("fuelTypes") > 0 AND array_position("fuelTypes", NULL) IS NULL),
    CONSTRAINT "Vehicle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Vehicle_pictureId_fkey" FOREIGN KEY ("pictureId") REFERENCES "PictureFile"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Vehicle_pictureId_key" ON "Vehicle"("pictureId");
CREATE INDEX "Vehicle_userId_createdAt_id_idx" ON "Vehicle"("userId", "createdAt", "id");

-- Includes cascaded account deletion. Filesystem work is retried after commit.
CREATE FUNCTION queue_replaced_vehicle_picture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD."pictureId" IS NOT NULL THEN
        IF TG_OP = 'DELETE' THEN
            UPDATE "PictureFile" SET "deleteAfter" = CURRENT_TIMESTAMP WHERE "id" = OLD."pictureId";
        ELSIF OLD."pictureId" IS DISTINCT FROM NEW."pictureId" THEN
            UPDATE "PictureFile" SET "deleteAfter" = CURRENT_TIMESTAMP WHERE "id" = OLD."pictureId";
        END IF;
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER vehicle_picture_deleted AFTER DELETE ON "Vehicle" FOR EACH ROW EXECUTE FUNCTION queue_replaced_vehicle_picture();
CREATE TRIGGER vehicle_picture_replaced AFTER UPDATE OF "pictureId" ON "Vehicle" FOR EACH ROW EXECUTE FUNCTION queue_replaced_vehicle_picture();
