-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "userId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "userId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "totalPrice" DECIMAL(10,2) NOT NULL,
    "odometer" DECIMAL(12,3) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "comment" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseCategory_userId_name_id_idx" ON "ExpenseCategory"("userId", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_id_userId_key" ON "ExpenseCategory"("id", "userId");

-- CreateIndex
CREATE INDEX "Expense_vehicleId_occurredAt_id_idx" ON "Expense"("vehicleId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "Expense_categoryId_userId_idx" ON "Expense"("categoryId", "userId");

-- CreateIndex
CREATE INDEX "Expense_userId_idx" ON "Expense"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_id_userId_key" ON "Vehicle"("id", "userId");

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_vehicleId_userId_fkey" FOREIGN KEY ("vehicleId", "userId") REFERENCES "Vehicle"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_userId_fkey" FOREIGN KEY ("categoryId", "userId") REFERENCES "ExpenseCategory"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- Names remain reserved while archived; display casing can be corrected freely.
CREATE UNIQUE INDEX "ExpenseCategory_userId_name_insensitive_key"
    ON "ExpenseCategory" ("userId", lower(btrim("name")));
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_name_check"
    CHECK (length(btrim("name")) > 0 AND "name" = btrim("name"));
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_price_check" CHECK ("totalPrice" >= 0);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_odometer_check" CHECK ("odometer" >= 0);
