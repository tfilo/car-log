CREATE FUNCTION revoke_inactive_user_sessions() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM "Session" WHERE "userId" = NEW."id";
    RETURN NEW;
END;
$$;

CREATE TRIGGER revoke_inactive_user_sessions
AFTER UPDATE OF "status" ON "User"
FOR EACH ROW WHEN (NEW."status" <> 'ACTIVE')
EXECUTE FUNCTION revoke_inactive_user_sessions();

-- Remove any pre-existing sessions that should never authenticate.
DELETE FROM "Session" USING "User"
WHERE "Session"."userId" = "User"."id" AND "User"."status" <> 'ACTIVE';
