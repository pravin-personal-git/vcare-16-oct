-- Stock as one menu entry, and "Parts counter" (15 Oct 2026, Pravin: the
-- three stock pages and Job parts to issue confused him and Vcare).
--
-- 1. Stock on Hand, Serial & Batch Stock and Stock Checks become ONE menu
--    entry, "Stock". The three pages are unchanged and carry a tab strip
--    (components/stock/StockTabs): Quantity, Serials, Checks.
--
--    The two rows are DELETED, not hidden. Hidden would block the pages
--    (lib/menu-gate: hidden in the menu = cannot be opened), and the tabs
--    must still reach them. With no row of their own they are governed by
--    their permission alone (stock.view), exactly like any page without a
--    menu row. Their Store/Role/UserMenuConfig rows go with them (cascade).
--    Only where the Stock row exists, so no tenant loses its way in.
--    The deploy sync matches menu rows by route and lists neither page, so
--    it does not bring them back.
DELETE FROM "Menu" m
 WHERE m.route IN ('/stock-units', '/reports/stock-health')
   AND EXISTS (SELECT 1 FROM "Menu" s WHERE s.route = '/reports/product-stock');

UPDATE "Menu" SET label = 'Stock'
 WHERE route = '/reports/product-stock' AND label <> 'Stock';

-- 2. Job parts to issue -> Parts counter. Same page, same address; the sync
--    list (sync-tenant-defaults.ts) carries the new label too.
UPDATE "Menu" SET label = 'Parts counter'
 WHERE route = '/goods-dispatch/job-parts' AND label <> 'Parts counter';
