import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Field, Text } from '@/components/ui';
import { Pill, type PillTone } from '@/components/Kit';
import type { JobItem } from '@/lib/jobs';
import { radius, space } from '@/theme/tokens';

/**
 * THE ITEMS ON A JOB (10 Oct 2026, repair flow stage 8). Each serial, who pays
 * for the technician (AMC) and for the part (warranty), and where it is in the
 * repair loop. The technician takes items away for repair from here - one
 * pickup receipt for what he ticks, saved on the phone when there is no
 * signal. Nothing is swapped from stock: the item goes to the supplier and
 * comes back on the same complaint. No prices are shown.
 */
type Send = (key: string, body: Record<string, unknown>, done?: string) => Promise<unknown>;

const WHERE: Record<string, { label: string; tone: PillTone }> = {
  open: { label: 'At the site', tone: 'neutral' },
  picked_up: { label: 'Taken for repair', tone: 'brand' },
  with_supplier: { label: 'At the supplier', tone: 'warning' },
  back: { label: 'Back - to hand over', tone: 'brand' },
  supplier_closed: { label: 'Supplier kept it', tone: 'warning' },
  handed_back: { label: 'Handed back', tone: 'success' },
  declined: { label: 'Returned without repair', tone: 'neutral' },
};

export function JobItemsCard({ items, canPickUp, busy, send }: { items: JobItem[]; canPickUp: boolean; busy: string | null; send: Send }) {
  const { t } = useT();
  const { c } = useTheme();
  const live = items.filter((i) => i.status !== 'cancelled');
  const open = live.filter((i) => i.status === 'open');
  const [picking, setPicking] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [who, setWho] = useState('');
  const [note, setNote] = useState('');
  if (!live.length) return null;

  const box = (on: boolean) => ({ width: 22, height: 22, borderRadius: radius.sm, borderWidth: 2, borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brand : c.surface });

  return (
    <Card style={{ gap: space.md }}>
      <Text weight="semibold">{t('Items')}</Text>
      {live.map((i) => (
        <View key={i.id} style={{ gap: 4, paddingBottom: space.sm, borderBottomWidth: 1, borderColor: c.line }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>
            <Text weight="medium">{i.equipmentName}</Text>
            <Pill label={t(WHERE[i.status]?.label ?? i.status)} tone={WHERE[i.status]?.tone ?? 'neutral'} />
            {!i.ours && <Pill label={t('Not ours')} tone="warning" />}
          </View>
          <Text variant="small" color={c.inkSoft}>{i.serialNo ? `S/N ${i.serialNo}` : t('No serial')}{i.problem ? ` · ${i.problem}` : ''}</Text>
          <Text variant="small" color={i.labour.free ? c.success : c.warning}>{t('Technician')}: {t(i.labour.free ? 'Free' : 'Customer pays')} - {t(i.labour.reason)}</Text>
          <Text variant="small" color={i.parts.free ? c.success : c.warning}>{t('Part / repair')}: {t(i.parts.free ? 'Free' : 'Customer pays')} - {t(i.parts.reason)}</Text>
          {i.repair?.newSerialNo ? <Text variant="small" color={c.inkSoft}>{t('New serial from the supplier')}: {i.repair.newSerialNo}</Text> : null}
          {i.pickupNo || i.handbackGdnNo ? (
            <Text variant="micro" color={c.muted}>{[i.pickupNo, i.handbackGdnNo].filter(Boolean).join(' · ')}</Text>
          ) : null}
        </View>
      ))}

      {canPickUp && open.length > 0 && !picking && (
        <Button icon="box" label={t('Take for repair')} onPress={() => { setPicking(true); setIds(open.map((i) => i.id)); }} />
      )}
      {picking && (
        <View style={{ gap: space.sm }}>
          <Text variant="small" color={c.inkSoft}>{t('Tick what you are taking. The customer keeps their warranty and invoice; the item comes back on this complaint.')}</Text>
          {open.map((i) => {
            const on = ids.includes(i.id);
            return (
              <Pressable key={i.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                onPress={() => setIds(on ? ids.filter((x) => x !== i.id) : [...ids, i.id])}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs }}>
                <View style={box(on)} />
                <Text variant="small">{i.equipmentName}{i.serialNo ? ` · ${i.serialNo}` : ''}</Text>
              </Pressable>
            );
          })}
          <Field label={t('Handed over by (at the customer)')} value={who} onChangeText={setWho} placeholder={t('Name of the person who gave it')} />
          <Field label={t('Note (optional)')} value={note} onChangeText={setNote} placeholder={t('With adaptor, no box')} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button style={{ flex: 1 }} variant="secondary" label={t('Cancel')} onPress={() => setPicking(false)} />
            <Button
              style={{ flex: 1 }} label={t('Make pickup receipt')} loading={busy === 'pickup'} disabled={!ids.length}
              onPress={() => void send('pickup', { op: 'pickup', itemIds: ids, handedOverBy: who.trim() || null, note: note.trim() || null }, 'Pickup receipt made.').then(() => { setPicking(false); setWho(''); setNote(''); })}
            />
          </View>
        </View>
      )}
    </Card>
  );
}
