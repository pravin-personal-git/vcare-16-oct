/**
 * WHAT EVERY PERSON DID (Vcare meeting wave 4, 8 Oct 2026).
 *
 * Pravin: "Team Performance in HRM", and "measure every action, full
 * tracking, reporting and analysis."
 *
 * The screen that exists measures ONE department. Technician Performance is
 * good - time to accept, to reach, on site, to close, missed deadlines,
 * reopened jobs, rating, parts, km - but every one of those comes off a
 * complaint, so a salesperson who raised forty quotations appears nowhere, and
 * a coordinator who made ninety calls appears nowhere. That is the gap.
 *
 * Nothing new is recorded to close it. Atlas already knows who made each call,
 * who owns each lead, who raised each quotation, order and invoice, who was
 * assigned each task, who attended each visit and who was present on each day.
 * None of it was ever added up per person. This file is the adding up, and it
 * is a REGISTRY rather than a fixed set of columns so that a module added next
 * month joins the screen by adding a row here.
 *
 * WHAT IS DELIBERATELY ABSENT, and why saying so matters: `Receipt` has no
 * column naming who took the money, so "payments collected" cannot be
 * measured per person and is not shown. An empty column reads as "this person
 * collected nothing"; a measure that is simply not there reads as what it is.
 * Giving Receipt a `collectedBy` is the fix, and it is not done.
 *
 * A COUNT IS NOT A JUDGEMENT. Ninety calls is not better than forty, and the
 * screen says so, because the first thing a number like this invites is a
 * league table. These are what somebody did, for a conversation to start from.
 */

export type MeasureGroup = 'Talking to customers' | 'Selling' | 'Doing the work' | 'Being there';

export interface Measure {
  key: keyof ActivityCounts;
  label: string;
  group: MeasureGroup;
  /** One line saying exactly what is counted, shown on hover and in help. */
  counts: string;
  /** Money measures are shown in lakh/crore, not as a plain integer. */
  money?: boolean;
}

export interface ActivityCounts {
  callsOut: number;
  callsIn: number;
  /** Rang out - a zero-second call. Worth seeing next to the others. */
  callsNoAnswer: number;
  callMinutes: number;
  leadsOwned: number;
  leadsConverted: number;
  quotations: number;
  quotationValuePaise: number;
  orders: number;
  orderValuePaise: number;
  invoices: number;
  invoiceValuePaise: number;
  tasksAssigned: number;
  tasksDone: number;
  visitsDone: number;
  daysPresent: number;
}

export const EMPTY_COUNTS: ActivityCounts = {
  callsOut: 0, callsIn: 0, callsNoAnswer: 0, callMinutes: 0,
  leadsOwned: 0, leadsConverted: 0,
  quotations: 0, quotationValuePaise: 0,
  orders: 0, orderValuePaise: 0,
  invoices: 0, invoiceValuePaise: 0,
  tasksAssigned: 0, tasksDone: 0,
  visitsDone: 0, daysPresent: 0,
};

export const MEASURES: Measure[] = [
  { key: 'callsOut', label: 'Calls made', group: 'Talking to customers', counts: 'Outgoing calls this person’s phone logged in the period.' },
  { key: 'callsIn', label: 'Calls taken', group: 'Talking to customers', counts: 'Incoming calls answered.' },
  { key: 'callsNoAnswer', label: 'Rang out', group: 'Talking to customers', counts: 'Calls that connected for zero seconds - nobody picked up. Counted separately so a day of unanswered calls does not read as a day of conversations.' },
  { key: 'callMinutes', label: 'Minutes on calls', group: 'Talking to customers', counts: 'Total talk time, rounded to whole minutes.' },

  { key: 'leadsOwned', label: 'Leads held', group: 'Selling', counts: 'Leads assigned to this person that were created or moved in the period.' },
  { key: 'leadsConverted', label: 'Leads won', group: 'Selling', counts: 'Leads of theirs that became a customer in the period.' },
  { key: 'quotations', label: 'Quotations', group: 'Selling', counts: 'Quotations where they are the salesperson.' },
  { key: 'quotationValuePaise', label: 'Quoted', group: 'Selling', money: true, counts: 'What those quotations came to. Quoted is not earned.' },
  { key: 'orders', label: 'Orders', group: 'Selling', counts: 'Sales orders where they are the salesperson.' },
  { key: 'orderValuePaise', label: 'Ordered', group: 'Selling', money: true, counts: 'What those orders came to.' },
  { key: 'invoices', label: 'Invoices', group: 'Selling', counts: 'Invoices where they are the salesperson.' },
  { key: 'invoiceValuePaise', label: 'Invoiced', group: 'Selling', money: true, counts: 'What those invoices came to. Invoiced is not collected.' },

  { key: 'tasksAssigned', label: 'Tasks given', group: 'Doing the work', counts: 'Tasks assigned to them in the period.' },
  { key: 'tasksDone', label: 'Tasks finished', group: 'Doing the work', counts: 'Tasks of theirs completed in the period.' },
  { key: 'visitsDone', label: 'Visits done', group: 'Doing the work', counts: 'Site visits they completed - a new installation or a complaint.' },

  { key: 'daysPresent', label: 'Days present', group: 'Being there', counts: 'Days attendance recorded them present.' },
];

export const MEASURE_GROUPS: MeasureGroup[] = [
  'Talking to customers', 'Selling', 'Doing the work', 'Being there',
];

export const measuresIn = (group: MeasureGroup): Measure[] => MEASURES.filter((m) => m.group === group);

export interface ActivityRow extends ActivityCounts {
  userId: string;
  name: string;
  /** Their department, when they have one - the screen groups by it. */
  departmentName: string | null;
  /** True when every measure is zero: shown, but last and quietly. */
  silent: boolean;
}

/**
 * Turn per-person counts into the screen's rows.
 *
 * Everyone who was active in the period gets a row, and so does everyone the
 * caller listed as present-but-idle - because "nothing recorded" is itself the
 * answer somebody opens this screen looking for, and a person who simply
 * vanishes from the list looks like a filtering mistake rather than a finding.
 */
export function teamActivity(
  counts: Map<string, Partial<ActivityCounts>>,
  people: Map<string, { name: string; departmentName: string | null }>,
): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const [userId, who] of people) {
    const c = { ...EMPTY_COUNTS, ...(counts.get(userId) ?? {}) };
    rows.push({
      userId,
      name: who.name,
      departmentName: who.departmentName,
      silent: MEASURES.every((m) => (c[m.key] ?? 0) === 0),
      ...c,
    });
  }
  /*
    Busiest first within a department, and the silent ones at the end. Sorted
    on the count of THINGS rather than on money, because money would put one
    salesperson above a whole service team every time and this is not a
    revenue screen.
  */
  const things = (r: ActivityRow) =>
    r.callsOut + r.callsIn + r.leadsOwned + r.quotations + r.orders + r.invoices + r.tasksDone + r.visitsDone;
  return rows.sort((a, b) => {
    if (a.silent !== b.silent) return a.silent ? 1 : -1;
    const d = (a.departmentName ?? '￿').localeCompare(b.departmentName ?? '￿');
    return d !== 0 ? d : things(b) - things(a) || a.name.localeCompare(b.name);
  });
}

/**
 * WHY A WHOLE GROUP CAN READ ZERO (8 Oct 2026).
 *
 * Found while checking this against Vcare's own data, and it is the reason
 * this function exists rather than letting the screen show a wall of dashes:
 *
 *     calls logged, all time ............... 0
 *     quotations with a salesperson ........ 0 of 793
 *     orders with a salesperson ............ 0 of 400
 *     invoices with a salesperson .......... 0 of 3,380
 *     attendance days clocked in ........... 0
 *     leads with an owner .................. 791  <- this one works
 *
 * None of that is the screen being wrong. Every sales document was migrated
 * with nobody attached - not even `createdBy` - and the phones have never
 * delivered a call log. A table of dashes would read as "this team did
 * nothing", which is a different and much worse statement than "nothing was
 * recorded against anybody", so the screen says which one it is.
 *
 * Returns null when the group has any figure at all.
 */
export function emptyGroupReason(group: MeasureGroup, totals: ActivityCounts): string | null {
  const anything = measuresIn(group).some((m) => (totals[m.key] ?? 0) > 0);
  if (anything) return null;
  switch (group) {
    case 'Talking to customers':
      return 'No calls have been logged at all. Calls reach Atlas from the Android app call log - if nobody has that switched on, this stays empty however many calls are made.';
    case 'Selling':
      return 'No quotation, order or invoice in this period names a salesperson. Documents brought over from the old system carry no person at all, so only ones raised in Atlas can count here.';
    case 'Doing the work':
      return 'No tasks finished and no visits completed in this period.';
    case 'Being there':
      return 'Nobody is recorded as having clocked in. Attendance comes from the app or the biometric device; neither has written a day in this period.';
    default:
      return 'Nothing recorded for this period.';
  }
}

/** Column totals, for the row at the foot of the table. */
export function totalActivity(rows: ActivityRow[]): ActivityCounts {
  const out = { ...EMPTY_COUNTS };
  for (const r of rows) for (const m of MEASURES) out[m.key] += r[m.key] ?? 0;
  return out;
}
