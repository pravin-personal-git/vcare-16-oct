/**
 * The stages of an installation job (27 Oct 2026, Vcare redesign - rebuilt
 * like a complaint). Six steps that MOVE BY THEMSELVES: nobody clicks a
 * stage. Raising it, naming a technician, booking a visit, "Working on site"
 * and "Work done" on the phone, and billing move it. Pure - the page, the
 * server, the migration's SQL and tests share the rule in `deriveStage`.
 *
 * The 11 Oct stages (planned, site survey, material ready, installing,
 * testing, handover, approved) were seven manual clicks; the survey and
 * testing checklists went with them. Old keys still read sensibly through
 * `stageLabel` until a challan is next touched.
 */

export const INSTALL_STAGES = [
  { key: 'raised', label: 'Raised', next: 'Name the technician who goes.' },
  { key: 'technician', label: 'Technician', next: 'Book the installation visit.' },
  { key: 'visit', label: 'Visit', next: 'The technician taps Working on site at the site.' },
  { key: 'fitting', label: 'Fitting', next: 'Fit each unit; the technician taps Work done on the phone.' },
  { key: 'work_done', label: 'Work done', next: 'Bill this installation - or Don’t bill, with a reason.' },
  { key: 'billed', label: 'Billed', next: 'Done.' },
] as const;

export type InstallStage = (typeof INSTALL_STAGES)[number]['key'];

/** The 11 Oct keys, for challans not touched since. */
const OLD: Record<string, InstallStage> = {
  planned: 'raised', survey: 'technician', material_ready: 'fitting', installing: 'fitting',
  testing: 'work_done', handover: 'work_done', approved: 'work_done',
};

export const isInstallStage = (s: unknown): s is InstallStage => INSTALL_STAGES.some((x) => x.key === s);
export const normaliseStage = (s: string): InstallStage => (isInstallStage(s) ? s : OLD[s] ?? 'raised');
export const stageIndex = (s: InstallStage | string) => Math.max(0, INSTALL_STAGES.findIndex((x) => x.key === normaliseStage(s)));
export const stageLabel = (s: string) => INSTALL_STAGES.find((x) => x.key === normaliseStage(s))?.label ?? s;

/** The step after this one. */
export function nextStage(s: string): InstallStage | null {
  return INSTALL_STAGES[stageIndex(s) + 1]?.key ?? null;
}

/** Stages in which the technician is on the job, so may ask for material. */
export const INSTALL_WORKING: readonly InstallStage[] = ['technician', 'visit', 'fitting'];

export interface StageFacts {
  status: string;
  isInvoiced: boolean;
  notBilledReason: string | null;
  team: number;
  /** Visits not cancelled. */
  visits: number;
  /** A visit checked in at the site, or an item fitted. */
  onSite: boolean;
}

/**
 * Where a job is, from what has happened. Billing (or Don't bill) closes it;
 * Work done is the phone's "Work done" (status work_done) - or an old challan
 * the office approved without a bill, which now waits to be billed. Sent back
 * (status rejected) drops it to Fitting again.
 */
export function deriveStage(f: StageFacts): InstallStage {
  if (f.isInvoiced || f.notBilledReason) return 'billed';
  if (f.status === 'work_done' || f.status === 'approved') return 'work_done';
  if (f.onSite) return 'fitting';
  if (f.visits > 0) return 'visit';
  if (f.team > 0) return 'technician';
  return 'raised';
}

export interface MaterialRow {
  name: string;
  unit: string;
  issued: number;
  used: number;
  /** Extra beyond the quotation, to bill (paise). 0 when nothing to bill. */
  extraPaise: number;
}

/**
 * Which order lines are still free to put on a new installation. A line is
 * covered when any installation (not deleted) already fits it. Old challans
 * made before lines were linked cover their order's lines by product.
 */
export function freeOrderLines<L extends { id: string; productId: string | null; productName: string }>(
  lines: L[],
  challans: { items: { salesOrderItemId: string | null; productId: string | null; productName: string }[] }[],
): { free: L[]; covered: L[] } {
  const byLine = new Set<string>();
  const legacyKeys = new Set<string>();
  for (const c of challans) {
    for (const it of c.items) {
      if (it.salesOrderItemId) byLine.add(it.salesOrderItemId);
      else legacyKeys.add(it.productId ?? `name:${it.productName}`);
    }
  }
  const free: L[] = []; const covered: L[] = [];
  for (const l of lines) {
    if (byLine.has(l.id) || legacyKeys.has(l.productId ?? `name:${l.productName}`)) covered.push(l);
    else free.push(l);
  }
  return { free, covered };
}
