/**
 * Sales-order stages a business uses (11 Oct 2026, ops-pages demo tab 5).
 *
 * The stage VALUES stay the fixed set in lib/sales-order-status (reports,
 * revenue and history rules read them). What a business chooses is which of
 * the in-between ones it uses, what they are called and their colour. Booked
 * and Delivered are always on - stock, invoicing and reports hang off them.
 * Pending approval is never moved to by hand: an approval rule puts an order
 * there and approving moves it on.
 *
 * Pure - the settings page, the order page, the list and the server share it.
 */
import { FULFILMENT_FLOW, FULFILMENT_LABEL, nextFulfilment, type FulfilmentStatus } from './sales-order-status';

export const OPTIONAL_STAGES: FulfilmentStatus[] = ['confirmed', 'packed', 'dispatched', 'shipped'];
// Sixteen since G9 (11 Oct 2026): the first eight, then eight more tokens
// (--pc1..8 in globals.css). New keys go at the END - saved choices are keys.
export const STAGE_COLORS = [
  'slate', 'blue', 'teal', 'green', 'amber', 'violet', 'pink', 'red',
  'sky', 'indigo', 'purple', 'orange', 'gold', 'lime', 'brown', 'navy',
] as const;
export type StageColor = (typeof STAGE_COLORS)[number];

export interface OrderStageConfig {
  /** Optional stages switched on, in flow order. */
  enabled: FulfilmentStatus[];
  /** Renamed stages. */
  labels: Partial<Record<FulfilmentStatus, string>>;
  colors: Partial<Record<FulfilmentStatus, StageColor>>;
}

export const PRESETS: { key: string; label: string; enabled: FulfilmentStatus[] }[] = [
  { key: 'simple', label: 'Simple', enabled: [] },
  { key: 'shop', label: 'Shop', enabled: ['confirmed', 'dispatched'] },
  { key: 'courier', label: 'Courier', enabled: ['confirmed', 'packed', 'dispatched', 'shipped'] },
  { key: 'project', label: 'Project', enabled: ['confirmed', 'dispatched'] },
];

/** Every business starts on Booked → Confirmed → Dispatched → Delivered (Pravin, 11 Oct 2026). */
export const DEFAULT_STAGES: OrderStageConfig = { enabled: ['confirmed', 'dispatched'], labels: {}, colors: {} };

export function cleanStageConfig(raw: unknown): OrderStageConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<OrderStageConfig>;
  const enabled = Array.isArray(r.enabled) ? OPTIONAL_STAGES.filter((s) => r.enabled!.includes(s)) : DEFAULT_STAGES.enabled;
  const labels: OrderStageConfig['labels'] = {};
  const colors: OrderStageConfig['colors'] = {};
  for (const s of [...FULFILMENT_FLOW, 'hold', 'failed', 'void', 'returned', 'refunded', 'damage_or_lost'] as FulfilmentStatus[]) {
    const l = r.labels?.[s];
    if (typeof l === 'string' && l.trim()) labels[s] = l.trim().slice(0, 40);
    const c = r.colors?.[s];
    if (c && (STAGE_COLORS as readonly string[]).includes(c)) colors[s] = c as StageColor;
  }
  return { enabled, labels, colors };
}

/** The stages shown on the stepper, in order. */
export function shownStages(cfg: OrderStageConfig): FulfilmentStatus[] {
  return FULFILMENT_FLOW.filter((s) => s === 'booked' || s === 'delivered' || cfg.enabled.includes(s));
}

export const stageName = (cfg: OrderStageConfig, s: FulfilmentStatus) => cfg.labels[s] ?? FULFILMENT_LABEL[s];

/**
 * Where an order may go from here, given the stages in use: the next stage
 * that is switched on (skipping the ones that are off), plus the exceptions
 * the fixed rules allow. Pending approval moves on to the next stage after it.
 */
export function nextStages(current: FulfilmentStatus, cfg: OrderStageConfig): FulfilmentStatus[] {
  const base = nextFulfilment(current);
  const shown = shownStages(cfg);
  const exceptions = base.filter((s) => !FULFILMENT_FLOW.includes(s));
  if (current === 'hold') return [...shown.filter((s) => s !== 'pending_approval'), ...exceptions];
  const i = FULFILMENT_FLOW.indexOf(current);
  if (i < 0) return base;
  const forward = FULFILMENT_FLOW.slice(i + 1).find((s) => s !== 'pending_approval' && shown.includes(s));
  return [...(forward ? [forward] : []), ...exceptions];
}

export const canMove = (from: FulfilmentStatus, to: FulfilmentStatus, cfg: OrderStageConfig) => nextStages(from, cfg).includes(to);

/** A stage colour as a CSS colour from the theme tokens (never a hex - white-label rule). */
export const STAGE_COLOR_VAR: Record<StageColor, string> = {
  slate: 'hsl(var(--muted-foreground))', blue: 'hsl(var(--c1))', teal: 'hsl(var(--c2))', green: 'hsl(var(--success))',
  amber: 'hsl(var(--c3))', violet: 'hsl(var(--c4))', pink: 'hsl(var(--c5))', red: 'hsl(var(--danger))',
  sky: 'hsl(var(--pc1))', indigo: 'hsl(var(--pc2))', purple: 'hsl(var(--pc3))', orange: 'hsl(var(--pc4))',
  gold: 'hsl(var(--pc5))', lime: 'hsl(var(--pc6))', brown: 'hsl(var(--pc7))', navy: 'hsl(var(--pc8))',
};
const DEFAULT_COLOR: Partial<Record<FulfilmentStatus, StageColor>> = {
  booked: 'slate', pending_approval: 'amber', confirmed: 'blue', packed: 'violet', dispatched: 'teal', shipped: 'teal', delivered: 'green',
  hold: 'amber', failed: 'red', void: 'red', returned: 'pink', refunded: 'pink', damage_or_lost: 'red',
};
export const stageColor = (cfg: OrderStageConfig, s: FulfilmentStatus) => STAGE_COLOR_VAR[cfg.colors[s] ?? DEFAULT_COLOR[s] ?? 'slate'];
