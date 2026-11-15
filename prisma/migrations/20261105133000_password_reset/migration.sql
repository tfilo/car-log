CREATE TABLE "PasswordReset" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "userId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PasswordReset_userId_key" ON "PasswordReset"("userId");
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");
CREATE INDEX "PasswordReset_expiresAt_idx" ON "PasswordReset"("expiresAt");
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An old recovery link must not survive credential/address changes or blocking,
-- even if the account is later unblocked or its previous address restored.
CREATE FUNCTION invalidate_password_resets() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM "PasswordReset" WHERE "userId" = NEW."id";
    RETURN NEW;
END;
$$;

CREATE TRIGGER invalidate_password_resets
AFTER UPDATE OF "passwordHash", "email", "username", "emailVerifiedAt", "status" ON "User"
FOR EACH ROW WHEN (
    NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash"
    OR NEW."email" IS DISTINCT FROM OLD."email"
    OR NEW."username" IS DISTINCT FROM OLD."username"
    OR NEW."emailVerifiedAt" IS NULL
    OR NEW."status" IS DISTINCT FROM OLD."status"
)
EXECUTE FUNCTION invalidate_password_resets();
