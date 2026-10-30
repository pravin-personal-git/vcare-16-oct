import { describe, expect, it } from 'vitest';
import { activeMs, buildSegments, median, mergeIntervals, statusIntervals } from './segments';
import { overallScore, peerScores, ranks, type MetricDef } from './score';
import { DEFAULT_SETTINGS, mergeSettings, templateForRoleName } from './settings';
import { istDay, monthsIn, periodRange, workingMinutes } from './period';

const H = 3_600_000;

describe('holder segments (spec scenarios 1-3)', () => {
  it('splits a job handed from Mayank to Nagesh, reason carried both ways', () => {
    const s = buildSegments({ start: 0, end: 50 * H, first: 'mayank', changes: [{ at: 48 * H, to: 'nagesh', reason: 'on_leave' }] });
    expect(s).toEqual([
      { userId: 'mayank', start: 0, end: 48 * H, reasonIn: null, reasonOut: 'on_leave' },
      { userId: 'nagesh', start: 48 * H, end: 50 * H, reasonIn: 'on_leave', reasonOut: null },
    ]);
  });
  it('gives a returning holder a new segment, never a merged one', () => {
    const s = buildSegments({ start: 0, end: 30, first: 'a', changes: [{ at: 10, to: 'b' }, { at: 20, to: 'a' }] });
    expect(s.map((x) => x.userId)).toEqual(['a', 'b', 'a']);
  });
  it('ignores a change to the same holder and an unassigned gap', () => {
    const s = buildSegments({ start: 0, end: 30, first: 'a', changes: [{ at: 5, to: 'a' }, { at: 10, to: null }, { at: 20, to: 'b' }] });
    expect(s.map((x) => [x.userId, x.start, x.end])).toEqual([['a', 0, 10], ['b', 20, 30]]);
  });
});

describe('pauses', () => {
  it('removes parts wait and leave from active time (scenario 1)', () => {
    // 48 h held; 23 h parts wait overlaps 20 h leave by 10 h -> 33 h paused, 15 h active.
    expect(activeMs(0, 48 * H, [{ start: 10 * H, end: 33 * H }, { start: 23 * H, end: 43 * H }]) / H).toBe(15);
  });
  it('merges overlapping intervals', () => {
    expect(mergeIntervals([{ start: 5, end: 9 }, { start: 1, end: 6 }, { start: 12, end: 13 }])).toEqual([{ start: 1, end: 9 }, { start: 12, end: 13 }]);
  });
  it('reads waiting statuses off the status trail', () => {
    const trail = [{ at: 1, to: 'accepted' }, { at: 3, to: 'awaiting_customer' }, { at: 7, to: 'in_progress' }, { at: 9, to: 'awaiting_estimate' }];
    expect(statusIntervals(trail, ['awaiting_customer', 'awaiting_estimate'], 12)).toEqual([{ start: 3, end: 7 }, { start: 9, end: 12 }]);
  });
  it('takes the median', () => {
    expect(median([5, 1, 9])).toBe(5);
    expect(median([4, 1, 9, 2])).toBe(3);
    expect(median([])).toBeNull();
  });
});

describe('scoring', () => {
  const def: MetricDef = { key: 'accept', pillar: 'response', label: 'Accept', better: 'lower', unit: 'min', hint: '', source: '' };
  it('scores lower-is-better against peers, ties half', () => {
    const v = new Map([['a', { value: 10, n: 9 }], ['b', { value: 20, n: 9 }], ['c', { value: 20, n: 9 }], ['d', { value: 40, n: 9 }]]);
    const s = peerScores(def, v, 5);
    expect(s.get('a')).toBe(100);
    expect(s.get('b')).toBe(50);
    expect(s.get('d')).toBe(0);
  });
  it('leaves out people with too few events and needs 3 peers', () => {
    const v = new Map([['a', { value: 10, n: 2 }], ['b', { value: 20, n: 9 }], ['c', { value: 30, n: 9 }]]);
    expect([...peerScores(def, v, 5).values()].every((x) => x === null)).toBe(true);
  });
  it('weights the overall over pillars with data only, and needs two', () => {
    expect(overallScore({ response: 80, phone: null, delivery: 60 }, { response: 30, phone: 20, delivery: 20 })).toBe(72);
    expect(overallScore({ response: 80 }, { response: 30 })).toBeNull();
  });
  it('ranks ties together', () => {
    const r = ranks(new Map([['a', 90], ['b', 80], ['c', 80], ['d', null]]));
    expect([r.get('a'), r.get('b'), r.get('c'), r.get('d')]).toEqual([1, 2, 2, undefined]);
  });
});

describe('settings', () => {
  it('keeps defaults for anything not saved and rejects junk', () => {
    const s = mergeSettings({ weights: { field: { response: 50, phone: -3 } }, rules: { c_duplicate: { on: true, kind: 'nope' } } });
    expect(s.weights.field.response).toBe(50);
    expect(s.weights.field.phone).toBe(DEFAULT_SETTINGS.weights.field.phone);
    expect(s.rules.c_duplicate).toEqual({ on: true, kind: 'sop' });
  });
  it('guesses the template from the role name', () => {
    expect(templateForRoleName('Senior Technician')).toBe('field');
    expect(templateForRoleName('Service Coordinator')).toBe('office');
    expect(templateForRoleName('Owner')).toBe('none');
  });
});

describe('periods and working time (IST)', () => {
  it('starts this month at midnight IST', () => {
    const r = periodRange('month', new Date('2026-10-30T12:00:00Z'));
    expect(r.from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
  });
  it('lists the months a range touches', () => {
    const r = periodRange('3m', new Date('2026-10-30T12:00:00Z'));
    expect(monthsIn(r.from, r.to)).toEqual([[2026, 8], [2026, 9], [2026, 10]]);
  });
  it('counts only 9 am to 7 pm, Monday to Saturday', () => {
    // Fri 30 Oct 2026 8 pm IST -> Sat 31 Oct 9:20 am IST = 20 working minutes.
    expect(workingMinutes(Date.parse('2026-10-30T20:00:00+05:30'), Date.parse('2026-10-31T09:20:00+05:30'))).toBe(20);
    // Sat 6 pm -> Mon 10 am, Sunday skipped: 60 + 60.
    expect(workingMinutes(Date.parse('2026-10-31T18:00:00+05:30'), Date.parse('2026-11-02T10:00:00+05:30'))).toBe(120);
  });
  it('writes the IST day', () => {
    expect(istDay(Date.parse('2026-10-30T20:00:00Z'))).toBe('2026-10-31');
  });
});
