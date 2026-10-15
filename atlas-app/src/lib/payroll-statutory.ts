/**
 * PF, ESIC, Professional Tax and TDS - pure arithmetic against a store's
 * `PayrollConfiguration`, no database.
 *
 * Indicative, like the PF/ESIC math this replaces in `server/payroll.ts` said
 * of itself - these are the standard statutory formulas, not a certified
 * compliance calculation. A business's own accountant should verify the
 * configured rates and, for TDS specifically, the slabs below against the
 * current Finance Act before this drives a real payslip.
 */

export interface PfResult {
  employeePaise: number;
  employerPaise: number;
}

/** 12% of Basic (capped at the statutory wage ceiling), both sides - the same rates `EmployeeSalary`'s old indicative math used, now configurable per store instead of hard-coded. */
export function calculatePF(
  basicPaise: number,
  config: { pfEnabled: boolean; pfEmployeeRatePct: number; pfEmployerRatePct: number; pfWageCeilingPaise: number },
): PfResult {
  if (!config.pfEnabled || basicPaise <= 0) return { employeePaise: 0, employerPaise: 0 };
  const wageBasis = Math.min(basicPaise, config.pfWageCeilingPaise);
  return {
    employeePaise: Math.round((wageBasis * config.pfEmployeeRatePct) / 100),
    employerPaise: Math.round((wageBasis * config.pfEmployerRatePct) / 100),
  };
}

export interface EsicResult {
  employeePaise: number;
  employerPaise: number;
}

/** ESIC applies on GROSS, not Basic, and only up to the wage threshold - above it, an employee is simply not covered, not covered-at-a-discount. */
export function calculateESIC(
  grossPaise: number,
  config: { esicEnabled: boolean; esicEmployeeRatePct: number; esicEmployerRatePct: number; esicWageThresholdPaise: number },
): EsicResult {
  if (!config.esicEnabled || grossPaise <= 0 || grossPaise > config.esicWageThresholdPaise) {
    return { employeePaise: 0, employerPaise: 0 };
  }
  return {
    employeePaise: Math.round((grossPaise * config.esicEmployeeRatePct) / 100),
    employerPaise: Math.round((grossPaise * config.esicEmployerRatePct) / 100),
  };
}

export interface PtSlab {
  /** Gross at or below this, in paise, pays `amountPaise`. Null = the top slab, "and above". */
  uptoPaise: number | null;
  amountPaise: number;
}

/** Professional Tax is state legislation, not central - `slabs` comes from `PayrollConfiguration.ptSlabs[state]`, sorted ascending by `uptoPaise`. */
export function calculateProfessionalTax(grossPaise: number, ptEnabled: boolean, slabs: PtSlab[]): number {
  if (!ptEnabled || grossPaise <= 0) return 0;
  for (const slab of slabs) {
    if (slab.uptoPaise === null || grossPaise <= slab.uptoPaise) return slab.amountPaise;
  }
  return 0;
}

/**
 * New-regime (Section 115BAC) slabs, annual, in RUPEES - the widely-known
 * structure as of FY 2025-26 onward. Kept as rupees rather than paise since
 * these are legislated round-rupee figures; converted to paise at the call
 * site.
 */
const NEW_REGIME_SLABS_RUPEES: { uptoRupees: number | null; ratePct: number }[] = [
  { uptoRupees: 400_000, ratePct: 0 },
  { uptoRupees: 800_000, ratePct: 5 },
  { uptoRupees: 1_200_000, ratePct: 10 },
  { uptoRupees: 1_600_000, ratePct: 15 },
  { uptoRupees: 2_000_000, ratePct: 20 },
  { uptoRupees: 2_400_000, ratePct: 25 },
  { uptoRupees: null, ratePct: 30 },
];

const NEW_REGIME_STANDARD_DEDUCTION_PAISE = 75_000 * 100;
/** Section 87A: taxable income at or below this pays NO tax at all under the new regime - a cliff, not a smoothed marginal relief, which this simplified engine does not model. */
const NEW_REGIME_REBATE_CEILING_PAISE = 1_200_000 * 100;
const CESS_PCT = 4;

/**
 * Old-regime slabs, annual, in RUPEES - the structure the new regime was
 * introduced alongside, unchanged for years and still what a contract
 * declaring `taxRegime: 'old'` is taxed under.
 */
const OLD_REGIME_SLABS_RUPEES: { uptoRupees: number | null; ratePct: number }[] = [
  { uptoRupees: 250_000, ratePct: 0 },
  { uptoRupees: 500_000, ratePct: 5 },
  { uptoRupees: 1_000_000, ratePct: 20 },
  { uptoRupees: null, ratePct: 30 },
];

const OLD_REGIME_STANDARD_DEDUCTION_PAISE = 50_000 * 100;
/** Section 87A under the old regime: taxable income at or below this pays no tax - a lower cliff than the new regime's. */
const OLD_REGIME_REBATE_CEILING_PAISE = 500_000 * 100;

function slabTaxPaise(taxableAnnualPaise: number, slabs: { uptoRupees: number | null; ratePct: number }[]): number {
  let tax = 0;
  let lastCeiling = 0;
  for (const slab of slabs) {
    const ceilingPaise = slab.uptoRupees === null ? Infinity : slab.uptoRupees * 100;
    if (taxableAnnualPaise <= lastCeiling) break;
    const sliceTop = Math.min(taxableAnnualPaise, ceilingPaise);
    tax += (sliceTop - lastCeiling) * (slab.ratePct / 100);
    lastCeiling = ceilingPaise;
    if (taxableAnnualPaise <= ceilingPaise) break;
  }
  return tax;
}

function annualSlabTaxPaise(taxableAnnualPaise: number): number {
  return slabTaxPaise(taxableAnnualPaise, NEW_REGIME_SLABS_RUPEES);
}

/**
 * Monthly TDS, projected from THIS month's gross held steady for the year -
 * `monthlyGrossPaise * 12`. Real payroll software re-projects every month
 * from year-to-date actuals plus the months remaining; this simpler version
 * is a reasonable first cut for a stable salary and will overstate or
 * understate TDS across a year that includes a mid-year raise, bonus, or
 * unpaid-leave month.
 *
 * Old-regime TDS reads `annualDeclaredDeductionPaise` - the employee's own
 * `IncomeTaxDeclaration` total, resolved by the caller (server/payroll-run.ts)
 * and passed in rather than looked up here, since this file stays pure
 * arithmetic with no database. The caller is responsible for only passing a
 * VERIFIED declaration's total: an employee whose proof never arrived by the
 * regime's cutoff gets 0 here, the same "revert to higher TDS, not a
 * silently wrong number" rule this function has always followed.
 */
export function calculateMonthlyTDS(
  monthlyGrossPaise: number, taxRegime: string, annualDeclaredDeductionPaise = 0,
): number {
  if (monthlyGrossPaise <= 0) return 0;

  const annualGrossPaise = monthlyGrossPaise * 12;

  if (taxRegime === 'old') {
    const taxableAnnualPaise = Math.max(
      0, annualGrossPaise - OLD_REGIME_STANDARD_DEDUCTION_PAISE - Math.max(0, annualDeclaredDeductionPaise),
    );
    if (taxableAnnualPaise <= OLD_REGIME_REBATE_CEILING_PAISE) return 0;

    const annualTaxPaise = slabTaxPaise(taxableAnnualPaise, OLD_REGIME_SLABS_RUPEES);
    return Math.round((annualTaxPaise * (1 + CESS_PCT / 100)) / 12);
  }

  if (taxRegime !== 'new') return 0;

  const taxableAnnualPaise = Math.max(0, annualGrossPaise - NEW_REGIME_STANDARD_DEDUCTION_PAISE);
  if (taxableAnnualPaise <= NEW_REGIME_REBATE_CEILING_PAISE) return 0;

  const annualTaxPaise = annualSlabTaxPaise(taxableAnnualPaise);
  const withCessPaise = annualTaxPaise * (1 + CESS_PCT / 100);

  return Math.round(withCessPaise / 12);
}
