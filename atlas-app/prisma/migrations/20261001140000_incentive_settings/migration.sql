-- How a branch works out a sales incentive (workstream H, 1 Oct 2026).
--
-- Before this there was no rule anywhere in Atlas: Quotation.incentivePaise
-- was a number somebody typed on each deal, nothing calculated it, and it
-- appeared on no dashboard.
--
-- One JSON column rather than a column per scheme, because the shape differs
-- by basis - slabs are a list, a percentage is a number - and the shape will
-- grow. `parseIncentiveRule` validates it on the way in and on the way out,
-- the same pattern JobSettings already uses.
--
-- NOTE: no backfill, deliberately. A branch with no row gets `manual`, which
-- is exactly what Atlas did before. Switching a client onto a percentage must
-- be a decision somebody makes, never something a deploy does to them.
CREATE TABLE IF NOT EXISTS "IncentiveSettings" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "rule" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "originNodeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "IncentiveSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IncentiveSettings_storeId_key"
    ON "IncentiveSettings"("storeId");

ALTER TABLE "IncentiveSettings"
    ADD CONSTRAINT "IncentiveSettings_storeId_fkey" FOREIGN KEY ("storeId")
    REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Money rules are argued about at payout time; who changed the scheme and when
-- is the answer.
DROP TRIGGER IF EXISTS atlas_audit ON "IncentiveSettings";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "IncentiveSettings" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
