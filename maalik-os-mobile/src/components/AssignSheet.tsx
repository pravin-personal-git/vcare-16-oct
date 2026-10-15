import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { Banner, Button, Text } from './ui';
import { Icon } from './Icon';
import { ApiError } from '@/lib/api';
import { assignJob } from '@/lib/owner';
import { radius, space } from '@/theme/tokens';

/**
 * Assign from the phone (owner home, Service tab - 13 Oct 2026). A complaint
 * gets one technician (tap = done); an installation gets a team (tick, then
 * Save). Through the outbox, so it also works with no signal.
 */
export interface AssignTarget { kind: 'complaint' | 'installation'; id: string; no: string; customerName: string; technicianIds: string[] }

export function AssignSheet({ job, people, onClose, onDone }: {
  job: AssignTarget | null; people: { id: string; name: string }[];
  onClose: () => void; onDone: (message: string) => void;
}) {
  const { c } = useTheme();
  const { t } = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [team, setTeam] = useState<string[]>([]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the sheet opens on a new job: start from its team
  useEffect(() => { setTeam(job?.technicianIds ?? []); setError(null); }, [job]);
  const many = job?.kind === 'installation';

  const save = async (ids: string[], key: string) => {
    if (!job) return;
    setBusy(key); setError(null);
    try {
      const r = await assignJob(job.kind, job.id, ids);
      if (r) onDone(t(r.message));
    } catch (e) {
      setError(e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.'));
    } finally { setBusy(null); }
  };

  return (
    <Modal visible={!!job} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: '#0008' }} onPress={onClose} />
      <View style={{ maxHeight: '75%', backgroundColor: c.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, gap: space.sm }}>
        <Text variant="h3" weight="bold">{many ? t('Installation team') : t('Assign to')}</Text>
        {job && <Text variant="small" color={c.inkSoft}>{`${job.no} · ${job.customerName}`}</Text>}
        {error && <Banner tone="danger">{error}</Banner>}
        <ScrollView contentContainerStyle={{ gap: space.sm, paddingBottom: space.md }}>
          {people.map((p) => {
            const on = many ? team.includes(p.id) : job?.technicianIds.includes(p.id);
            return (
              <Pressable key={p.id} accessibilityRole={many ? 'checkbox' : 'button'} accessibilityState={{ checked: !!on }} disabled={!!busy}
                onPress={() => (many ? setTeam((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id])) : void save([p.id], p.id))}
                style={({ pressed }) => ({ padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: on ? c.brand : c.line, backgroundColor: pressed || busy === p.id || on ? c.brandSoft : c.surface, flexDirection: 'row', alignItems: 'center', gap: space.sm })}>
                <Icon name={on ? 'check' : 'user'} size={18} color={c.brand} />
                <Text style={{ flex: 1 }}>{p.name}</Text>
                {busy === p.id && <Text variant="small" color={c.brand}>{t('Assigning…')}</Text>}
              </Pressable>
            );
          })}
        </ScrollView>
        {many && <Button label={t('Save team')} icon="check" loading={busy === 'team'} onPress={() => void save(team, 'team')} />}
      </View>
    </Modal>
  );
}
