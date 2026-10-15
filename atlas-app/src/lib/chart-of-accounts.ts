/**
 * The standard chart of accounts every organisation starts with.
 *
 * Two levels deep on purpose - a heading account (e.g. "1000 Assets") and
 * its children (e.g. "1010 Cash"). Deep enough to group a report, shallow
 * enough that nobody has to understand a five-level tree to post a bill.
 *
 * Input/output GST are three accounts each (CGST/SGST/IGST), not one,
 * because a GST return reports them separately and a single "GST" account
 * would have to be split back apart by hand at filing time - the same
 * reason `computeTax` in `gst.ts` never merges them either.
 *
 * Pure data - no database. `ensureChartOfAccounts` in `server/ledger.ts` is
 * what actually writes these, idempotently, per organisation.
 */

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface AccountSeed {
  code: string;
  name: string;
  type: AccountType;
  subType?: string;
  parentCode?: string;
}

export const STANDARD_CHART_OF_ACCOUNTS: AccountSeed[] = [
  // ---------------------------------------------------------------- assets
  { code: '1000', name: 'Assets', type: 'asset' },
  { code: '1010', name: 'Cash', type: 'asset', subType: 'current_asset', parentCode: '1000' },
  { code: '1020', name: 'Bank', type: 'asset', subType: 'bank', parentCode: '1000' },
  /// A float kept aside for small daily spending (8 Oct 2026). It is still the
  /// COMPANY'S money sitting somewhere else - not an expense yet, and
  /// emphatically not a `1400` advance that makes somebody a debtor. Topping
  /// it up is a transfer; spending from it is an expense voucher. At month end
  /// this balance must equal the cash actually set aside, and that is the whole
  /// control.
  ///
  /// OPTIONAL. A business that pays for chai straight out of the drawer uses
  /// `Cash` and the expense still lands in the P&L correctly. The float is for
  /// whoever hands a fixed sum to one person and wants it counted back.
  { code: '1030', name: 'Petty Cash', type: 'asset', subType: 'current_asset', parentCode: '1000' },
  { code: '1100', name: 'Accounts Receivable', type: 'asset', subType: 'receivable', parentCode: '1000' },
  { code: '1200', name: 'Inventory', type: 'asset', subType: 'current_asset', parentCode: '1000' },
  { code: '1310', name: 'Input CGST', type: 'asset', subType: 'tax_input', parentCode: '1000' },
  { code: '1320', name: 'Input SGST', type: 'asset', subType: 'tax_input', parentCode: '1000' },
  { code: '1330', name: 'Input IGST', type: 'asset', subType: 'tax_input', parentCode: '1000' },
  { code: '1400', name: 'Staff Advances', type: 'asset', subType: 'employee_receivable', parentCode: '1000' },
  // TDS: the customer paid this to the government on the seller's behalf -
  // it settles an invoice exactly as cash does, but it is not cash, and it
  // becomes a credit the seller claims back against their own tax bill.
  { code: '1410', name: 'TDS Receivable', type: 'asset', subType: 'receivable', parentCode: '1000' },
  // A receipt recorded as "Adjustment" (netting off something already
  // recorded elsewhere, a rounding difference) clears the customer's
  // receivable without real cash moving. Posted here rather than guessed
  // into an expense account, so what it actually was stays visible and
  // reviewable instead of silently distorting the P&L.
  { code: '1420', name: 'Receipt Adjustments', type: 'asset', subType: 'suspense', parentCode: '1000' },
  // The mirror of 1420, for a supplier payment recorded as "Adjustment" -
  // value given without real cash moving, so it still needs a leg, just not
  // a bank one.
  { code: '1430', name: 'Payment Adjustments', type: 'asset', subType: 'suspense', parentCode: '1000' },
  { code: '1500', name: 'Fixed Assets', type: 'asset', subType: 'fixed_asset', parentCode: '1000' },

  // ----------------------------------------------------------- liabilities
  { code: '2000', name: 'Liabilities', type: 'liability' },
  { code: '2100', name: 'Accounts Payable', type: 'liability', subType: 'payable', parentCode: '2000' },
  { code: '2210', name: 'Output CGST', type: 'liability', subType: 'tax_output', parentCode: '2000' },
  { code: '2220', name: 'Output SGST', type: 'liability', subType: 'tax_output', parentCode: '2000' },
  { code: '2230', name: 'Output IGST', type: 'liability', subType: 'tax_output', parentCode: '2000' },
  { code: '2300', name: 'Staff Payable', type: 'liability', subType: 'employee_payable', parentCode: '2000' },
  // Statutory payroll deductions - money withheld from an employee's gross
  // pay that the business owes to a government body, not to the employee.
  // Four separate accounts, not one "Statutory Dues" account, because PF,
  // ESIC, PT and TDS are filed separately and to different authorities - the
  // same reasoning input/output GST are three accounts each rather than one.
  { code: '2310', name: 'PF Payable', type: 'liability', subType: 'statutory_payable', parentCode: '2000' },
  { code: '2320', name: 'ESIC Payable', type: 'liability', subType: 'statutory_payable', parentCode: '2000' },
  { code: '2330', name: 'Professional Tax Payable', type: 'liability', subType: 'statutory_payable', parentCode: '2000' },
  { code: '2340', name: 'TDS Payable (Salaries)', type: 'liability', subType: 'statutory_payable', parentCode: '2000' },
  { code: '2400', name: 'Loans Payable', type: 'liability', subType: 'loan', parentCode: '2000' },
  // AMC money invoiced but not yet earned, when the business spreads AMC
  // income over the contract (health check ACC-1, 25 Sep 2026).
  { code: '2500', name: 'AMC Received in Advance', type: 'liability', subType: 'deferred_revenue', parentCode: '2000' },

  // ----------------------------------------------------------------- equity
  { code: '3000', name: 'Equity', type: 'equity' },
  { code: '3010', name: "Owner's Capital", type: 'equity', parentCode: '3000' },
  { code: '3020', name: 'Retained Earnings', type: 'equity', parentCode: '3000' },
  // The balancing leg for converting an opening-balance snapshot into
  // journal entries - standard practice, never posted to from anywhere else.
  { code: '3900', name: 'Opening Balance Equity', type: 'equity', subType: 'suspense', parentCode: '3000' },

  // ---------------------------------------------------------------- revenue
  { code: '4000', name: 'Revenue', type: 'revenue' },
  { code: '4010', name: 'Sales Revenue', type: 'revenue', parentCode: '4000' },
  { code: '4020', name: 'Sales Returns & Allowances', type: 'revenue', subType: 'contra_revenue', parentCode: '4000' },
  // Service income kept apart from sales of goods (ACC-1): service-kind
  // products billed on an invoice, and AMC fees.
  { code: '4030', name: 'Service & Repair Income', type: 'revenue', parentCode: '4000' },
  { code: '4040', name: 'AMC Income', type: 'revenue', parentCode: '4000' },
  { code: '4900', name: 'Other Income', type: 'revenue', parentCode: '4000' },

  // --------------------------------------------------------------- expense
  { code: '5000', name: 'Expenses', type: 'expense' },
  { code: '5010', name: 'Cost of Goods Sold', type: 'expense', subType: 'cogs', parentCode: '5000' },
  // Parts sent out on repair challans, at stock cost (ACC-1): under warranty
  // or AMC it is a cost of honouring the cover; otherwise parts consumed.
  { code: '5020', name: 'Warranty Replacement Cost', type: 'expense', subType: 'cogs', parentCode: '5000' },
  { code: '5030', name: 'Service Parts Consumed', type: 'expense', subType: 'cogs', parentCode: '5000' },
  { code: '5100', name: 'Freight & Delivery', type: 'expense', parentCode: '5000' },
  // The rest are manual-entry categories for the Transactions/Expenses
  // screen - a purchase bill or COGS never posts to these, a person does.
  { code: '5200', name: 'Rent & Utilities', type: 'expense', parentCode: '5000' },
  { code: '5300', name: 'Salaries & Wages', type: 'expense', parentCode: '5000' },
  { code: '5400', name: 'Marketing & Advertising', type: 'expense', parentCode: '5000' },
  { code: '5500', name: 'Repairs & Maintenance', type: 'expense', parentCode: '5000' },
  { code: '5600', name: 'Bank Charges & Interest', type: 'expense', parentCode: '5000' },
  { code: '5700', name: 'Sales Commission & Incentives', type: 'expense', parentCode: '5000' },
  /// Chai, pani, nashta, medicines, a birthday cake - small money spent ON
  /// staff, which is a business expense and never a loan to them (8 Oct 2026).
  /// Its own account rather than `5900 Other`, because "what do we spend on
  /// the office every month" is a question somebody asks.
  { code: '5800', name: 'Staff Welfare & Refreshments', type: 'expense', parentCode: '5000' },
  /// Petrol, servicing and repairs for the business's own vehicles (8 Oct
  /// 2026) - including the daily fuel cash handed to a technician riding a
  /// company bike. Had no home before this and landed in `5900`, which is why
  /// "how much fuel did we buy" could not be answered.
  { code: '5850', name: 'Vehicle & Fuel', type: 'expense', parentCode: '5000' },
  { code: '5900', name: 'Other Operating Expenses', type: 'expense', parentCode: '5000' },
];
