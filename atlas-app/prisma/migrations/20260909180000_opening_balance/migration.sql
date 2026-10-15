-- Opening balances — the figures a balance sheet needs that no document holds.
--
-- ADDITIVE ONLY. One new table.
--
-- Atlas records documents, not ledger entries, so receivables, payables and
-- stock all fall out of the data. What it cannot know is what was in the bank on
-- the day the business started using it, or how much the owner put in. Somebody
-- types those once.

CREATE TABLE "OpeningBalance" (
    "id"               TEXT NOT NULL,
    "storeId"          TEXT NOT NULL,

    -- The day these figures were true. Everything recorded after it is added to
    -- them; anything before is assumed to be inside them already.
    "asOfDate"         TIMESTAMP(3) NOT NULL,

    "cashPaise"        INTEGER NOT NULL DEFAULT 0,
    "bankPaise"        INTEGER NOT NULL DEFAULT 0,
    "capitalPaise"     INTEGER NOT NULL DEFAULT 0,
    -- Written-down value, maintained by hand. Depreciation is not modelled.
    "fixedAssetsPaise" INTEGER NOT NULL DEFAULT 0,
    "loansPaise"       INTEGER NOT NULL DEFAULT 0,

    "note"             TEXT,
    "updatedBy"        TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpeningBalance_pkey" PRIMARY KEY ("id")
);

-- One per store. A second row would silently change the answer depending on
-- which happened to be read first.
CREATE UNIQUE INDEX "OpeningBalance_storeId_key" ON "OpeningBalance"("storeId");

ALTER TABLE "OpeningBalance" ADD CONSTRAINT "OpeningBalance_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
