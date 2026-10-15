-- An admin-readable copy of each user's password, sealed (Vcare, 9 Oct 2026).
-- See the comment on `UserPasswordCopy` in schema.prisma for the reasoning.
--
-- Expand-only: a new table, nothing existing changes. Empty on day one -
-- existing passwords exist only as one-way hashes and cannot be copied, so a
-- user's password becomes viewable the next time it is set.
--
-- No audit trigger, deliberately (scripts/audit-trigger-sql.cjs EXCLUDED).
CREATE TABLE IF NOT EXISTS "UserPasswordCopy" (
    "userId" TEXT NOT NULL,
    "sealed" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserPasswordCopy_pkey" PRIMARY KEY ("userId")
);

DO $$ BEGIN
  ALTER TABLE "UserPasswordCopy"
    ADD CONSTRAINT "UserPasswordCopy_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
