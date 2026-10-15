import type { StatusLabels } from './job-flow';

/**
 * Per-business switches for field jobs (spec §5). Stored in JobSettings; a
 * business that never opened the settings page gets these defaults.
 */
export interface JobSettingsValue {
  locationGate: boolean;
  radiusMeters: number;
  acceptTimeoutHours: number;
  /** required | optional | off */
  customerOtp: 'required' | 'optional' | 'off';
  approvalToClose: boolean;
  autoCloseOnOtp: boolean;
  /** An approved job challan becomes a GDN at once (stock out), unless stock is short (28 Sep 2026). */
  autoIssueGdn: boolean;
  reopenDays: number;
  visitChargePaise: number;
  /**
   * Markup on a supplier's repair charge when the customer pays for the
   * repair (decision 5, 10 Oct 2026): price = supplier's charge + this %.
   */
  repairMarkupPct: number;
  /** Bill each chargeable item's share of the courier to the customer (default: we bear it). */
  courierToCustomer: boolean;
  /** Hours per priority: accept / visit / close. */
  sla: Record<'urgent' | 'high' | 'normal' | 'low', { accept: number; visit: number; close: number }>;
  labels: StatusLabels;
  photos: 'optional' | 'required';
}

export const JOB_SETTINGS_DEFAULTS: JobSettingsValue = {
  locationGate: true,
  radiusMeters: 50,
  acceptTimeoutHours: 2,
  customerOtp: 'required',
  approvalToClose: true,
  autoCloseOnOtp: true,
  autoIssueGdn: true,
  reopenDays: 7,
  visitChargePaise: 0,
  repairMarkupPct: 0,
  courierToCustomer: false,
  sla: {
    urgent: { accept: 1, visit: 4, close: 24 },
    high: { accept: 2, visit: 8, close: 48 },
    normal: { accept: 4, visit: 24, close: 72 },
    low: { accept: 8, visit: 48, close: 168 },
  },
  labels: {},
  photos: 'optional',
};

const clampInt = (v: unknown, min: number, max: number, dflt: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
};

/** Read stored settings, trusting only known fields and sane ranges. */
export function parseJobSettings(stored: unknown): JobSettingsValue {
  const d = JOB_SETTINGS_DEFAULTS;
  if (!stored || typeof stored !== 'object') return structuredClone(d);
  const o = stored as Record<string, unknown>;
  const slaIn = (o.sla && typeof o.sla === 'object' ? o.sla : {}) as Record<string, Record<string, unknown>>;
  const sla = Object.fromEntries((Object.keys(d.sla) as (keyof JobSettingsValue['sla'])[]).map((p) => [p, {
    accept: clampInt(slaIn[p]?.accept, 1, 24 * 30, d.sla[p].accept),
    visit: clampInt(slaIn[p]?.visit, 1, 24 * 60, d.sla[p].visit),
    close: clampInt(slaIn[p]?.close, 1, 24 * 90, d.sla[p].close),
  }])) as JobSettingsValue['sla'];
  return {
    locationGate: typeof o.locationGate === 'boolean' ? o.locationGate : d.locationGate,
    radiusMeters: clampInt(o.radiusMeters, 10, 1000, d.radiusMeters),
    acceptTimeoutHours: clampInt(o.acceptTimeoutHours, 1, 72, d.acceptTimeoutHours),
    customerOtp: o.customerOtp === 'optional' || o.customerOtp === 'off' ? o.customerOtp : 'required',
    approvalToClose: typeof o.approvalToClose === 'boolean' ? o.approvalToClose : d.approvalToClose,
    autoCloseOnOtp: typeof o.autoCloseOnOtp === 'boolean' ? o.autoCloseOnOtp : d.autoCloseOnOtp,
    autoIssueGdn: typeof o.autoIssueGdn === 'boolean' ? o.autoIssueGdn : d.autoIssueGdn,
    reopenDays: clampInt(o.reopenDays, 0, 90, d.reopenDays),
    visitChargePaise: clampInt(o.visitChargePaise, 0, 10_000_000, d.visitChargePaise),
    repairMarkupPct: clampInt(o.repairMarkupPct, 0, 500, d.repairMarkupPct),
    courierToCustomer: o.courierToCustomer === true,
    sla,
    labels: o.labels && typeof o.labels === 'object' ? (o.labels as StatusLabels) : {},
    photos: o.photos === 'required' ? 'required' : 'optional',
  };
}
