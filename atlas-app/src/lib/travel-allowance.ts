/**
 * Travel / fuel allowance from km (F-03, 6 Oct 2026).
 *
 * Before this the only travel money in Atlas was a fixed "Conveyance" salary
 * line; nothing was worked out from how far anybody actually went. Now each
 * branch sets a rate per km by vehicle, where the km come from, and caps; a
 * month's km per person becomes a travel claim that goes through the normal
 * reimbursement approval and is paid from Payroll › Claims.
 *
 * Where the km come from, chosen per branch:
 *   trail  - the phone's location trail, with fake-GPS and too-rough points
 *            already dropped by lib/distance (only for people whose tracking
 *            is on);
 *   visits - straight lines between the job sites a person reached that day,
 *            in the order they reached them. A floor, not road distance, for
 *            businesses that do not track all day.
 *
 * Pure - settings parsing and the money arithmetic, tested without a database.
 */

export type Vehicle = 'bike' | 'car';
export type KmSource = 'trail' | 'visits';

export interface TravelSettingsValue {
  enabled: boolean;
  source: KmSource;
  /** Paise per km. */
  ratePaise: Record<Vehicle, number>;
  /** 0 = no cap. */
  dailyCapKm: number;
  /** 0 = no cap. */
  monthlyCapPaise: number;
  /** Who gets the allowance, and on what. Anyone missing gets nothing. */
  vehicles: Record<string, Vehicle>;
}

export const TRAVEL_DEFAULTS: TravelSettingsValue = {
  enabled: false,
  source: 'trail',
  ratePaise: { bike: 350, car: 900 },
  dailyCapKm: 150,
  monthlyCapPaise: 0,
  vehicles: {},
};

const int = (v: unknown, min: number, max: number, dflt: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
};

/** Read stored settings, trusting only known fields and sane ranges. */
export function parseTravelSettings(stored: unknown): TravelSettingsValue {
  const o = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const d = TRAVEL_DEFAULTS;
  const rate = (o.ratePaise && typeof o.ratePaise === 'object' ? o.ratePaise : {}) as Record<string, unknown>;
  const veh = (o.vehicles && typeof o.vehicles === 'object' ? o.vehicles : {}) as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    source: o.source === 'visits' ? 'visits' : 'trail',
    ratePaise: { bike: int(rate.bike, 0, 10_000, d.ratePaise.bike), car: int(rate.car, 0, 20_000, d.ratePaise.car) },
    dailyCapKm: int(o.dailyCapKm, 0, 2_000, d.dailyCapKm),
    monthlyCapPaise: int(o.monthlyCapPaise, 0, 100_000_00, d.monthlyCapPaise),
    vehicles: Object.fromEntries(Object.entries(veh)
      .filter(([k, v]) => typeof k === 'string' && k.length > 0 && (v === 'bike' || v === 'car'))
      .slice(0, 2_000)) as Record<string, Vehicle>,
  };
}

export interface TravelLine {
  userId: string;
  vehicle: Vehicle;
  /** Km per business day before the cap. */
  days: { day: string; km: number }[];
  rawKm: number;
  /** After the daily cap. */
  paidKm: number;
  ratePaise: number;
  /** After the monthly cap. */
  amountPaise: number;
  cappedDaily: boolean;
  cappedMonthly: boolean;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** One person's month: daily cap per day, then the rate, then the monthly cap. */
export function travelLine(
  userId: string, vehicle: Vehicle, dailyMetres: Map<string, number>, s: TravelSettingsValue,
): TravelLine {
  const days = [...dailyMetres.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([day, m]) => ({ day, km: round1(m / 1000) })).filter((d) => d.km > 0);
  const rawKm = round1(days.reduce((t, d) => t + d.km, 0));
  const capped = days.map((d) => (s.dailyCapKm > 0 ? Math.min(d.km, s.dailyCapKm) : d.km));
  const paidKm = round1(capped.reduce((t, k) => t + k, 0));
  const ratePaise = s.ratePaise[vehicle];
  const gross = Math.round(paidKm * ratePaise);
  const amountPaise = s.monthlyCapPaise > 0 ? Math.min(gross, s.monthlyCapPaise) : gross;
  return {
    userId, vehicle, days, rawKm, paidKm, ratePaise, amountPaise,
    cappedDaily: paidKm < rawKm, cappedMonthly: amountPaise < gross,
  };
}

/** "2026-10" for the month a date falls in, India time. */
export function monthKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(d).slice(0, 7);
}

/** The claim's description starts with this, so a month is never claimed twice. */
export const claimTag = (month: string) => `Travel allowance ${month}`;
