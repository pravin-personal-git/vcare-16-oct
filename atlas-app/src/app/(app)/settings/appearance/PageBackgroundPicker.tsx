'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { SectionCard, Segmented } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import {
  gradientPresets, pageBackgroundCss, solidPresets, type BgStop, type PageBackground,
} from '@/lib/page-background';
import { savePageBackgroundAction } from './actions';

type Mode = 'default' | 'solid' | 'gradient';

const HEX = /^#[0-9a-f]{6}$/i;

/** A colour box: the system colour picker, and the hex beside it to type or paste. */
export function ColourField({ value, onChange, label, disabled }: { value: string; onChange: (v: string) => void; label: string; disabled?: boolean }) {
  const [typed, setTyped] = useState(value);
  // A preset or another control changed the colour: show it in the box too.
  useEffect(() => { setTyped(value); }, [value]);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color" aria-label={label} value={value} disabled={disabled}
        onChange={(e) => { onChange(e.target.value); setTyped(e.target.value); }}
        className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-card p-0.5"
      />
      <input
        aria-label={`${label} (hex)`} value={typed} disabled={disabled} maxLength={7}
        onChange={(e) => { setTyped(e.target.value); if (HEX.test(e.target.value)) onChange(e.target.value.toLowerCase()); }}
        className="h-9 w-24 rounded-md border border-border bg-card px-2 font-mono text-xs"
      />
    </div>
  );
}

/**
 * Settings > Appearance > Page background (12 Oct 2026, Pravin): the grey
 * behind every page, as the product's own, one colour, or a gradient -
 * straight at any angle or round from the centre, 2 to 5 colours each with
 * its own position. Preview on the right updates as you go; Save applies it
 * for everyone in the business (light mode; dark mode keeps its own).
 */
export function PageBackgroundPicker({ initial, canEdit, onChange }: {
  initial: PageBackground;
  canEdit: boolean;
  /** Tells the page's live preview what the background now is (12 Oct 2026). */
  onChange?: (bg: PageBackground) => void;
}) {
  const solids = useMemo(() => solidPresets(), []);
  const gradients = useMemo(() => gradientPresets(), []);
  const [mode, setMode] = useState<Mode>(initial.kind);
  const [color, setColor] = useState(initial.kind === 'solid' ? initial.color : solids[1]!.color);
  const firstGradient = gradients[0]!.bg as Extract<PageBackground, { kind: 'gradient' }>;
  const [type, setType] = useState<'linear' | 'radial'>(initial.kind === 'gradient' ? initial.type : firstGradient.type);
  const [angle, setAngle] = useState(initial.kind === 'gradient' ? initial.angle : firstGradient.angle);
  const [stops, setStops] = useState<BgStop[]>(initial.kind === 'gradient' ? initial.stops : firstGradient.stops);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const [saved, setSaved] = useState<PageBackground>(initial);

  const current: PageBackground = mode === 'solid' ? { kind: 'solid', color }
    : mode === 'gradient' ? { kind: 'gradient', type, angle, stops: [...stops].sort((a, b) => a.at - b.at) }
    : { kind: 'default' };
  const preview = pageBackgroundCss(current) ?? 'hsl(var(--background))';
  const changed = JSON.stringify(current) !== JSON.stringify(saved);
  const currentKey = JSON.stringify(current);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the value, not the object
  useEffect(() => { onChange?.(current); }, [currentKey]);

  const setStop = (i: number, patch: Partial<BgStop>) => setStops((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addStop = () => setStops((ss) => (ss.length >= 5 ? ss : [...ss, { color: ss[ss.length - 1]!.color, at: 100 }].map((s, i, all) => ({ ...s, at: Math.round((i / (all.length - 1)) * 100) }))));
  const removeStop = (i: number) => setStops((ss) => (ss.length <= 2 ? ss : ss.filter((_, j) => j !== i)));

  const save = () => start(async () => {
    setNote(null);
    const r = await savePageBackgroundAction(current);
    if (r.error) setNote({ error: true, text: r.error });
    else { setSaved(current); setNote({ error: false, text: 'Saved - every page now uses it (light mode).' }); }
  });

  return (
    <SectionCard title="Page background" icon="palette">
      <div className="grid gap-4">
        <Segmented<Mode>
          value={mode}
          onChange={(m) => canEdit && setMode(m)}
          options={[{ value: 'default', label: 'Atlas grey' }, { value: 'solid', label: 'Solid colour' }, { value: 'gradient', label: 'Gradient' }]}
        />

        <div
          role="img"
          aria-label="Background preview"
          className="relative h-28 overflow-hidden rounded-lg border border-border"
          style={{ background: preview }}
        >
          <div className="absolute inset-x-4 top-4 h-8 rounded-md bg-card shadow-card" />
          <div className="absolute inset-x-4 top-14 grid grid-cols-3 gap-2">
            <div className="h-10 rounded-md bg-card shadow-card" /><div className="h-10 rounded-md bg-card shadow-card" /><div className="h-10 rounded-md bg-card shadow-card" />
          </div>
        </div>

        {mode === 'solid' && (
          <div className="grid gap-3">
            <ColourField label="Background colour" value={color} onChange={setColor} disabled={!canEdit} />
            <div className="flex flex-wrap gap-2">
              {solids.map((p) => (
                <button
                  key={p.label} type="button" disabled={!canEdit} title={p.label} aria-label={p.label}
                  onClick={() => setColor(p.color)}
                  className={`h-8 w-8 rounded-full border ${color === p.color ? 'border-brand ring-2 ring-brand/30' : 'border-border'}`}
                  style={{ background: p.color }}
                />
              ))}
            </div>
          </div>
        )}

        {mode === 'gradient' && (
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              {gradients.map((p) => (
                <button
                  key={p.label} type="button" disabled={!canEdit} title={p.label}
                  onClick={() => {
                    if (p.bg.kind !== 'gradient') return;
                    setType(p.bg.type); setAngle(p.bg.angle); setStops(p.bg.stops);
                  }}
                  className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs hover:border-brand"
                >
                  <span className="h-4 w-4 rounded-full border border-border" style={{ background: pageBackgroundCss(p.bg) ?? undefined }} />
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Segmented<'linear' | 'radial'> size="sm" value={type} onChange={(t) => canEdit && setType(t)} options={[{ value: 'linear', label: 'Straight' }, { value: 'radial', label: 'Round' }]} />
              {type === 'linear' && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Angle
                  <input type="range" min={0} max={360} step={5} value={angle} disabled={!canEdit} onChange={(e) => setAngle(Number(e.target.value))} className="w-36 accent-brand" />
                  <span className="w-10 font-mono text-foreground">{angle}°</span>
                </label>
              )}
            </div>

            <ul className="grid gap-2">
              {stops.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center gap-3">
                  <ColourField label={`Colour ${i + 1}`} value={s.color} onChange={(c) => setStop(i, { color: c })} disabled={!canEdit} />
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    At
                    <input type="range" min={0} max={100} value={s.at} disabled={!canEdit} onChange={(e) => setStop(i, { at: Number(e.target.value) })} className="w-28 accent-brand" />
                    <span className="w-9 font-mono text-foreground">{s.at}%</span>
                  </label>
                  {stops.length > 2 && canEdit && (
                    <button type="button" onClick={() => removeStop(i)} aria-label={`Remove colour ${i + 1}`} className="text-muted-foreground hover:text-danger"><Icon name="x" className="h-4 w-4" /></button>
                  )}
                </li>
              ))}
            </ul>
            {stops.length < 5 && canEdit && (
              <button type="button" onClick={addStop} className="inline-flex w-fit items-center gap-1 text-xs font-medium text-brand hover:underline"><Icon name="plus" className="h-3.5 w-3.5" />Add a colour</button>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">Applies to every page for everyone in this business, in light mode. Dark mode keeps its own dark page so text stays readable. Cards stay white on top unless you colour them below (Colours and text).</p>
        {note && <p role={note.error ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-xs ${note.error ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>{note.text}</p>}
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="primary" icon="check" disabled={pending || !changed} onClick={save}>{pending ? 'Saving…' : 'Save background'}</Button>
            {changed && (
              <Button variant="outline" onClick={() => {
                setMode(saved.kind);
                if (saved.kind === 'solid') setColor(saved.color);
                if (saved.kind === 'gradient') { setType(saved.type); setAngle(saved.angle); setStops(saved.stops); }
              }}>Undo</Button>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
