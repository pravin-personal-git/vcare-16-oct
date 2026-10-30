/**
 * THE SCORECARD'S RULES (31 Oct 2026, Vcare) - what the owner sets in
 * Settings > Scorecards, with the defaults the spec proposed. Pure data, so the
 * page, the engine and the settings form all read one shape.
 * Spec: "Vcare Scorecard: Technician and Office Tracking Spec".
 */

export type Template = 'field' | 'office';
export type TemplateChoice = Template | 'none';

export const FIELD_PILLARS = ['response', 'phone', 'remarks', 'delivery', 'customer', 'reliability'] as const;
export const OFFICE_PILLARS = ['hygiene', 'speed', 'throughput', 'followup', 'reliability'] as const;
export type FieldPillar = (typeof FIELD_PILLARS)[number];
export type OfficePillar = (typeof OFFICE_PILLARS)[number];
export type Pillar = FieldPillar | OfficePillar;

export const PILLAR_LABEL: Record<Pillar, string> = {
  response: 'Response', phone: 'Phone', remarks: 'Remarks', delivery: 'Delivery', customer: 'Customer',
  reliability: 'Reliability', hygiene: 'Hygiene', speed: 'Speed', throughput: 'Throughput', followup: 'Follow-up',
};

export const REASSIGN_REASONS = ['on_leave', 'busy', 'skill', 'customer_asked', 'did_not_act'] as const;
export type ReassignReason = (typeof REASSIGN_REASONS)[number] | 'unknown';
export const REASSIGN_LABEL: Record<ReassignReason, string> = {
  on_leave: 'On leave', busy: 'Busy on another job', skill: 'Needs another skill',
  customer_asked: 'Customer asked', did_not_act: 'Technician did not act', unknown: 'Not recorded',
};

/** Office hygiene rules - keys match the rule list the owner ticked. */
export const RULE_KEYS = [
  'c_site_change', 'c_site_override', 'c_no_site', 'c_no_product', 'c_unassigned', 'c_customer_change', 'c_duplicate',
  'k_reopen', 'k_no_code', 'k_no_remark', 'k_callback',
  'a_pending', 'a_escalated', 'a_reversed',
  'b_revision', 'b_cancel_recreate', 'b_party_dup', 'b_closed_edit',
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];
export type RuleKind = 'mistake' | 'sop' | 'watch';

export const RULE_LABEL: Record<RuleKey, string> = {
  c_site_change: 'Wrong site chosen', c_site_override: 'Technician had to override a far-off site',
  c_no_site: 'Raised without a site (multi-site customer)', c_no_product: 'Raised without product or equipment',
  c_unassigned: 'Left unassigned too long', c_customer_change: 'Wrong customer chosen', c_duplicate: 'Same complaint raised twice',
  k_reopen: 'Closed wrongly (reopened)', k_no_code: 'Office close without customer code or call note',
  k_no_remark: 'Closed without a technician remark', k_callback: 'Callback not made',
  a_pending: 'Approval pending too long', a_escalated: 'Approval escalated', a_reversed: 'Approved, then undone',
  b_revision: 'Invoice changed after it was issued', b_cancel_recreate: 'Cancelled and made again',
  b_party_dup: 'Duplicate customer created', b_closed_edit: 'Edit on a closed or billed job',
};

export interface ScorecardSettings {
  /** roleId -> template; a role not listed falls back to its name (templateForRoleName). */
  roleTemplates: Record<string, TemplateChoice>;
  weights: { field: Record<FieldPillar, number>; office: Record<OfficePillar, number> };
  limits: {
    draftMinutes: number; usefulRemarkWords: number; gapMinutes: number; visitLateMinutes: number;
    unassignedMinutes: number; approvalHours: number; reopenDays: number; callbackHours: number;
    overrideFarM: number; recreateHours: number; duplicateDays: number; minEvents: number; contributedCredit: number;
  };
  rules: Record<RuleKey, { on: boolean; kind: RuleKind }>;
  rewards: {
    field: { minScore: number; maxLate: number; minRating: number };
    office: { minScore: number; maxLate: number; maxMistakes: number };
  };
}

const rule = (on: boolean, kind: RuleKind) => ({ on, kind });

export const DEFAULT_SETTINGS: ScorecardSettings = {
  roleTemplates: {},
  // Reliability is the attendance pillar both share; the spec's field weights add up to 100 without it, so it rides at 10.
  weights: {
    field: { response: 30, phone: 20, remarks: 20, delivery: 20, customer: 10, reliability: 10 },
    office: { hygiene: 35, speed: 25, throughput: 15, followup: 15, reliability: 10 },
  },
  limits: {
    draftMinutes: 15, usefulRemarkWords: 8, gapMinutes: 30, visitLateMinutes: 30, unassignedMinutes: 30,
    approvalHours: 24, reopenDays: 30, callbackHours: 24, overrideFarM: 500, recreateHours: 24, duplicateDays: 7,
    minEvents: 5, contributedCredit: 0.5,
  },
  rules: {
    c_site_change: rule(true, 'mistake'), c_site_override: rule(true, 'mistake'), c_no_site: rule(true, 'sop'),
    c_no_product: rule(true, 'sop'), c_unassigned: rule(true, 'sop'), c_customer_change: rule(true, 'mistake'),
    c_duplicate: rule(false, 'sop'),
    k_reopen: rule(true, 'mistake'), k_no_code: rule(true, 'sop'), k_no_remark: rule(true, 'sop'), k_callback: rule(true, 'sop'),
    a_pending: rule(true, 'sop'), a_escalated: rule(true, 'mistake'), a_reversed: rule(false, 'mistake'),
    b_revision: rule(true, 'mistake'), b_cancel_recreate: rule(true, 'mistake'), b_party_dup: rule(true, 'sop'),
    b_closed_edit: rule(false, 'watch'),
  },
  rewards: {
    field: { minScore: 80, maxLate: 2, minRating: 4.5 },
    office: { minScore: 80, maxLate: 2, maxMistakes: 3 },
  },
};

/** Saved settings over the defaults, key by key, so a rule added later is on its default until set. */
export function mergeSettings(saved: unknown): ScorecardSettings {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<ScorecardSettings>;
  const d = DEFAULT_SETTINGS;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);
  const pick = <T extends Record<string, number>>(base: T, over: unknown): T =>
    Object.fromEntries(Object.entries(base).map(([k, v]) => [k, num((over as Record<string, unknown> | undefined)?.[k], v)])) as T;
  const rules = { ...d.rules };
  for (const k of RULE_KEYS) {
    const r = (s.rules as Record<string, unknown> | undefined)?.[k] as { on?: unknown; kind?: unknown } | undefined;
    if (r) rules[k] = { on: typeof r.on === 'boolean' ? r.on : d.rules[k].on, kind: ['mistake', 'sop', 'watch'].includes(r.kind as string) ? (r.kind as RuleKind) : d.rules[k].kind };
  }
  const roleTemplates: Record<string, TemplateChoice> = {};
  for (const [k, v] of Object.entries(s.roleTemplates ?? {})) if (v === 'field' || v === 'office' || v === 'none') roleTemplates[k] = v;
  return {
    roleTemplates,
    weights: { field: pick(d.weights.field, s.weights?.field), office: pick(d.weights.office, s.weights?.office) },
    limits: pick(d.limits, s.limits),
    rules,
    rewards: { field: pick(d.rewards.field, s.rewards?.field), office: pick(d.rewards.office, s.rewards?.office) },
  };
}

/** The default template by a role's name - editable per role in settings. */
export function templateForRoleName(name: string): TemplateChoice {
  const n = name.toLowerCase();
  if (/techni|engineer|field|installer/.test(n)) return 'field';
  if (/owner|platform|admin|director/.test(n)) return 'none';
  return 'office';
}
