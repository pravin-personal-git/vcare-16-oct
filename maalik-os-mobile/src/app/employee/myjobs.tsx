import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Card, Field, Text } from '@/components/ui';
import { Empty, Loading, Pill, Segmented, SectionLabel, SubScreen, fmtDateTime, useLoad } from '@/components/Kit';
import { TopTabs } from '@/components/TopTabs';
import { complaintAction, installationStep, myComplaints, myInstallations, STATUS_LABEL, statusTone } from '@/lib/jobs';
import { useAccess } from '@/lib/access';
import { ApiError } from '@/lib/api';
import { isQueued } from '@/lib/outbox';
import { radius, space } from '@/theme/tokens';

/**
 * MY JOBS (31 Oct 2026, phone 1.0.36) - complaints, installations and their
 * visits in one list, grouped by what the technician has to do next:
 * working now, new (accept), to do today, waiting on the customer, later.
 * Done and closed jobs are not shown. Search finds a job by customer, number,
 * area or problem; the chips narrow it. Replaces the Installs, Complaints
 * and Visits tabs and their date filters (they filtered on the challan's
 * dispatch date, not on the day the work is due).
 */
type Kind = 'complaint' | 'installation';
type Group = 'now' | 'fresh' | 'today' | 'waiting' | 'later';
interface Job {
  key: string; kind: Kind; id: string; no: string; customer: string; what: string; site: string | null;
  status: string; typeLabel: string; visitAt: string | null; toScan: number; urgent: boolean; group: Group;
}

const DONE = new Set(['resolved', 'closed', 'cancelled', 'billed', 'work_done', 'approved']);
const ORDER: Group[] = ['now', 'fresh', 'today', 'waiting', 'later'];
const istDay = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

function groupOf(status: string, visitAt: string | null): Group {
  if (status === 'on_the_way' || status === 'on_site' || status === 'in_progress') return 'now';
  if (status === 'assigned') return 'fresh';
  if (status === 'awaiting_customer' || status === 'awaiting_estimate') return 'waiting';
  return visitAt && istDay(visitAt) > istDay(new Date()) ? 'later' : 'today';
}

export default function MyJobs() {
  const { t } = useT();
  const { c } = useTheme();
  const access = useAccess();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const load = useCallback(async () => {
    const all = scope === 'all';
    // Either list may be switched off for the role - one failing must not hide the other.
    const [cm, ins] = await Promise.all([
      access.sections.complaints ? myComplaints(all).catch(() => null) : Promise.resolve(null),
      access.sections.installations ? myInstallations(all).catch(() => null) : Promise.resolve(null),
    ]);
    return { cm, ins };
  }, [scope, access.sections.complaints, access.sections.installations]);
  const { data, error, loading, reload } = useLoad(load, { everyMs: 60_000 });
  const [seen, setSeen] = useState(false);
  useFocusEffect(useCallback(() => {
    if (seen) void reload(); else setSeen(true);
  }, [seen, reload]));

  const [q, setQ] = useState('');
  const [chip, setChip] = useState<'all' | 'fresh' | 'todo' | 'waiting'>('all');
  const [kind, setKind] = useState<'all' | Kind>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);

  // The next open visit of each job - the day the work is due.
  const nextVisit = new Map<string, string>();
  for (const v of data?.cm?.visits ?? []) {
    const k = v.installationChallanId ? `installation:${v.installationChallanId}` : `complaint:${v.complaintId}`;
    const was = nextVisit.get(k);
    if (!was || v.scheduledAt < was) nextVisit.set(k, v.scheduledAt);
  }
  const jobs: Job[] = [
    ...(data?.cm?.complaints ?? []).filter((r) => !DONE.has(r.status)).map((r): Job => {
      const visitAt = nextVisit.get(`complaint:${r.id}`) ?? null;
      return {
        key: `complaint:${r.id}`, kind: 'complaint', id: r.id, no: r.complaintNo, customer: r.customerName,
        what: [r.productName, r.description].filter(Boolean).join(' - '), site: r.siteLocation, status: r.status,
        typeLabel: r.jobType === 'installation' ? t('Installation') : r.jobType === 'repair' ? t('Repair') : t('Complaint'),
        visitAt, toScan: 0, urgent: r.priority === 'high' || r.priority === 'urgent', group: groupOf(r.status, visitAt),
      };
    }),
    ...(data?.ins?.installations ?? []).map((r) => ({ r, status: r.stage ?? (r.status === 'pending' ? 'accepted' : r.status) }))
      .filter(({ status }) => !DONE.has(status)).map(({ r, status }): Job => {
        const visitAt = nextVisit.get(`installation:${r.id}`) ?? null;
        return {
          key: `installation:${r.id}`, kind: 'installation', id: r.id, no: r.challanNo, customer: r.customerName,
          what: `${r.totalQty} ${t('items to fit')}`, site: r.siteAddress, status,
          typeLabel: t('Installation'), visitAt, toScan: r.unscanned, urgent: false, group: groupOf(status, visitAt),
        };
      }),
  ];

  const needle = q.trim().toLowerCase();
  const base = jobs.filter((j) => (kind === 'all' || j.kind === kind)
    && (!needle || [j.customer, j.no, j.what, j.site ?? ''].join(' ').toLowerCase().includes(needle)));
  const inChip = (j: Job, k: typeof chip) => k === 'all' || (k === 'todo' ? ['now', 'today', 'later'].includes(j.group) : j.group === k);
  const count = (k: typeof chip) => base.filter((j) => inChip(j, k)).length;
  const sortKey = (j: Job) => `${ORDER.indexOf(j.group)}${j.urgent ? 0 : 1}${j.visitAt ?? '9'}`;
  const shown = base.filter((j) => inChip(j, chip)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const grouped = !needle && chip === 'all';
  const TITLE: Record<Group, string> = {
    now: t('Working now'), fresh: t('New - accept these'), today: t('To do today'), waiting: t('Waiting on customer'), later: t('Later'),
  };

  const open = (j: Job) => router.push(j.kind === 'complaint'
    ? { pathname: '/employee/complaint/[id]', params: { id: j.id } }
    : { pathname: '/employee/installation/[id]', params: { id: j.id } });

  // Accept and On my way straight from the list; everything else opens the job.
  const quick = (j: Job): { op: string; label: string; done: string } | null =>
    j.status === 'assigned' ? { op: 'accept', label: t('Accept job'), done: 'Accepted - the customer can see you are assigned.' }
      : (j.status === 'accepted' || j.status === 'scheduled') && j.group === 'today' ? { op: 'on_the_way', label: t('On my way'), done: 'The customer can see you are on the way.' }
        : null;
  const run = async (j: Job, op: string, done: string) => {
    setBusy(j.key); setMsg(null);
    try {
      const r = j.kind === 'complaint' ? await complaintAction(j.id, { op }) : await installationStep(j.id, { op });
      setMsg(isQueued(r) ? { tone: 'warning', text: t(r.message) } : { tone: 'success', text: t(done) });
      await reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.') });
    } finally {
      setBusy(null);
    }
  };

  const card = (j: Job) => {
    const next = quick(j);
    return (
      <Card key={j.key} style={{ gap: space.sm }}>
        <Pressable accessibilityRole="button" onPress={() => open(j)} style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
            <Pill label={j.typeLabel} tone={j.kind === 'installation' ? 'brand' : 'neutral'} />
            {j.visitAt ? <Text variant="small" weight="semibold" color={c.inkSoft}>{fmtDateTime(j.visitAt)}</Text> : null}
          </View>
          <Text weight="bold">{j.customer}</Text>
          {j.what ? <Text variant="small" color={c.inkSoft} numberOfLines={2}>{j.what}</Text> : null}
          <Text variant="micro" color={c.muted} numberOfLines={1}>{[j.no, j.site].filter(Boolean).join(' · ')}</Text>
          <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap', marginTop: space.xs }}>
            <Pill label={t(STATUS_LABEL[j.status] ?? j.status)} tone={statusTone(j.status)} />
            {j.toScan > 0 && <Pill label={`${j.toScan} ${t('to scan')}`} tone="warning" />}
            {j.urgent && <Pill label={t('Urgent')} tone="danger" />}
          </View>
        </Pressable>
        {next && <Button label={next.label} loading={busy === j.key} onPress={() => void run(j, next.op, next.done)} />}
      </Card>
    );
  };

  const CHIPS: { key: typeof chip; label: string }[] = [
    { key: 'all', label: t('All') }, { key: 'fresh', label: t('New') }, { key: 'todo', label: t('To do') }, { key: 'waiting', label: t('Waiting') },
  ];

  return (
    <SubScreen title={t('My jobs')} subtitle={t('Complaints and installations')} onRefresh={reload}>
      <TopTabs current="myjobs" />
      {access.scope.complaints === 'branch' && (
        <Segmented value={scope} onChange={setScope} options={[{ key: 'mine', label: t('Mine') }, { key: 'all', label: t('Whole branch') }]} />
      )}
      <Field label={t('Search')} icon="search" value={q} onChangeText={setQ} placeholder={t('Customer, job no, area, problem')} autoCorrect={false} />
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        {CHIPS.map((k) => {
          const on = chip === k.key;
          return (
            <Pressable key={k.key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setChip(k.key)}
              style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brandSoft : 'transparent' }}>
              <Text variant="small" weight="semibold" color={on ? c.brand : c.inkSoft}>{`${k.label} ${data ? count(k.key) : ''}`.trim()}</Text>
            </Pressable>
          );
        })}
      </View>
      {access.sections.complaints && access.sections.installations && (
        <Segmented value={kind} onChange={setKind} options={[
          { key: 'all', label: t('All') }, { key: 'complaint', label: t('Complaints') }, { key: 'installation', label: t('Installations') },
        ]} />
      )}
      {error && <Banner tone="danger">{error}</Banner>}
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      {loading && !data ? <Loading /> : data && (
        shown.length === 0
          ? <Empty icon="wrench" title={needle ? t('No job matches') : t('Nothing to do')}
              line={needle ? t('Try a name, a job number or an area.') : t('Jobs assigned to you appear here.')} />
          : grouped
            ? ORDER.filter((g) => shown.some((j) => j.group === g)).map((g) => (
                <View key={g} style={{ gap: space.md }}>
                  <SectionLabel>{`${TITLE[g]} (${shown.filter((j) => j.group === g).length})`}</SectionLabel>
                  {shown.filter((j) => j.group === g).map(card)}
                </View>
              ))
            : shown.map(card)
      )}
    </SubScreen>
  );
}
