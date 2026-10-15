import type { ModuleSpec } from '@/components/shell/ModuleShell';

/**
 * Every menu destination that is not built yet.
 *
 * Keyed by route, so the sidebar, the command palette and these screens cannot
 * drift apart. Each entry states what the screen is for, the controls the
 * reference app carries, and which working screen the person probably wanted -
 * because the most useful thing an unbuilt screen can do is point somewhere
 * useful.
 */

export const MODULES: Record<string, ModuleSpec> = {
  // Also removed once built, on 14 Sep 2026: '/departments' (it redirects to
  // Masters, which already owns that table), '/settings/user-store-roles',
  // '/settings/attendance', '/hierarchy', '/employee/attendance' and '/faq'.
  // '/reports/product-stock', '/service', '/reports/profit-loss' and
  // '/reports/balance-sheet' were here. All four are built. They are removed
  // rather than left with a flag, because Store Menu Config derives "built"
  // from absence in this file - a stale entry here switches a working screen
  // off for every tenant, which is exactly what it did until 14 Sep 2026.
  // '/files' removed 16 Sep 2026 - built as a flat shared-file library.
  // '/import' removed 16 Sep 2026 - built for customers and products (leads
  // still pending, A045 - its own assignment rules make it a separate piece).
  //
  // '/manufacturing/orders' and '/manufacturing/bom' removed 17 Sep 2026 -
  // built as light manufacturing (Bill of Materials + Production Order,
  // commit 9a38a4f). Both entries had sat here, unremoved, since the day
  // they were built, which is exactly the failure this file's own header
  // warns about: Store Menu Config's "turn on every built screen" action
  // read them as unbuilt and would have switched their menu items off for
  // any store that ran it. Found and fixed as part of the 17 Sep 2026
  // documentation/build session, not caught at build time - see
  // docs/18-KNOWN-BUGS-AND-LIMITATIONS.md bug B3 if that file still exists.
  //
  // '/transactions', '/supplier/account', '/customer/account',
  // '/user/account', '/employee/incentive' and '/purchase-return' removed
  // the same day, for the same reason: all six were already fully built
  // (see docs/10-FEATURE-MODULES.md modules 10-12) but had never been
  // cleared from this file. None of the six needed new code - this was a
  // documentation-of-truth fix, not a feature build.
  // ------------------------------------------------------------- INVENTORY
  // '/goods-dispatch' removed 16 Sep 2026 - built as a register and print
  // view over sales orders that have actually been dispatched. No separate
  // create/stock-move: that already happens once, on the order's own
  // `dispatched` transition.
  // '/goods-receipt' removed 16 Sep 2026 - built. RULE 2 (D011 decision log):
  // a Purchase Bill no longer moves stock itself; it creates and posts a
  // receipt behind the scenes for a bill with no PO, and a receipt entered
  // by hand supports partial delivery against a PO. No quality-check step or
  // print view yet.

  // -------------------------------------------------------------- ACCOUNTS
  // '/reports/gst' removed 16 Sep 2026 - built as a working-figure report
  // (Sales GST, Purchase GST, HSN summary, Export JSON), derived from
  // documents already entered. No GSP/e-filing integration - D012 is still
  // open and only blocks actual filing, not a summary of what is owed.
  // '/sales-return' and '/credit-notes' were here. Both are built - the entries
  // are removed rather than commented out with a flag, because absence from this
  // file is precisely what `applyBuiltOnlyMenus` reads to decide a route works.
  // A stale entry here would switch a working screen off for every tenant.
  // '/bank/summary' removed 17 Sep 2026 - built as a KPI strip (Total
  // Accounts / Opening Balance / Current Balance / Active Accounts, matching
  // spec 10-accounts-purchase.md §1.9), a per-account statement with a
  // computed - never stored - running balance, CSV statement import, and
  // reconciliation against Receipts, Supplier Payments and Transactions.
  // `BankAccount.currentBalancePaise` does not exist as a column; it is
  // openingBalancePaise plus the sum of that account's BankTransaction rows,
  // the same "derived, never a stored total" rule as everywhere else. See
  // server/bank-summary.ts and docs/10-FEATURE-MODULES.md.

  // -------------------------------------------------------------- PURCHASE
  // '/purchase/orders' removed 16 Sep 2026 - built. No "Convert to GRN" or
  // print yet; those follow once GRN exists.

};
