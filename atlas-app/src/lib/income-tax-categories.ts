/**
 * A fixed, common set of declarable Income Tax categories - `declarations`
 * stays a free-form JSON blob in schema (see `IncomeTaxDeclaration`), but a
 * real form needs real fields, not an arbitrary key/value editor. Shared
 * between the server (income-tax.ts) and the client form, so it lives here
 * rather than in a `server-only`-guarded file - see `lib/tag-colors.ts` for
 * the same reasoning.
 */
export const DECLARATION_CATEGORIES = [
  { code: 'section80C', label: 'Section 80C (LIC, PPF, ELSS...)' },
  { code: 'section80D', label: 'Section 80D (health insurance)' },
  { code: 'hraExemption', label: 'HRA exemption' },
  { code: 'homeLoanInterest', label: 'Home loan interest (Section 24)' },
  { code: 'other', label: 'Other' },
] as const;
