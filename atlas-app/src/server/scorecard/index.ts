import 'server-only';
import { db } from '../db';
import { userInScope, type StoreScope } from '../store-scope';
import { distancePerDay } from '../distance';
import { mergeSettings, PILLAR_LABEL, templateForRoleName, type Pillar, type ScorecardSettings, type Template } from '@/lib/scorecard/settings';
import { overallScore, peerMedian, peerScores, pillarScore, ranks, type MetricDef } from '@/lib/scorecard/score';
import { METRICS, NOT_MEASURED } from '@/lib/scorecard/metrics';
import { istDay, periodRange, previousRange, type PeriodKey } from '@/lib/scorecard/period';

/** The score for the period before, kept per person and period for an hour: it does not change once the period is over. */
const previousCache = new Map<string, { at: number; score: number | null }>();
import { clearKey, type EngineOut } from './common';
import { fieldEngine } from './field';
import { officeEngine } from './office';

/**
 * ONE PERSON'S SCORECARD (31 Oct 2026). Loads the template's peers, runs the
 * template's engine over the period, scores every metric against the peers and
 * hands the page everything it shows, evidence included.
 */

export async function scorecardSettings(storeId: string): Promise<ScorecardSettings> {
  const row = await db.scorecardSettings.findUnique({ where: { storeId }, select: { settings: true } });
  return mergeSettings(row?.settings);
}

/** Everyone in scope with the template their roles give them (field wins over office). */
export async function scoredPeople(scope: StoreScope, s: ScorecardSettings) {
  const users = await db.user.findMany({
    where: { ...userInScope(scope), isActive: true },
    select: { id: true, fullName: true, storeRoles: { where: { deletedAt: null }, select: { roleId: true, role: { select: { name: true } } } } },
  });
  return users.map((u) => {
    const kinds = u.storeRoles.map((r) => s.roleTemplates[r.roleId] ?? templateForRoleName(r.role.name));
    const template: Template | null = kinds.includes('field') ? 'field' : kinds.includes('office') ? 'office' : null;
    return { id: u.id, name: u.fullName, template };
  });
}

interface Scored {
  out: EngineOut;
  defs: MetricDef[];
  scores: Map<string, Map<string, number | null>>;
  pillars: Map<string, Partial<Record<Pillar, number | null>>>;
  overall: Map<string, number | null>;
}

async function scoreTemplate(
  scope: StoreScope, storeIds: string[], template: Template, ids: string[], from: Date, to: Date, s: ScorecardSettings, cleared: Set<string>,
): Promise<Scored> {
  const out = template === 'field'
    ? await fieldEngine(scope, storeIds, ids, from, to, s, cleared)
    : await officeEngine(scope, storeIds, ids, from, to, s, cleared);
  const defs = METRICS[template];
  const scores = new Map<string, Map<string, number | null>>();
  for (const d of defs) scores.set(d.key, peerScores(d, out.values.get(d.key) ?? new Map(), s.limits.minEvents));
  const weights = s.weights[template] as Partial<Record<Pillar, number>>;
  const pillars = new Map<string, Partial<Record<Pillar, number | null>>>();
  const overall = new Map<string, number | null>();
  for (const id of ids) {
    const p: Partial<Record<Pillar, number | null>> = {};
    for (const pillar of Object.keys(weights) as Pillar[]) {
      p[pillar] = pillarScore(defs.filter((d) => d.pillar === pillar).map((d) => scores.get(d.key)?.get(id) ?? null));
    }
    pillars.set(id, p);
    overall.set(id, overallScore(p, weights));
  }
  return { out, defs, scores, pillars, overall };
}

export interface ScorecardView {
  template: Template;
  period: { key: PeriodKey; label: string; from: string; to: string };
  person: { id: string; name: string };
  overall: number | null;
  previous: number | null;
  rank: number | null;
  peerCount: number;
  peers: { id: string; name: string; overall: number | null; rank: number | null }[];
  pillars: { key: Pillar; label: string; weight: number; score: number | null; median: number | null }[];
  metrics: { key: string; pillar: Pillar; label: string; unit: MetricDef['unit']; better: MetricDef['better']; hint: string; source: string; value: number | null; n: number; score: number | null; median: number | null }[];
  evidence: { metric: string; ruleKey: string | null; refId: string; refNo: string; href: string; at: string; text: string; weight: number }[];
  cleared: { ruleKey: string; refId: string; reason: string; by: string; at: string }[];
  fixes: number;
  distance: { day: string; km: number | null }[] | null;
  rewards: { label: string; ok: boolean | null; value: string }[];
  notes: { kind: string; body: string; amountPaise: number | null; at: string; by: string }[];
  notMeasured: string[];
  weights: Record<string, number>;
}

export async function scorecardFor(
  scope: StoreScope, storeIds: string[], settingsStoreId: string, userId: string, periodKey: PeriodKey,
): Promise<ScorecardView | null> {
  const s = await scorecardSettings(settingsStoreId);
  const people = await scoredPeople(scope, s);
  const me = people.find((p) => p.id === userId);
  if (!me?.template) return null;
  const template = me.template;
  const peers = people.filter((p) => p.template === template);
  const ids = peers.map((p) => p.id);
  const clearings = await db.scoreClearing.findMany({
    where: { subjectUserId: { in: ids } }, orderBy: { createdAt: 'desc' },
    select: { subjectUserId: true, ruleKey: true, refId: true, reason: true, clearedBy: true, createdAt: true },
  });
  const cleared = new Set(clearings.map((c) => clearKey(c.subjectUserId, c.ruleKey, c.refId)));

  const { from, to, label } = periodRange(periodKey);
  const prev = previousRange(periodKey);
  const cacheKey = `${userId}|${periodKey}|${prev.from.toISOString()}`;
  const cached = previousCache.get(cacheKey);
  const [now, before] = await Promise.all([
    scoreTemplate(scope, storeIds, template, ids, from, to, s, cleared),
    cached && Date.now() - cached.at < 3_600_000 ? Promise.resolve(null) : scoreTemplate(scope, storeIds, template, ids, prev.from, prev.to, s, cleared),
  ]);
  const previous = before ? (before.overall.get(userId) ?? null) : cached!.score;
  if (before) previousCache.set(cacheKey, { at: Date.now(), score: previous });
  const rankOf = ranks(now.overall);
  const weights = s.weights[template] as Record<string, number>;
  const pillarKeys = Object.keys(weights) as Pillar[];
  const medianOf = (xs: (number | null | undefined)[]) => {
    const v = xs.filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m]! : Math.round((v[m - 1]! + v[m]!) / 2);
  };

  const metrics = now.defs.map((d) => {
    const v = now.out.values.get(d.key)?.get(userId) ?? { value: null, n: 0 };
    return {
      key: d.key, pillar: d.pillar, label: d.label, unit: d.unit, better: d.better, hint: d.hint, source: d.source,
      value: v.value, n: v.n, score: now.scores.get(d.key)?.get(userId) ?? null,
      median: peerMedian(d, now.out.values.get(d.key) ?? new Map(), s.limits.minEvents),
    };
  });
  const val = (k: string) => metrics.find((m) => m.key === k)?.value ?? null;
  const overall = now.overall.get(userId) ?? null;
  const mistakes = (now.out.evidence.get(userId) ?? []).filter((e) => e.weight >= 2).length;
  const rewards = template === 'field'
    ? [
      { label: `Score ${s.rewards.field.minScore} or above`, ok: overall === null ? null : overall >= s.rewards.field.minScore, value: overall === null ? '-' : String(overall) },
      { label: `Late ${s.rewards.field.maxLate} or fewer per 20 days`, ok: val('r_late') === null ? null : val('r_late')! <= s.rewards.field.maxLate, value: val('r_late') === null ? '-' : String(val('r_late')) },
      { label: `Rating ${s.rewards.field.minRating} or above`, ok: val('f_rating') === null ? null : val('f_rating')! >= s.rewards.field.minRating, value: val('f_rating') === null ? '-' : `${val('f_rating')} ★` },
      { label: 'No job taken away for not acting', ok: (val('f_taken') ?? 0) === 0, value: String(val('f_taken') ?? 0) },
    ]
    : [
      { label: `Score ${s.rewards.office.minScore} or above`, ok: overall === null ? null : overall >= s.rewards.office.minScore, value: overall === null ? '-' : String(overall) },
      { label: `Late ${s.rewards.office.maxLate} or fewer per 20 days`, ok: val('r_late') === null ? null : val('r_late')! <= s.rewards.office.maxLate, value: val('r_late') === null ? '-' : String(val('r_late')) },
      { label: `Mistakes ${s.rewards.office.maxMistakes} or fewer`, ok: mistakes <= s.rewards.office.maxMistakes, value: String(mistakes) },
    ];

  // Distance per IST day, last 14 days (field only; null when this person is not tracked).
  let distance: ScorecardView['distance'] = null;
  if (template === 'field') {
    const todayStart = Date.parse(`${istDay(new Date())}T00:00:00+05:30`);
    const first = new Date(todayStart - 13 * 86_400_000);
    const perDay = await distancePerDay(scope, userId, storeIds, first, new Date());
    distance = perDay ? Array.from({ length: 14 }, (_, i) => {
      const d = istDay(first.getTime() + i * 86_400_000);
      const r = perDay.get(d);
      return { day: d, km: r ? Math.round(r.metres / 100) / 10 : null };
    }) : null;
  }

  const [notes, names] = await Promise.all([
    db.scoreNote.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30, select: { kind: true, body: true, amountPaise: true, createdAt: true, createdBy: true } }),
    db.user.findMany({ where: { id: { in: [...new Set([...clearings.map((c) => c.clearedBy)])] } }, select: { id: true, fullName: true } }),
  ]);
  const noteBy = notes.length ? await db.user.findMany({ where: { id: { in: [...new Set(notes.map((n) => n.createdBy))] } }, select: { id: true, fullName: true } }) : [];
  const nameOf = (id: string) => [...names, ...noteBy].find((u) => u.id === id)?.fullName ?? 'Someone';

  return {
    template,
    period: { key: periodKey, label, from: from.toISOString(), to: to.toISOString() },
    person: { id: userId, name: me.name },
    overall, previous, rank: rankOf.get(userId) ?? null, peerCount: peers.length,
    peers: peers.map((p) => ({ id: p.id, name: p.name, overall: now.overall.get(p.id) ?? null, rank: rankOf.get(p.id) ?? null }))
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.name.localeCompare(b.name)),
    pillars: pillarKeys.map((k) => ({
      key: k, label: PILLAR_LABEL[k], weight: weights[k] ?? 0, score: now.pillars.get(userId)?.[k] ?? null,
      median: medianOf(ids.map((id) => now.pillars.get(id)?.[k])),
    })),
    metrics,
    evidence: (now.out.evidence.get(userId) ?? []).sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 200)
      .map((e) => ({ ...e, at: e.at.toISOString() })),
    cleared: clearings.filter((c) => c.subjectUserId === userId).map((c) => ({ ruleKey: c.ruleKey, refId: c.refId, reason: c.reason, by: nameOf(c.clearedBy), at: c.createdAt.toISOString() })),
    fixes: now.out.values.get('o_fixes')?.get(userId)?.value ?? 0,
    distance,
    rewards,
    notes: notes.map((n) => ({ kind: n.kind, body: n.body, amountPaise: n.amountPaise, at: n.createdAt.toISOString(), by: nameOf(n.createdBy) })),
    notMeasured: NOT_MEASURED[template],
    weights,
  };
}
