'use client';

import { useState, useTransition } from 'react';
import { SectionCard, Segmented } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import {
  ATLAS, BOX_KEYS, BOX_LABELS, CARD_GLASS, DEFAULT_LOOK, TEXT_KEYS, TEXT_LABELS,
  type BoxKey, type CardGlass, type Look, type Readability, type TextKey,
} from '@/lib/look';
import { tripleToHex } from '@/lib/appearance';
import { ColourField } from './PageBackgroundPicker';
import { saveLookAction } from './actions';

/** The Atlas colour each box starts from in the picker, when nothing is chosen. */
const BOX_START: Record<BoxKey, string> = {
  topBar: ATLAS.card, card: ATLAS.card, tableHeader: ATLAS.surface, zebra: ATLAS.surface, border: ATLAS.border, button: ATLAS.brand,
};

/** Ready-made colour sets (HSL, like the palette presets - no hex in src). Text stays on Auto. */
const SETS: { label: string; box: Partial<Record<BoxKey, string>>; glass?: CardGlass }[] = [
  { label: 'Atlas white', box: {} },
  { label: 'Sky', box: { topBar: '0 0% 100%', tableHeader: '214 100% 96.5%', zebra: '214 100% 98.5%', border: '216 40% 91%' } },
  { label: 'Vcare magenta', box: { topBar: '292 83% 16%', tableHeader: '300 50% 95%', zebra: '300 60% 98%', border: '296 38% 89%', button: '298 88% 34%' } },
  { label: 'Mint', box: { topBar: '153 69% 19%', tableHeader: '150 39% 93%', zebra: '150 43% 97%', border: '151 33% 86%', button: '159 80% 30%' } },
  { label: 'Warm paper', box: { topBar: '43 100% 99%', card: '40 100% 99.4%', tableHeader: '38 52% 91%', zebra: '36 63% 95%', border: '38 44% 84%', button: '26 90% 37%' } },
  { label: 'Frosted glass', box: { tableHeader: '220 20% 97%' }, glass: 'frosted' },
  { label: 'Deep night', box: { topBar: '222 47% 11%', card: '217 33% 17%', tableHeader: '216 29% 22%', zebra: '217 31% 20%', border: '215 25% 27%', button: '199 89% 48%' } },
];

/**
 * Settings > Appearance > Colours and text (12 Oct 2026, Pravin: "these
 * columns and boxes are still all white ... no option to change the colour of
 * the text"). Controlled by AppearanceClient so the one live preview shows it;
 * saved on its own, like the page background.
 */
export function LookPicker({ look, saved, onChange, onSaved, checks, canEdit }: {
  look: Look;
  saved: Look;
  onChange: (l: Look) => void;
  onSaved: (l: Look) => void;
  /** Readability of every text against what sits behind it (lib/look readabilityChecks). */
  checks: Readability[];
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const changed = JSON.stringify(look) !== JSON.stringify(saved);
  const hard = checks.filter((c) => !c.ok);

  const setBox = (k: BoxKey, v: string | null) => { onChange({ ...look, box: { ...look.box, [k]: v } }); setNote(null); };
  const setText = (k: TextKey, v: string | null) => { onChange({ ...look, text: { ...look.text, [k]: v } }); setNote(null); };
  // "Fix for me": every hard-to-read text that was set by hand goes back to Auto.
  const fix = () => onChange({ ...look, text: { ...look.text, ...Object.fromEntries(hard.map((c) => [c.key, null])) } });

  const save = () => start(async () => {
    setNote(null);
    const r = await saveLookAction(look);
    if (r.error) setNote({ error: true, text: r.error });
    else { onSaved(look); setNote({ error: false, text: 'Saved - everyone sees it on their next page (light mode).' }); }
  });

  const row = (label: string, value: string | null, start0: string, set: (v: string | null) => void, autoWord: string) => (
    <li key={label} className="flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 text-sm">{label}</span>
      <span className="flex items-center gap-2">
        <span className={value ? '' : 'opacity-40'}>
          <ColourField label={label} value={value ?? start0} onChange={(v) => set(v)} disabled={!canEdit} />
        </span>
        <button
          type="button" disabled={!canEdit} aria-pressed={!value} onClick={() => set(null)}
          className={`h-9 rounded-md border px-2.5 text-xs font-semibold transition ${!value ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-card text-muted-foreground hover:border-border-strong'}`}
        >
          {autoWord}
        </button>
      </span>
    </li>
  );

  return (
    <SectionCard title="Colours and text" icon="palette">
      <div className="grid gap-5">
        <div>
          <p className="field-label">Ready-made sets</p>
          <div className="flex flex-wrap gap-1.5">
            {SETS.map((s) => (
              <button
                key={s.label} type="button" disabled={!canEdit}
                onClick={() => onChange({
                  box: Object.fromEntries(BOX_KEYS.map((k) => [k, s.box[k] ? tripleToHex(s.box[k]!) : null])) as Look['box'],
                  cardGlass: s.glass ?? 'solid',
                  text: { ...DEFAULT_LOOK.text },
                })}
                className="rounded-full border border-border px-2.5 py-1 text-xs font-medium hover:border-brand"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="field-label">Boxes</p>
          <ul className="grid gap-2">
            {BOX_KEYS.map((k) => row(BOX_LABELS[k], look.box[k], BOX_START[k], (v) => setBox(k, v), 'Atlas'))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-sm">Cards see-through</span>
            <Segmented<CardGlass>
              size="sm" value={look.cardGlass}
              onChange={(v) => canEdit && onChange({ ...look, cardGlass: v })}
              options={CARD_GLASS.map((g) => ({ value: g.value, label: g.label }))}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            The main button colour here wins over the brand colour for buttons only. A dark card colour switches
            inputs and lines to dark too, so nothing light is left behind white text.
          </p>
        </div>

        <div>
          <p className="field-label">Text colours</p>
          <p className="mb-2 text-xs text-muted-foreground">
            Auto picks dark or white for each text from what sits behind it, so a dark background can never hide a
            heading again. Pick a colour to choose your own.
          </p>
          <ul className="grid gap-2">
            {TEXT_KEYS.map((k) => row(TEXT_LABELS[k], look.text[k], k === 'link' ? ATLAS.brand : k === 'button' ? ATLAS.card : ATLAS.ink, (v) => setText(k, v), 'Auto'))}
          </ul>
        </div>

        <div role="status" className={`rounded-lg px-3 py-2 text-xs ${hard.length ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
          {hard.length ? (
            <span className="flex flex-wrap items-center gap-2">
              <Icon name="alert-triangle" className="h-4 w-4" />
              Hard to read: {hard.map((c) => `${c.label} (${c.ratio}:1)`).join(', ')}.
              {canEdit && hard.some((c) => look.text[c.key]) && (
                <button type="button" onClick={fix} className="font-semibold underline underline-offset-2">Fix for me</button>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-2"><Icon name="check" className="h-4 w-4" />Every text passes the readability check.</span>
          )}
        </div>

        {note && <p role={note.error ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-xs ${note.error ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>{note.text}</p>}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon="check" disabled={pending || !changed} onClick={save}>{pending ? 'Saving…' : 'Save colours and text'}</Button>
            {changed && <Button variant="outline" onClick={() => onChange(saved)}>Undo</Button>}
            <Button variant="ghost" onClick={() => onChange(DEFAULT_LOOK)}>All Atlas defaults</Button>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
