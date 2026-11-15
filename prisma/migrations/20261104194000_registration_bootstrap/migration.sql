CREATE TABLE "RegistrationState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RegistrationState_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RegistrationState_singleton" CHECK ("id" = 1)
);

-- Existing installations must never reopen automatic administrator provisioning.
INSERT INTO "RegistrationState" ("id", "completedAt")
VALUES (1, CASE WHEN EXISTS (SELECT 1 FROM "User") THEN CURRENT_TIMESTAMP ELSE NULL END);
