ALTER TABLE "ExpenseCategory"
ADD COLUMN "serviceIntervalKm" INTEGER,
ADD COLUMN "serviceIntervalMonths" INTEGER,
ADD CONSTRAINT "ExpenseCategory_serviceIntervalKm_check" CHECK ("serviceIntervalKm" BETWEEN 1 AND 1000000),
ADD CONSTRAINT "ExpenseCategory_serviceIntervalMonths_check" CHECK ("serviceIntervalMonths" BETWEEN 1 AND 1200);
