'use client';

import { useMemo, useState, useTransition, type CSSProperties } from 'react';
import { PageHeader, SectionCard, Badge, StatusBadge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import {
  BUTTON_SHAPES, CORNERS, DENSITY_OPTIONS, FONTS, HEADING_BACKINGS, HEADING_FONTS, HEADING_STYLES, HEADING_WEIGHTS,
  LINK_STYLES, NUMBER_WEIGHTS, PRESETS, QUIET_BUTTONS, SIDEBARS, TEXT_SIZES,
  hexToTriple, tripleToHex, type Appearance,
} from '@/lib/appearance';
import { resetAppearanceAction, saveAppearanceAction } from './actions';
import { PageBackgroundPicker } from './PageBackgroundPicker';
import { LookPicker } from './LookPicker';
import { pageBackgroundCss, pageColours, type PageBackground } from '@/lib/page-background';
import {
  ATLAS, CARD_GLASS, behindOf, isDarkBehind, mixHex, readabilityChecks, resolveText, type Look,
} from '@/lib/look';

/**
 * Settings › Appearance (UI refresh, 4 Oct 2026). Controls on the left, a live
 * preview of a real Atlas screen on the right. Saving applies to everybody in
 * the business on their next page; each person can still pick Light / Dark,
 * contrast and spacing for themselves from their own menu.
 */
type State = Appearance & { primary: string; navy: string };

function Choice<T extends string>({ label, hint, value, options, onChange, disabled }: {
  label: string;
  hint?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="field-label">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={`h-9 rounded-sm border px-3 text-sm font-semibold transition ${
              value === o.value
                ? 'border-brand bg-brand/10 text-on-tint-brand'
                : 'border-border bg-card text-foreground hover:border-border-strong'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </fieldset>
  );
}

const PREVIEW_MENU: IconName[] = ['home', 'users', 'receipt', 'package', 'settings'];

const PREVIEW_ROWS = [
  { no: 'INV-BR001-2026-0142', name: 'Shree Ganesh Traders', amount: '₹ 48,260.00', status: 'paid', label: 'Paid' },
  { no: 'INV-BR001-2026-0141', name: 'Mehta Cold Storage', amount: '₹ 1,12,900.00', status: 'overdue', label: 'Overdue' },
  { no: 'INV-BR001-2026-0140', name: 'Patil Engineering Works', amount: '₹ 23,450.00', status: 'partial_paid', label: 'Part paid' },
];

/** A font list where each name is shown in its own face. */
function FontList({ label, value, options, onChange, disabled }: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; cssVar: string }[];
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="field-label">{label}</legend>
      <div className="thin-scroll grid max-h-64 gap-1.5 overflow-y-auto pe-1">
        {options.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={value === f.value}
            onClick={() => onChange(f.value)}
            style={f.cssVar ? { fontFamily: `var(${f.cssVar}), sans-serif` } : undefined}
            className={`flex items-center justify-between gap-2 rounded-sm border px-3 py-2 text-start text-base font-semibold transition ${
              value === f.value ? 'border-brand bg-brand/10 text-on-tint-brand' : 'border-border bg-card hover:border-border-strong'
            }`}
          >
            <span className="truncate">{f.label}</span>
            <span className="shrink-0 text-sm font-medium text-muted-foreground">₹ 1,23,456 · <i>Aa</i></span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The live preview: the whole look at once - brand, fonts, page background,
 * colours and text (12 Oct 2026). Built from the same rules the real pages
 * use (lib/look resolveText), so what reads here reads there.
 */
function Preview({ s, look, bg, orgName }: { s: State; look: Look; bg: PageBackground; orgName: string }) {
  const font = FONTS.find((f) => f.value === s.font)!;
  const hf = HEADING_FONTS.find((f) => f.value === s.headingFont)!;
  const c = CORNERS.find((o) => o.value === s.corners)!;
  const pc = pageColours(bg);
  const b = behindOf(look, pc, s.headingBacking);
  const t = resolveText(look, pc, s.headingBacking);
  const card = look.box.card ?? ATLAS.card;
  const alpha = CARD_GLASS.find((g) => g.value === look.cardGlass)!.alpha;
  const darkCard = isDarkBehind([card]);
  const cardBg = alpha < 1 ? `color-mix(in srgb, ${card} ${Math.round(alpha * 100)}%, transparent)` : card;
  const border = look.box.border ?? (darkCard ? mixHex(card, ATLAS.card, 0.14) : ATLAS.border);
  const top = look.box.topBar ?? card;
  const topShade = mixHex(top, isDarkBehind([top]) ? ATLAS.card : ATLAS.ink, 0.07);
  const btnRadius = BUTTON_SHAPES.find((o) => o.value === s.buttonShape)!.radius || '9999px';
  const zoom = s.textSize === 'small' ? 0.94 : s.textSize === 'large' ? 1.06 : 1;
  const link = t.link ?? (t.linkOnDark ? `color-mix(in srgb, ${s.primary} 45%, white)` : s.primary);
  const mainBtn = look.box.button ?? s.primary;
  const style = {
    '--font-sans': `var(${font.cssVar})`,
    fontFamily: `var(${font.cssVar}), ui-sans-serif, system-ui, sans-serif`,
    '--radius-sm': c.sm, '--radius': c.md, '--radius-lg': c.lg,
    '--ctl-h': s.density === 'compact' ? '2.125rem' : '2.5rem',
    '--row-py': s.density === 'compact' ? '0.5rem' : '0.75rem',
    ...(hexToTriple(s.primary) ? { '--brand-primary': hexToTriple(s.primary)! } : {}),
    ...(hexToTriple(s.navy) ? { '--brand-navy': hexToTriple(s.navy)! } : {}),
    ...(look.box.card ? { '--card': hexToTriple(card)! } : {}),
    '--border': hexToTriple(border)!,
    '--foreground': hexToTriple(t.body)!,
    '--muted-foreground': hexToTriple(t.soft)!,
    color: t.body,
  } as CSSProperties;
  const quiet: CSSProperties = s.quietButtons === 'soft'
    ? { borderRadius: btnRadius, background: `color-mix(in srgb, ${s.primary} 9%, ${card})`, color: `color-mix(in srgb, ${s.primary} 70%, ${t.body})` }
    : s.quietButtons === 'outline'
      ? { borderRadius: btnRadius, background: 'transparent', boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${t.heading} 55%, transparent)`, color: t.heading }
      : { borderRadius: btnRadius };
  const sidebar = s.sidebar === 'light' ? 'sidebar-light' : s.sidebar === 'charcoal' ? 'sidebar-dark sidebar-charcoal' : 'sidebar-dark';
  const backing: CSSProperties = s.headingBacking === 'glass'
    ? { background: `color-mix(in srgb, ${card} 72%, transparent)`, backdropFilter: 'blur(10px)', border: `1px solid color-mix(in srgb, ${card} 60%, transparent)`, borderRadius: c.lg, padding: '.75rem 1rem' }
    : s.headingBacking === 'solid' ? { background: card, border: `1px solid ${border}`, borderRadius: c.lg, padding: '.75rem 1rem' } : {};
  const tiles: [string, string, IconName, string][] = [
    ['Pending', '3', 'clock', 'text-info'], ['Paid', '14', 'check-circle', 'text-success'], ['Overdue', '12', 'alert-triangle', 'text-danger'],
  ];
  const underline = s.links === 'underline' ? 'underline underline-offset-[3px]' : '';
  const zebra = (i: number) => (i % 2 && look.box.zebra ? look.box.zebra : 'transparent');
  const mainVars = {
    ...(hexToTriple(mainBtn) ? { '--brand-primary': hexToTriple(mainBtn)! } : {}),
    ...(t.button && hexToTriple(t.button) ? { '--brand-primary-fg': hexToTriple(t.button)! } : {}),
  } as CSSProperties;

  return (
    <div style={style} className="overflow-hidden rounded-lg border border-border shadow-raised">
      <div className="flex min-h-[25rem]">
        <aside className={`${sidebar} hidden w-40 shrink-0 flex-col gap-0.5 border-e border-border bg-card p-2.5 sm:flex`}>
          <p className="px-2 pb-2 text-sm font-extrabold text-navy">{orgName}</p>
          {PREVIEW_MENU.map((ic, i) => (
            <span
              key={ic}
              className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm ${i === 2 ? 'bg-brand/10 font-semibold text-brand' : 'text-foreground'}`}
            >
              <Icon name={ic} className="h-4 w-4 opacity-80" />
              {['Dashboard', 'Customers', 'Invoices', 'Stock', 'Settings'][i]}
            </span>
          ))}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-xs" style={{ background: top, color: t.topBar, borderColor: mixHex(top, t.topBar, 0.16) }}>
            <span className="rounded-md px-2 py-1" style={{ background: topShade }}>Back</span>
            <span className="max-w-[12rem] flex-1 rounded-full px-3 py-1" style={{ background: topShade }}>Search</span>
            <span className="ms-auto rounded-full px-2.5 py-1" style={{ background: topShade }}>Bhilai Main (NN)</span>
          </div>
          <div className="flex-1 p-4" style={{ background: pageBackgroundCss(bg) ?? ATLAS.page, zoom }}>
            <div className="mb-4 flex flex-wrap items-center gap-3" style={backing}>
              <span className="grid h-10 w-10 place-items-center rounded bg-brand/15 text-sm font-bold" style={{ color: isDarkBehind(b.heading) ? ATLAS.card : s.primary }}>IN</span>
              <div className="me-auto min-w-0">
                <p
                  className="text-h2 leading-tight"
                  style={{
                    color: t.heading,
                    fontFamily: hf.cssVar ? `var(${hf.cssVar}), sans-serif` : undefined,
                    fontWeight: Number(s.headingWeight),
                    fontStyle: s.headingStyle === 'italic' ? 'italic' : 'normal',
                    textTransform: s.headingStyle === 'caps' ? 'uppercase' : 'none',
                    letterSpacing: s.headingStyle === 'caps' ? '.04em' : undefined,
                  }}
                >
                  Invoices
                </p>
                <p className="text-sm" style={{ color: t.subtitle }}>29 raised · <span className="font-medium text-warning">₹ 4.47 L receivable</span></p>
              </div>
              <Button style={quiet} icon="refresh">Convert (13)</Button>
              <span style={mainVars}>
                <Button variant="primary" icon="plus" style={{ borderRadius: btnRadius }}>Invoice</Button>
              </span>
            </div>
            <div className="mb-4 grid grid-cols-3 gap-2">
              {tiles.map(([label, n, icon, tone]) => (
                <div key={label} className="rounded border px-3 py-3" style={{ background: cardBg, borderColor: border, backdropFilter: alpha < 1 ? 'blur(8px)' : undefined }}>
                  <span className="flex items-center gap-2">
                    <Icon name={icon} className={`h-4 w-4 ${tone}`} />
                    <span className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
                  </span>
                  <p className={`mt-2 font-mono text-2xl font-semibold ${label === 'Overdue' ? 'text-danger' : ''}`} style={label === 'Overdue' ? undefined : { color: t.tile }}>{n}</p>
                </div>
              ))}
            </div>
            <div className="overflow-hidden rounded border" style={{ background: cardBg, borderColor: border, backdropFilter: alpha < 1 ? 'blur(8px)' : undefined }}>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {/* Colours inline on the cells: the saved look's own rules (main thead th) must not paint the preview. */}
                    {['Invoice', 'Customer', 'Amount', 'Status'].map((h) => (
                      <th key={h} className="border-b px-3 py-2.5 text-start text-micro font-semibold uppercase tracking-wide" style={{ background: b.tableHeader[0], color: t.tableHeader, borderColor: border }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PREVIEW_ROWS.map((r, i) => (
                    <tr key={r.no}>
                      <td className="border-b px-3 py-[var(--row-py)]" style={{ borderColor: border, background: zebra(i) }}>
                        <span className={`font-mono text-xs font-bold ${underline}`} style={{ color: link }}>{r.no}</span>
                      </td>
                      <td className="border-b px-3 py-[var(--row-py)] font-medium" style={{ borderColor: border, background: zebra(i), color: t.body }}>{r.name}</td>
                      <td className="border-b px-3 py-[var(--row-py)] text-end font-mono tabular-nums" style={{ borderColor: border, background: zebra(i), color: t.body, fontWeight: Number(s.numberWeight) }}>{r.amount}</td>
                      <td className="border-b px-3 py-[var(--row-py)]" style={{ borderColor: border, background: zebra(i) }}><StatusBadge status={r.status} label={r.label} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 flex items-center gap-2 text-xs" style={{ color: t.subtitle }}>
              <Badge tone="info">30 days</Badge> credit · dated 12 Oct 2026
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppearanceClient({ initial, defaults, orgName, canEdit, pageBackground, look: savedLook }: {
  /** Settings > Appearance > Page background (12 Oct 2026). */
  pageBackground: PageBackground;
  /** Settings > Appearance > Colours and text (12 Oct 2026). */
  look: Look;
  initial: State;
  defaults: { primary: string; navy: string };
  orgName: string;
  canEdit: boolean;
}) {
  const [s, setS] = useState<State>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const set = <K extends keyof State>(k: K, v: State[K]) => { setS((p) => ({ ...p, [k]: v })); setMsg(null); };
  const presets = useMemo(() => PRESETS.map((p) => ({ ...p, primaryHex: tripleToHex(p.primary), navyHex: tripleToHex(p.navy) })), []);
  const shownPrimary = s.primary || defaults.primary;
  const shownNavy = s.navy || defaults.navy;
  const [bg, setBg] = useState<PageBackground>(pageBackground);
  const [look, setLook] = useState<Look>(savedLook);
  const [lookSaved, setLookSaved] = useState<Look>(savedLook);
  const checks = readabilityChecks(look, pageColours(bg), s.headingBacking, shownPrimary);

  const save = () => start(async () => {
    const res = await saveAppearanceAction(s);
    setMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: 'Saved. Everyone here sees it on their next page.' });
    if (!res.error) window.location.reload();
  });
  const reset = () => start(async () => {
    const res = await resetAppearanceAction();
    if (res.error) setMsg({ ok: false, text: res.error });
    else window.location.reload();
  });

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        badge="palette"
        title="Appearance"
        subtitle="How Atlas looks for everybody in this business - the website, the customer portal, the shop and printed documents."
        actions={canEdit && (
          <>
            {confirmReset ? (
              <span className="flex items-center gap-2 text-sm">
                Reset everything to the Atlas look?
                <Button size="sm" variant="danger" onClick={reset} loading={pending}>Yes, reset</Button>
                <Button size="sm" onClick={() => setConfirmReset(false)}>No</Button>
              </span>
            ) : (
              <Button icon="rotate-ccw" onClick={() => setConfirmReset(true)}>Reset to Atlas defaults</Button>
            )}
            <Button variant="primary" icon="check" onClick={save} loading={pending}>Save</Button>
          </>
        )}
      />

      {msg && (
        <p role="status" className={`mb-4 rounded-sm border px-3 py-2 text-sm font-medium ${msg.ok ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger'}`}>
          {msg.text}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <SectionCard title="Brand colour" icon="palette">
            <p className="field-label">Presets</p>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => {
                const on = shownPrimary.toLowerCase() === p.primaryHex.toLowerCase();
                return (
                  <button
                    key={p.value}
                    type="button"
                    disabled={!canEdit}
                    title={p.label}
                    aria-label={p.label}
                    aria-pressed={on}
                    onClick={() => { set('primary', p.primaryHex); set('navy', p.navyHex); }}
                    className={`h-9 w-9 rounded-full border-2 shadow-card transition hover:scale-105 ${on ? 'border-foreground ring-2 ring-brand/30' : 'border-card'}`}
                    style={{ background: p.primaryHex }}
                  />
                );
              })}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="field-label">Main colour</span>
                <input type="color" disabled={!canEdit} value={shownPrimary} onChange={(e) => set('primary', e.target.value)}
                  className="h-ctl w-full cursor-pointer rounded-sm border border-border bg-card p-1" />
              </label>
              <label className="block">
                <span className="field-label">Deep colour</span>
                <input type="color" disabled={!canEdit} value={shownNavy} onChange={(e) => set('navy', e.target.value)}
                  className="h-ctl w-full cursor-pointer rounded-sm border border-border bg-card p-1" />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Buttons, the active menu item, tabs and links use the main colour. Paid, overdue and pending keep
              their own green, red and blue in every business.
            </p>
          </SectionCard>

          <SectionCard title="Type and layout" icon="sliders">
            <div className="flex flex-col gap-4">
              <FontList label="Font (body, menus and tables)" value={s.font} options={FONTS} onChange={(v) => set('font', v as State['font'])} disabled={!canEdit} />
              <Choice label="Text size" value={s.textSize} options={TEXT_SIZES} onChange={(v) => set('textSize', v)} disabled={!canEdit}
                hint="For everybody. Each person can still choose larger text for themselves from their menu." />
              <Choice label="Numbers in tables" value={s.numberWeight} options={NUMBER_WEIGHTS} onChange={(v) => set('numberWeight', v)} disabled={!canEdit} />
              <Choice label="Sidebar" value={s.sidebar} options={SIDEBARS} onChange={(v) => set('sidebar', v)} disabled={!canEdit} />
              <Choice label="Corners" value={s.corners} options={CORNERS} onChange={(v) => set('corners', v)} disabled={!canEdit} />
              <Choice
                label="Spacing" value={s.density} options={DENSITY_OPTIONS} onChange={(v) => set('density', v)} disabled={!canEdit}
                hint="The business default. Each person can still choose their own from their menu."
              />
              <Choice label="Links" value={s.links} options={LINK_STYLES} onChange={(v) => set('links', v)} disabled={!canEdit} />
            </div>
          </SectionCard>

          <SectionCard title="Page headings" icon="pencil">
            <div className="flex flex-col gap-4">
              <FontList label="Heading font" value={s.headingFont} options={HEADING_FONTS} onChange={(v) => set('headingFont', v as State['headingFont'])} disabled={!canEdit} />
              <Choice label="Heading weight" value={s.headingWeight} options={HEADING_WEIGHTS} onChange={(v) => set('headingWeight', v)} disabled={!canEdit} />
              <Choice label="Heading style" value={s.headingStyle} options={HEADING_STYLES} onChange={(v) => set('headingStyle', v)} disabled={!canEdit} />
              <Choice
                label="Behind the heading" value={s.headingBacking} options={HEADING_BACKINGS} onChange={(v) => set('headingBacking', v)} disabled={!canEdit}
                hint="A frosted plate or a solid band keeps the title readable on any page background."
              />
            </div>
          </SectionCard>

          <SectionCard title="Buttons" icon="zap">
            <div className="flex flex-col gap-4">
              <Choice label="Button shape" value={s.buttonShape} options={BUTTON_SHAPES} onChange={(v) => set('buttonShape', v)} disabled={!canEdit} />
              <Choice
                label="Everyday buttons" value={s.quietButtons} options={QUIET_BUTTONS} onChange={(v) => set('quietButtons', v)} disabled={!canEdit}
                hint="Convert, Export, Views and the rest. The main button's colour is under Colours and text."
              />
            </div>
          </SectionCard>
          <p className="-mt-2 text-xs text-muted-foreground">Brand, fonts, headings and buttons are saved with the Save button at the top.</p>

          <PageBackgroundPicker initial={pageBackground} canEdit={canEdit} onChange={setBg} />

          <LookPicker look={look} saved={lookSaved} onChange={setLook} onSaved={setLookSaved} checks={checks} canEdit={canEdit} />

          <p className="rounded-sm border border-border bg-card px-3 py-2.5 text-sm text-muted-foreground">
            <Icon name="moon" className="me-1.5 inline h-4 w-4 align-[-3px]" />
            Light or dark, and larger, higher-contrast text, are each person&apos;s own choice: their initials, top
            right, then <b className="text-foreground">Look</b> and <b className="text-foreground">Text</b>.
          </p>
        </div>

        <div className="min-w-0 lg:sticky lg:top-0 lg:self-start">
          <p className="eyebrow mb-2">Live preview</p>
          <Preview s={{ ...s, primary: shownPrimary, navy: shownNavy }} look={look} bg={bg} orgName={orgName} />
        </div>
      </div>
    </div>
  );
}
