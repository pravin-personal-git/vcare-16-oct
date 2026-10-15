-- F2: number blocks (F2-SYNC-FOUNDATION-SPEC.md §4.3, decision D10).
--
-- `DocumentSequence` issues a number by incrementing a row inside a
-- transaction. Correct against one database, wrong against two: two offline
-- offices both increment their own copy and both issue the same invoice
-- number. A GST series must be sequential and unbroken, so that is a tax
-- problem, not a merge conflict - and it cannot be fixed afterwards, because
-- renumbering is the one thing you may never do.
--
-- The hub stays the only allocator. It advances the sequence by a whole block
-- while the node is online and hands over the range; the node then issues from
-- its own range with no coordination, and two nodes cannot collide because the
-- hub never hands the same range out twice.

CREATE TABLE "NumberBlock" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "financialYear" INTEGER NOT NULL,
    "fromSeq" INTEGER NOT NULL,
    "toSeq" INTEGER NOT NULL,
    "nextSeq" INTEGER NOT NULL,
    "nodeId" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exhaustedAt" TIMESTAMP(3),

    CONSTRAINT "NumberBlock_pkey" PRIMARY KEY ("id")
);

-- The hub must never hand the same range out twice for a series.
CREATE UNIQUE INDEX "NumberBlock_storeId_docType_financialYear_fromSeq_key"
  ON "NumberBlock"("storeId", "docType", "financialYear", "fromSeq");

CREATE INDEX "NumberBlock_storeId_docType_financialYear_nodeId_idx"
  ON "NumberBlock"("storeId", "docType", "financialYear", "nodeId");

ALTER TABLE "NumberBlock" ADD CONSTRAINT "NumberBlock_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Who took which range, and when, is exactly the question a year-end gap
-- register has to answer.
DROP TRIGGER IF EXISTS atlas_audit ON "NumberBlock";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "NumberBlock" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
