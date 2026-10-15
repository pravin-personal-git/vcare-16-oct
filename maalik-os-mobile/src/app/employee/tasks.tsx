import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Banner, Button, Text } from '@/components/ui';
import { Empty, Loading, Pill, Row, SectionLabel, Segmented, SubScreen, fmtDate, useLoad, type PillTone } from '@/components/Kit';
import { myTasks, setTaskStatus, type TaskRow } from '@/lib/jobs';
import { isQueued } from '@/lib/outbox';
import { space } from '@/theme/tokens';
import { can, useAccess } from '@/lib/access';
import { DateFilter, inDateRange, type DateKey } from '@/components/DateFilter';

const TONE: Record<string, PillTone> = {
  Pending: 'warning', 'In Progress': 'brand', Completed: 'success', 'On Hold': 'neutral', Cancelled: 'danger',
};

/**
 * The tasks given to this person - the same list as Tasks on the website,
 * including tasks brought over from an old system. Tap one to start it or
 * mark it done.
 */
export default function Tasks() {
  const { t } = useT();
  const { c } = useTheme();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const access = useAccess();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(() => myTasks(scope === 'all'), [scope]);
  const { data, error: loadError, loading, reload } = useLoad(load, { everyMs: 5000 });

  /*
    Each list on its own date. An open task is judged on when it is DUE -
    "this week" means the week it has to be done in - and a finished one on
    when it was FINISHED, which is the only date that still matters once it
    is off the list. A task with no due date is always kept: no date means
    nobody set one, not that it belongs to some other week.
  */
  const [when, setWhen] = useState<DateKey>('all');
  const openTasks = (data?.open ?? []).filter((x) => inDateRange(x.dueDate, when));
  const doneTasks = (data?.finished ?? []).filter((x) => inDateRange(x.completedAt, when));

  const move = async (task: TaskRow, status: string) => {
    setBusy(true); setError(null);
    try {
      const r = await setTaskStatus(task.id, status);
      if (!r) return;
      // No signal (F-13): kept on the phone; the list still shows the last copy until it is sent.
      setNotice(isQueued(r) ? t(r.message) : null);
      setOpenId(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not update the task.'));
    } finally { setBusy(false); }
  };

  const row = (task: TaskRow) => {
    const canChange = !!data && can(access, 'tasks.update') && (task.assignedToId === data.me || data.canManage);
    const done = task.status === 'Completed' || task.status === 'Cancelled';
    return (
      <View key={task.id}>
        <Row
          title={task.title}
          line={task.description ?? undefined}
          meta={[
            task.dueDate ? t(`Due ${fmtDate(task.dueDate)}`) : null,
            scope === 'all' ? task.assignedToName ?? t('Unassigned') : null,
            task.priority === 'High' ? t('High priority') : null,
          ].filter(Boolean).join(' · ')}
          onPress={canChange ? () => setOpenId(openId === task.id ? null : task.id) : undefined}
          right={<Pill label={t(task.isOverdue && !done ? 'Overdue' : task.status)} tone={task.isOverdue && !done ? 'danger' : TONE[task.status] ?? 'neutral'} />}
        />
        {openId === task.id && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingVertical: space.sm }}>
            {task.status !== 'In Progress' && !done && <Button label={t('Start')} variant="secondary" icon="clock" loading={busy} onPress={() => move(task, 'In Progress')} />}
            {!done && <Button label={t('Mark done')} icon="check" loading={busy} onPress={() => move(task, 'Completed')} />}
            {done && <Button label={t('Reopen')} variant="secondary" loading={busy} onPress={() => move(task, 'Pending')} />}
          </View>
        )}
      </View>
    );
  };

  return (
    <SubScreen title={t('Tasks')} subtitle={t('Work assigned to you')} onRefresh={reload}>
      {data?.canManage && (
        <Segmented value={scope} onChange={(k) => { setScope(k); setOpenId(null); }} options={[{ key: 'mine', label: t('Mine') }, { key: 'all', label: t('Whole branch') }]} />
      )}
      <DateFilter value={when} onChange={setWhen} />
      {(error || loadError) && <Banner tone="danger">{error ?? loadError}</Banner>}
      {notice && <Banner tone="warning">{notice}</Banner>}
      {loading && !data ? <Loading /> : data && (
        openTasks.length === 0 && doneTasks.length === 0
          ? (
            <Empty
              icon="check"
              title={when === 'all' ? t('No tasks') : t('None in this period')}
              line={when === 'all' ? t('Tasks given to you on the website appear here.') : t('Tap All to see every task.')}
            />
          )
          : (
            <>
              <SectionLabel>{t(`To do (${openTasks.length})`)}</SectionLabel>
              {openTasks.length === 0 ? <Text variant="small" color={c.muted}>{t('Nothing open. Well done.')}</Text> : openTasks.map(row)}
              {doneTasks.length > 0 && <SectionLabel>{t('Finished in the last 30 days')}</SectionLabel>}
              {doneTasks.map(row)}
            </>
          )
      )}
    </SubScreen>
  );
}
