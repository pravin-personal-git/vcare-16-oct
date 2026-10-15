-- 15 Oct 2026: a phone that lost the /refresh reply on a weak signal was
-- signed out, because its old refresh token was already rotated away.
-- Rotation now records which token replaced which, so the old one can be
-- honoured once while its replacement has never been used.
-- Expand-only: one nullable column on each refresh-token table.
ALTER TABLE "MobileRefreshToken" ADD COLUMN IF NOT EXISTS "replacedById" TEXT;
ALTER TABLE "PartyRefreshToken" ADD COLUMN IF NOT EXISTS "replacedById" TEXT;
