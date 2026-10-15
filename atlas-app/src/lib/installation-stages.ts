/**
 * The working stages of an installation and its checklists (11 Oct 2026,
 * ops-pages demo tab 1). Pure - the page, the server and tests share it.
 */

export const INSTALL_STAGES = [
  { key: 'planned', label: 'Planned', next: 'Book the site survey visit.' },
  { key: 'survey', label: 'Site survey', next: 'Finish the site survey checklist.' },
  { key: 'material_ready', label: 'Material ready', next: 'Issue the material from the store.' },
  { key: 'installing', label: 'Installing', next: 'Fit each unit and scan its serial.' },
  { key: 'testing', label: 'Testing', next: 'Run the testing checklist.' },
  { key: 'handover', label: 'Handover', next: 'The office approves the installation.' },
  { key: 'approved', label: 'Approved', next: 'Done.' },
] as const;

export type InstallStage = (typeof INSTALL_STAGES)[number]['key'];

export const isInstallStage = (s: unknown): s is InstallStage => INSTALL_STAGES.some((x) => x.key === s);
export const stageIndex = (s: InstallStage | string) => Math.max(0, INSTALL_STAGES.findIndex((x) => x.key === s));
export const stageLabel = (s: string) => INSTALL_STAGES.find((x) => x.key === s)?.label ?? s;

/** The step after this one, if a person moves it (handover and approval have their own actions). */
export function nextStage(s: string): InstallStage | null {
  const i = stageIndex(s);
  const n = INSTALL_STAGES[i + 1]?.key ?? null;
  return n;
}

export const SURVEY_ITEMS = [
  { key: 'power', label: 'Power points near each unit' },
  { key: 'route', label: 'Cable route agreed with the customer' },
  { key: 'height', label: 'Mounting heights checked' },
  { key: 'network', label: 'Internet / Wi-Fi for remote viewing' },
  { key: 'photos', label: 'Before photos taken' },
] as const;

export const TESTING_ITEMS = [
  { key: 'recording', label: 'Every unit working / recording' },
  { key: 'app', label: 'Mobile app set up on the customer’s phone' },
  { key: 'night', label: 'Night vision / low light checked' },
  { key: 'shown', label: 'Customer shown how to use it' },
  { key: 'password', label: 'Passwords handed to the customer' },
  { key: 'afterPhotos', label: 'After photos taken' },
] as const;

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
