-- Split payments into money received (Receipt) and where it was applied
-- (ReceiptAllocation).
--
-- Hand-written rather than generated, because the schema change is the easy
-- half. The other half is moving live InvoicePayment rows across without
-- changing a single customer's balance, and Prisma will not write that.
--
-- Safe to run twice: the data step skips anything already migrated.

-- AlterTable
ALTER TABLE "InvoicePayment" ADD COLUMN     "migratedToReceiptId" TEXT;

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL DEFAULT 'cash',
    "reference" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'received',
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "reversedBy" TEXT,
    "recordedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptAllocation" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "reason" TEXT,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allocatedBy" TEXT,

    CONSTRAINT "ReceiptAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_storeId_receiptNo_key" ON "Receipt"("storeId", "receiptNo");

-- CreateIndex
CREATE INDEX "Receipt_storeId_receivedAt_idx" ON "Receipt"("storeId", "receivedAt");

-- CreateIndex
CREATE INDEX "Receipt_partyId_receivedAt_idx" ON "Receipt"("partyId", "receivedAt");

-- CreateIndex
CREATE INDEX "Receipt_storeId_status_idx" ON "Receipt"("storeId", "status");

-- CreateIndex
CREATE INDEX "ReceiptAllocation_invoiceId_idx" ON "ReceiptAllocation"("invoiceId");

-- CreateIndex
CREATE INDEX "ReceiptAllocation_receiptId_idx" ON "ReceiptAllocation"("receiptId");

-- CreateIndex
CREATE INDEX "ReceiptAllocation_storeId_allocatedAt_idx" ON "ReceiptAllocation"("storeId", "allocatedAt");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- DATA: every existing payment becomes one receipt, fully applied to the one
-- invoice it was recorded against.
--
-- That is exactly what the old row meant, so no balance moves. The point is
-- not to improve the past, it is to leave it identical while making the future
-- expressible.
--
-- Payments whose invoice has no party are skipped, not guessed at: a receipt
-- must belong to somebody, and inventing that link would put money on the
-- wrong customer's account. They stay in InvoicePayment with a null
-- migratedToReceiptId, which is how the verification query below finds them.
--
-- EVERY UNIQUE CONSTRAINT THIS TOUCHES, AND WHAT MAKES IT HOLD
--
-- The first version of this migration failed in production on exactly this
-- point, so it is now written out rather than assumed:
--
--   Receipt.id                    'rcp_' || payment id   — one row per payment
--   ReceiptAllocation.id          'alc_' || payment id   — one row per payment
--   Receipt(storeId, receiptNo)   invoice no + position  — see below
--
-- receiptNo was 'RCP-MIG-' || invoiceNo, which assumes one payment per
-- invoice. That assumption is the exact thing this whole change exists to
-- break: an invoice paid in two instalments produced two receipts with one
-- number. The position within the invoice is what makes it unique.
-- ===========================================================================

INSERT INTO "Receipt" (
    "id", "receiptNo", "storeId", "partyId", "amountPaise", "receivedAt",
    "method", "reference", "note", "status", "recordedBy", "createdAt", "updatedAt"
)
SELECT
    'rcp_' || p."id",
    -- Numbered from the invoice it settled and its position among that
    -- invoice's payments, so a part-paid invoice yields -01, -02, and the
    -- origin stays legible on screen without opening anything. Real receipts
    -- from here on get a proper RCP- sequence and cannot collide with these.
    'RCP-MIG-' || i."invoiceNo" || '-' || LPAD(
        (ROW_NUMBER() OVER (PARTITION BY p."invoiceId" ORDER BY p."paidAt", p."id"))::TEXT,
        2, '0'),
    p."storeId",
    i."partyId",
    p."amountPaise",
    p."paidAt",
    p."method",
    p."reference",
    COALESCE(p."note" || ' · ', '') || 'Migrated from the pre-allocation payment record.',
    'received',
    p."recordedBy",
    p."createdAt",
    CURRENT_TIMESTAMP
FROM "InvoicePayment" p
JOIN "Invoice" i ON i."id" = p."invoiceId"
WHERE p."migratedToReceiptId" IS NULL
  AND i."partyId" IS NOT NULL;

INSERT INTO "ReceiptAllocation" (
    "id", "receiptId", "invoiceId", "storeId", "amountPaise", "allocatedAt", "allocatedBy"
)
SELECT
    'alc_' || p."id",
    'rcp_' || p."id",
    p."invoiceId",
    p."storeId",
    p."amountPaise",
    p."paidAt",
    p."recordedBy"
FROM "InvoicePayment" p
JOIN "Invoice" i ON i."id" = p."invoiceId"
WHERE p."migratedToReceiptId" IS NULL
  AND i."partyId" IS NOT NULL;

UPDATE "InvoicePayment" p
SET "migratedToReceiptId" = 'rcp_' || p."id"
FROM "Invoice" i
WHERE i."id" = p."invoiceId"
  AND p."migratedToReceiptId" IS NULL
  AND i."partyId" IS NOT NULL;

-- ===========================================================================
-- CHECK: every invoice must still show the same paid figure afterwards.
--
-- This is the whole risk of the migration, so it fails the transaction rather
-- than reporting afterwards. A migration that half-moves money is worse than
-- one that refuses to run, because the second is obvious and the first is not.
-- ===========================================================================

DO $$
DECLARE
    drifted INTEGER;
    detail  TEXT;
    orphans INTEGER;
BEGIN
    WITH allocated AS (
        SELECT "invoiceId", SUM("amountPaise") AS total
        FROM "ReceiptAllocation" GROUP BY "invoiceId"
    ), bad AS (
        SELECT i."invoiceNo", i."amountPaidPaise" AS was, COALESCE(a.total, 0) AS now_is
        FROM "Invoice" i
        LEFT JOIN allocated a ON a."invoiceId" = i."id"
        WHERE i."amountPaidPaise" <> COALESCE(a.total, 0)
          AND i."partyId" IS NOT NULL
        ORDER BY i."invoiceNo"
        LIMIT 10
    )
    SELECT COUNT(*), STRING_AGG("invoiceNo" || ' was ' || was || ' now ' || now_is, ', ')
    INTO drifted, detail FROM bad;

    IF drifted > 0 THEN
        -- Named rather than counted. A migration that fails without saying
        -- which rows disagree sends somebody hunting through a database they
        -- are already nervous about.
        --
        -- If this fires, the stored paid figures were already out of step with
        -- the payment rows before today, and that is worth knowing on its own.
        RAISE EXCEPTION
            'Allocation totals disagree with amountPaidPaise on % invoice(s): %. Nothing has been changed.',
            drifted, detail;
    END IF;

    SELECT COUNT(*) INTO orphans
    FROM "InvoicePayment" WHERE "migratedToReceiptId" IS NULL;

    IF orphans > 0 THEN
        RAISE WARNING
            '% payment(s) were left behind because their invoice has no customer record. Money on a receipt must belong to somebody, so these were not guessed at. Find them with: SELECT * FROM "InvoicePayment" WHERE "migratedToReceiptId" IS NULL;', orphans;
    END IF;
END $$;
