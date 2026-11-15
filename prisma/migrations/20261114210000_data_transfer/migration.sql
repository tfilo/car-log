CREATE TABLE "DataTransfer" (
 "userId" UUID PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
 "exportState" TEXT NOT NULL DEFAULT 'idle',
 "exportKey" TEXT,
 "expiresAt" TIMESTAMPTZ(3),
 "importedAt" TIMESTAMPTZ(3),
 "importError" TEXT
);
