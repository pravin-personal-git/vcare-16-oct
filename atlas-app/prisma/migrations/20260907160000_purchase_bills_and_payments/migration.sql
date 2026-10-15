-- Purchase bills and supplier payments.
--
-- ADDITIVE ONLY. Four new tables, no change to any existing one.
--
-- This is the keystone described in 09-documentation/04-roadmap/ROAD-TO-FIRST-CLIENT.md
-- section 7: payables, the supplier ledger, true stock cost and every financial
-- report were all blocked behind it.

-- --------------------------------------------------------- PurchaseBill

CREATE TABLE "PurchaseBill" (
    "id"                TEXT NOT NULL,
    "storeId"           TEXT NOT NULL,
    "billNo"            TEXT NOT NULL,
    "supplierBillNo"    TEXT NOT NULL,
    "partyId"           TEXT NOT NULL,

    "supplierName"      TEXT NOT NULL,
    "gstin"             TEXT,
    "stateId"           TEXT,

    "billDate"          TIMESTAMP(3) NOT NULL,
    "dueDate"           TIMESTAMP(3) NOT NULL,

    -- draft | received | cancelled
    "lifecycle"         TEXT NOT NULL DEFAULT 'draft',

    "freightPaise"      INTEGER NOT NULL DEFAULT 0,
    "subtotalPaise"     INTEGER NOT NULL DEFAULT 0,
    "itemDiscountPaise" INTEGER NOT NULL DEFAULT 0,
    "taxableBasePaise"  INTEGER NOT NULL DEFAULT 0,
    "cgstPaise"         INTEGER NOT NULL DEFAULT 0,
    "sgstPaise"         INTEGER NOT NULL DEFAULT 0,
    "igstPaise"         INTEGER NOT NULL DEFAULT 0,
    "grandTotalPaise"   INTEGER NOT NULL DEFAULT 0,
    "taxMode"           TEXT NOT NULL DEFAULT 'IGST',

    -- Cache of live allocations. Written only by syncBillPaidColumn.
    "amountPaidPaise"   INTEGER NOT NULL DEFAULT 0,

    "notes"             TEXT,
    "cancelledAt"       TIMESTAMP(3),
    "cancelReason"      TEXT,

    "createdBy"         TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseBill_pkey" PRIMARY KEY ("id")
);

-- The same supplier bill number twice is a duplicate, and a duplicate in
-- payables is how a business pays for the same goods twice. It looks exactly
-- like an ordinary purchase on screen, so the database refuses it rather than
-- the UI warning about it.
CREATE UNIQUE INDEX "PurchaseBill_storeId_partyId_supplierBillNo_key"
    ON "PurchaseBill"("storeId", "partyId", "supplierBillNo");
CREATE UNIQUE INDEX "PurchaseBill_storeId_billNo_key"
    ON "PurchaseBill"("storeId", "billNo");
CREATE INDEX "PurchaseBill_storeId_lifecycle_billDate_idx"
    ON "PurchaseBill"("storeId", "lifecycle", "billDate");
CREATE INDEX "PurchaseBill_storeId_partyId_idx" ON "PurchaseBill"("storeId", "partyId");
CREATE INDEX "PurchaseBill_storeId_dueDate_idx"  ON "PurchaseBill"("storeId", "dueDate");

ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseBill" ADD CONSTRAINT "PurchaseBill_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ----------------------------------------------------- PurchaseBillItem

CREATE TABLE "PurchaseBillItem" (
    "id"                TEXT NOT NULL,
    "storeId"           TEXT NOT NULL,
    "billId"            TEXT NOT NULL,
    "srNo"              INTEGER NOT NULL,

    -- Nullable: a bill line may be a repair, a delivery charge or a one-off
    -- that is not in the product catalogue, and it still has to reach the P&L.
    "productId"         TEXT,
    "productName"       TEXT NOT NULL,
    "productCode"       TEXT,
    "hsnCode"           TEXT,

    "qty"               INTEGER NOT NULL,
    "unitCostPaise"     INTEGER NOT NULL,
    "discountPct"       DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxRatePct"        DECIMAL(5,2) NOT NULL DEFAULT 18,

    "lineDiscountPaise" INTEGER NOT NULL DEFAULT 0,
    "lineTotalPaise"    INTEGER NOT NULL DEFAULT 0,

    -- Recorded, not derived: a service line carries a productId too and moves
    -- nothing.
    "movedStock"        BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PurchaseBillItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseBillItem_billId_idx" ON "PurchaseBillItem"("billId");
CREATE INDEX "PurchaseBillItem_storeId_productId_idx"
    ON "PurchaseBillItem"("storeId", "productId");

ALTER TABLE "PurchaseBillItem" ADD CONSTRAINT "PurchaseBillItem_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseBillItem" ADD CONSTRAINT "PurchaseBillItem_billId_fkey"
    FOREIGN KEY ("billId") REFERENCES "PurchaseBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseBillItem" ADD CONSTRAINT "PurchaseBillItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ------------------------------------------------------ SupplierPayment

CREATE TABLE "SupplierPayment" (
    "id"             TEXT NOT NULL,
    "storeId"        TEXT NOT NULL,
    "paymentNo"      TEXT NOT NULL,
    "partyId"        TEXT NOT NULL,

    "amountPaise"    INTEGER NOT NULL,
    "paidAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    "method"         TEXT NOT NULL DEFAULT 'bank',
    "reference"      TEXT,
    "note"           TEXT,

    -- paid | reversed. A bounced cheque reverses; it never deletes.
    "status"         TEXT NOT NULL DEFAULT 'paid',
    "reversedAt"     TIMESTAMP(3),
    "reversalReason" TEXT,
    "reversedBy"     TEXT,

    "recordedBy"     TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierPayment_storeId_paymentNo_key"
    ON "SupplierPayment"("storeId", "paymentNo");
CREATE INDEX "SupplierPayment_storeId_partyId_paidAt_idx"
    ON "SupplierPayment"("storeId", "partyId", "paidAt");
CREATE INDEX "SupplierPayment_storeId_status_paidAt_idx"
    ON "SupplierPayment"("storeId", "status", "paidAt");

ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -------------------------------------------- SupplierPaymentAllocation

CREATE TABLE "SupplierPaymentAllocation" (
    "id"          TEXT NOT NULL,
    "storeId"     TEXT NOT NULL,
    "paymentId"   TEXT NOT NULL,
    "billId"      TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- One payment may touch a given bill once. Two rows for the same pair would
-- quietly overpay it.
CREATE UNIQUE INDEX "SupplierPaymentAllocation_paymentId_billId_key"
    ON "SupplierPaymentAllocation"("paymentId", "billId");
CREATE INDEX "SupplierPaymentAllocation_storeId_billId_idx"
    ON "SupplierPaymentAllocation"("storeId", "billId");

ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "SupplierPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_billId_fkey"
    FOREIGN KEY ("billId") REFERENCES "PurchaseBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
