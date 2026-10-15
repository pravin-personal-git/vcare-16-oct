-- Hand-written: efficient prefix search (`path: { startsWith: ... }`, spec
-- §13's reseller-subtree lookups) needs a text_pattern_ops index. The plain
-- btree Prisma's auto-diff already created on "path" does not serve a
-- Postgres LIKE 'prefix%' query well outside the "C" collation.
CREATE INDEX "PlatformAccount_path_pattern_idx" ON "PlatformAccount" ("path" text_pattern_ops);
