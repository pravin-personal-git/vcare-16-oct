-- Health check B0 (25 Sep 2026): a service line on a counter sale used to move
-- stock, driving service products' balances below zero. The code no longer
-- moves stock for services (src/server/stock.ts applyMovements). This corrects
-- balances already written: each non-zero balance on a service product gets an
-- 'adjustment' movement bringing it to zero, so the ledger explains the change,
-- then the balance projection is set to zero.
INSERT INTO "StockMovement" ("id", "storeId", "productId", "warehouseId", "qty", "reason", "refType", "refNo", "balanceAfter", "note", "createdAt")
SELECT
  'b0fix_' || md5(pb."id"),
  p."storeId", pb."productId", pb."warehouseId",
  -pb."currentQty", 'adjustment', 'Manual', 'B0-SERVICE-STOCK', 0,
  'Service product holds no stock - balance written by counter sales corrected to zero',
  now()
FROM "ProductBalance" pb
JOIN "Product" p ON p."id" = pb."productId"
WHERE p."kind" = 'service' AND pb."currentQty" <> 0
ON CONFLICT ("id") DO NOTHING;

UPDATE "ProductBalance" pb SET "currentQty" = 0, "updatedAt" = now()
FROM "Product" p
WHERE p."id" = pb."productId" AND p."kind" = 'service' AND pb."currentQty" <> 0;
