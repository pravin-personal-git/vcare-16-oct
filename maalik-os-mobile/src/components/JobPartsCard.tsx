import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Field, Text } from '@/components/ui';
import { Pill, type PillTone } from '@/components/Kit';
import { Scanner } from '@/components/Scanner';
import { searchJobProducts, type JobParts } from '@/lib/jobs';
import { radius, space } from '@/theme/tokens';

/**
 * Parts on the technician's job (workflow slice 4, spec §4.4): raise a
 * challan while on site (search parts, add lines), see each challan's
 * approval and GDN, send unused parts back, and log the faulty part taken
 * out. None of this is shown to the customer.
 */
type Send = (key: string, body: Record<string, unknown>, done?: string) => Promise<unknown>;

const STATUS: Record<string, { label: string; tone: PillTone }> = {
  pending_approval: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved - collect from store', tone: 'brand' },
  rejected: { label: 'Rejected', tone: 'danger' },
  issued: { label: 'Issued', tone: 'success' },
};
const TYPES = [['material', 'Material'], ['replacement', 'Replacement'], ['installation', 'Installation']] as const;

export function JobPartsCard({ parts, onSite, busy, send }: { parts: JobParts; onSite: boolean; busy: string | null; send: Send }) {
  const { t } = useT();
  const { c } = useTheme();
  const [mode, setMode] = useState<null | 'challan' | 'faulty'>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const [n, setN] = useState('1');

  /**
   * The owner can hand challans to the office instead (F1a). Undefined means
   * an older server that does not know about the setting - show the button,
   * exactly as before. The server refuses it regardless of what we draw.
   */
  const mayRaise = parts.canRaiseChallan !== false;

  const show = parts.challans.length > 0 || parts.faulty.length > 0 || onSite;
  if (!show) return null;

  return (
    <Card style={{ gap: space.md }}>
      <Text weight="semibold">{t('Parts')}</Text>
      {parts.challans.map((ch) => (
        <View key={ch.id} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>
            <Text weight="medium">{ch.challanNo}</Text>
            <Pill label={t(STATUS[ch.status]?.label ?? ch.status)} tone={STATUS[ch.status]?.tone ?? 'neutral'} />
          </View>
          {ch.gdnNos.length > 0 && <Text variant="small" color={c.inkSoft}>{t('GDN')}: {ch.gdnNos.join(', ')}</Text>}
          {ch.rejectionReason && <Text variant="small" color={c.danger}>{t(`Rejected: ${ch.rejectionReason}`)}</Text>}
          {ch.lines.map((l) => (
            <View key={l.id} style={{ gap: 4 }}>
              <Text variant="small">{l.productName} × {l.qty}{l.qtyIssued > 0 ? ` · ${l.qtyIssued} ${t('issued')}, ${l.qtyReturned} ${t('returned')}, ${l.qtyIssued - l.qtyReturned} ${t('used')}` : ''}</Text>
              {(l.qtyReturnPending ?? 0) > 0 && (
                <Text variant="small" color={c.warning}>{t(`${l.qtyReturnPending} to hand in at the store - it adds them back when it receives them`)}</Text>
              )}
              {/* A request: stock goes back only when the store receives them (28 Sep 2026). */}
              {ch.status === 'issued' && l.qtyIssued - l.qtyReturned - (l.qtyReturnPending ?? 0) > 0 && (returning === l.id ? (
                <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
                  <View style={{ flex: 1 }}><Field label={t('How many unused?')} keyboardType="number-pad" value={n} onChangeText={setN} /></View>
                  <Button label={t('Send back')} loading={busy === `ret-${l.id}`}
                    onPress={() => void send(`ret-${l.id}`, { op: 'unused_parts', lineId: l.id, qty: Number(n) }, 'Noted - hand them in at the store; the store adds them back to stock.').then(() => setReturning(null))} />
                </View>
              ) : (
                <Button variant="ghost" label={t('Unused - send back to store')} onPress={() => { setReturning(l.id); setN('1'); }} />
              ))}
            </View>
          ))}
        </View>
      ))}
      {parts.faulty.map((f) => (
        <Text key={f.id} variant="small" color={c.inkSoft}>
          {f.description.startsWith('Old unit') ? t('Old unit') : t('Faulty part')}: {f.description}{f.serialNo ? ` · S/N ${f.serialNo}` : ''} · {f.receivedAt ? t('at the store') : t('to hand in')}
        </Text>
      ))}

      {!mode && onSite && (
        <View style={{ gap: space.sm }}>
          {mayRaise ? (
            <Button icon="box" label={t('Raise challan')} onPress={() => setMode('challan')} />
          ) : (
            <Text variant="small" color={c.inkSoft}>
              {t('Your office raises challans here. Tell them which parts you need.')}
            </Text>
          )}
          <Button variant="secondary" icon="alert" label={t('Log faulty part')} onPress={() => setMode('faulty')} />
        </View>
      )}
      {mode === 'challan' && <ChallanForm busy={busy} send={send} onDone={() => setMode(null)} />}
      {mode === 'faulty' && <FaultyForm busy={busy} send={send} onDone={() => setMode(null)} />}
    </Card>
  );
}

function ChallanForm({ busy, send, onDone }: { busy: string | null; send: Send; onDone: () => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const [type, setType] = useState<string>('material');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; productCode: string; productName: string }[]>([]);
  const [lines, setLines] = useState<{ productId: string; name: string; qty: string }[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Only the answer to what is typed NOW is shown - a slow answer for an
  // earlier, shorter query used to arrive last and win (emulator run, 28 Sep 2026).
  const latest = useRef(0);
  const search = async (text: string) => {
    setQ(text);
    const mine = ++latest.current;
    if (text.trim().length < 2) { setHits([]); return; }
    try {
      const r = await searchJobProducts(text.trim());
      if (mine !== latest.current) return;
      setHits(r?.products ?? []); setError(null);
    } catch {
      if (mine === latest.current) setError(t('Search failed - check the connection.'));
    }
  };
  const chip = (on: boolean) => ({ paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brandSoft : c.surface });

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {TYPES.map(([k, label]) => (
          <Pressable key={k} accessibilityRole="button" onPress={() => setType(k)} style={chip(type === k)}><Text variant="small">{t(label)}</Text></Pressable>
        ))}
      </View>
      <Field label={t('Search part by name or code')} value={q} onChangeText={(v) => void search(v)} />
      {error && <Text variant="small" color={c.danger}>{error}</Text>}
      {hits.slice(0, 8).map((h) => (
        <Pressable key={h.id} accessibilityRole="button" onPress={() => { setLines([...lines.filter((l) => l.productId !== h.id), { productId: h.id, name: h.productName, qty: '1' }]); setQ(''); setHits([]); }}
          style={{ paddingVertical: space.sm, borderBottomWidth: 1, borderColor: c.line }}>
          <Text variant="small">{h.productName} <Text variant="micro" color={c.muted}>{h.productCode}</Text></Text>
        </Pressable>
      ))}
      {lines.map((l) => (
        <View key={l.productId} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
          <View style={{ flex: 2 }}><Text variant="small">{l.name}</Text></View>
          <View style={{ flex: 1 }}><Field label={t('Qty')} keyboardType="number-pad" value={l.qty} onChangeText={(v) => setLines(lines.map((x) => (x.productId === l.productId ? { ...x, qty: v } : x)))} /></View>
          <Button variant="ghost" icon="x" label={t('Remove')} onPress={() => setLines(lines.filter((x) => x.productId !== l.productId))} />
        </View>
      ))}
      <Field label={t('Note')} value={note} onChangeText={setNote} multiline />
      <Button icon="send" label={t('Send for approval')} loading={busy === 'raise_challan'}
        disabled={!lines.length || lines.some((l) => !(Number(l.qty) > 0))}
        onPress={() => void send('raise_challan', { op: 'raise_challan', type, note, lines: lines.map((l) => ({ productId: l.productId, qty: Number(l.qty) })) }, 'Challan sent for approval - you will see when the store can issue it.').then(onDone)} />
      <Button variant="ghost" label={t('Back')} onPress={onDone} />
    </View>
  );
}

/**
 * THE FAULTY PART THE TECHNICIAN TOOK OUT (Vcare wave 3, 7 Oct 2026).
 *
 * Pravin's ruling, in his words: receiving goods at the store stays exactly as
 * it is; the technician adds the serial by TYPING it or by SCANNING it, and if
 * it has neither, a note instead.
 *
 * That third case is the one that was missing, and it is the common one. Half
 * the parts coming off a Vcare site are an unmarked power supply or a length
 * of cable - there is no serial to scan and none to type, and a form that
 * leaves the serial box empty tells the store nothing about why. So "no number
 * on it" is a thing the technician can SAY, and saying it asks for the detail
 * that does identify the part: where on the site it came off.
 *
 * Why it matters at the other end: the store receives this part, and
 * `receiveFaultyPart` opens a Replacements case from it. A case with no serial
 * and no note is the row that has been sitting at a vendor for 438 days with
 * nobody able to say what it was.
 */
function FaultyForm({ busy, send, onDone }: { busy: string | null; send: Send; onDone: () => void }) {
  const { t } = useT();
  const [what, setWhat] = useState('');
  const [serial, setSerial] = useState('');
  /** 'number' = it has one (typed or scanned). 'none' = it has not. */
  const [how, setHow] = useState<'number' | 'none'>('number');
  const [whereFrom, setWhereFrom] = useState('');
  const [scanning, setScanning] = useState(false);

  const noNumber = how === 'none';
  /*
    With no number, the note IS the identification, so it is required. With a
    number, the part identifies itself and the note is spare.
  */
  const ready = what.trim().length > 0 && (!noNumber ? serial.trim().length > 0 : whereFrom.trim().length > 0);

  const description = noNumber
    ? `${what.trim()} - no number on it. ${whereFrom.trim()}`
    : what.trim();

  return (
    <View style={{ gap: space.sm }}>
      <Field label={t('What part is faulty')} value={what} onChangeText={setWhat} placeholder={t('Burnt LED driver')} />

      {/* Two honest answers, rather than a box somebody leaves empty. */}
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            variant={noNumber ? 'ghost' : 'secondary'}
            icon="scan"
            label={t('It has a number')}
            onPress={() => setHow('number')}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            variant={noNumber ? 'secondary' : 'ghost'}
            icon="alert"
            label={t('No number on it')}
            onPress={() => setHow('none')}
          />
        </View>
      </View>

      {!noNumber ? (
        <>
          <Field label={t('Serial or barcode')} value={serial} onChangeText={setSerial} autoCapitalize="characters" />
          {/* Scanning and typing write the same field - a scan in a dark
              roof space often fails, and retyping it must always work. */}
          <Button variant="ghost" icon="scan" label={t('Scan it instead')} onPress={() => setScanning(true)} />
        </>
      ) : (
        <Field
          label={t('Where on the site did it come off')}
          value={whereFrom}
          onChangeText={setWhereFrom}
          placeholder={t('Power supply in the 2nd floor rack')}
          multiline
        />
      )}

      <Button
        label={t('Log faulty part')}
        loading={busy === 'faulty_part'}
        disabled={!ready}
        onPress={() => void send(
          'faulty_part',
          { op: 'faulty_part', description, serialNo: noNumber ? null : serial.trim() || null },
          'Logged - hand the part in at the store.',
        ).then(onDone)}
      />
      <Button variant="ghost" label={t('Back')} onPress={onDone} />

      {scanning && (
        <Scanner
          visible
          mode="code"
          title={t('Scan the faulty part')}
          prompt={t('Point the camera at the number on the part or its box.')}
          onClose={() => setScanning(false)}
          onCode={(code: string) => { setSerial(code); setScanning(false); }}
        />
      )}
    </View>
  );
}
