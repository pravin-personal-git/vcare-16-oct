'use client';

import { useState } from 'react';
import { PageHeader, Badge, Card, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import {
  COLUMN_LABEL, rowPadding, showsColumn,
  type DocumentTemplate, type HeaderStyle, type OptionalColumn, type TemplateOptions,
} from '@/lib/document-templates';
import { saveDocumentsAction } from './actions';

/**
 * Choosing how documents print (workstream C).
 *
 * The preview is live and uses the same helpers the printed page does, so a
 * client cannot pick something that looks different when it comes out of the
 * printer. That is the whole reason `rowPadding` and `showsColumn` live in
 * lib rather than in the paper component.
 */

type DocType = 'quotation' | 'invoice' | 'challan';

const DOC_LABEL: Record<DocType, string> = {
  quotation: 'Quotation',
  invoice: 'Invoice',
  challan: 'Delivery challan',
};

const HEADERS: { value: HeaderStyle; label: string }[] = [
  { value: 'banner', label: 'Coloured band' },
  { value: 'minimal', label: 'Plain line' },
  { value: 'centred', label: 'Centred' },
];

export function DocumentsClient({ builtIns, custom, chosen, canEdit }: {
  builtIns: DocumentTemplate[];
  custom: TemplateOptions;
  chosen: Record<DocType, string>;
  canEdit: boolean;
}) {
  const [picks, setPicks] = useState(chosen);
  const [opts, setOpts] = useState<TemplateOptions>(custom);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const set = (patch: Partial<TemplateOptions>) => setOpts((o) => ({ ...o, ...patch }));

  const anyCustom = Object.values(picks).includes('custom');

  const save = async () => {
    setBusy(true);
    const r = await saveDocumentsAction({ picks, options: opts });
    setBusy(false);
    setNote(r.error ? { tone: 'bad', text: r.error } : { tone: 'ok', text: 'Saved.' });
  };

  // What the preview shows: the custom options when one is being edited,
  // otherwise whichever built-in the quotation uses.
  const previewOptions = anyCustom
    ? opts
    : builtIns.find((b) => b.id === picks.quotation)?.options ?? builtIns[0]!.options;

  return (
    <>
      <PageHeader
        badge="DOC"
        title="Document layouts"
        subtitle="How your quotations, invoices and challans look to a customer"
      />

      {note && (
        <Card className={`mb-3 px-3 py-2.5 ${note.tone === 'bad' ? 'border-danger' : 'border-success'}`}>
          <p className={`text-sm ${note.tone === 'bad' ? 'text-danger' : 'text-success'}`}>{note.text}</p>
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid gap-3">
          <SectionCard title="Which layout, for which document" icon="file-text">
            <div className="grid gap-3">
              {(Object.keys(DOC_LABEL) as DocType[]).map((doc) => (
                <label key={doc} className="block text-sm">
                  <span className="mb-1 block font-medium">{DOC_LABEL[doc]}</span>
                  <select
                    value={picks[doc]} disabled={!canEdit}
                    onChange={(e) => setPicks((p) => ({ ...p, [doc]: e.target.value }))}
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  >
                    {builtIns.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                    <option value="custom">Your own layout</option>
                  </select>
                </label>
              ))}
            </div>

            <div className="mt-3 grid gap-2 border-t border-border pt-3">
              {builtIns.map((b) => (
                <p key={b.id} className="text-xs leading-relaxed text-muted-foreground">
                  <strong className="text-foreground">{b.label}</strong> &mdash; {b.hint}
                </p>
              ))}
              <p className="text-xs leading-relaxed text-muted-foreground">
                <strong className="text-foreground">Your own layout</strong> &mdash; the settings
                below. The tax lines, totals and document number are always printed; everything
                else is yours.
              </p>
            </div>
          </SectionCard>

          <SectionCard
            title="Your own layout"
            icon="sliders"
            action={anyCustom ? <Badge tone="success">In use</Badge> : <Badge tone="neutral">Not in use</Badge>}
          >
            {!anyCustom && (
              <p className="mb-3 text-xs text-muted-foreground">
                Choose &ldquo;Your own layout&rdquo; above for a document to print with these.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Header</span>
                <select
                  value={opts.headerStyle} disabled={!canEdit}
                  onChange={(e) => set({ headerStyle: e.target.value as HeaderStyle })}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  {HEADERS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                </select>
              </label>

              <label className="block text-sm">
                <span className="mb-1 block font-medium">Row spacing</span>
                <select
                  value={opts.density} disabled={!canEdit}
                  onChange={(e) => set({ density: e.target.value as TemplateOptions['density'] })}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact &mdash; more lines per page</option>
                </select>
              </label>
            </div>

            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">Accent colour</span>
              <div className="flex items-center gap-2">
                <input
                  type="color" disabled={!canEdit}
                  /**
                   * `input type="color"` cannot take a CSS variable - the
                   * browser requires a literal hex. This is the swatch shown
                   * before the client has chosen anything; the document
                   * itself still falls back to the theme token when
                   * `accentColour` is empty, so nothing is hard-branded.
                   */
                  // eslint-disable-next-line no-restricted-syntax
                  value={opts.accentColour || '#808080'}
                  onChange={(e) => set({ accentColour: e.target.value })}
                  className="h-9 w-14 rounded-md border border-border bg-background"
                />
                {opts.accentColour && canEdit && (
                  <Button variant="ghost" onClick={() => set({ accentColour: '' })}>
                    Use the company colour
                  </Button>
                )}
              </div>
            </label>

            <fieldset className="mt-3">
              <legend className="mb-1 text-sm font-medium">Columns to print</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {(Object.keys(COLUMN_LABEL) as OptionalColumn[]).map((c) => (
                  <label key={c} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox" disabled={!canEdit}
                      checked={opts.columns.includes(c)}
                      onChange={(e) => set({
                        columns: e.target.checked
                          ? [...opts.columns, c]
                          : opts.columns.filter((x) => x !== c),
                      })}
                    />
                    <span>{COLUMN_LABEL[c]}</span>
                  </label>
                ))}
              </div>
              {/* The things that are never optional, said once so nobody
                  hunts for a switch that does not exist. */}
              <p className="mt-1.5 text-xs text-muted-foreground">
                Description, quantity, amount, tax and the total are always printed.
              </p>
            </fieldset>

            <fieldset className="mt-3">
              <legend className="mb-1 text-sm font-medium">Show</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {([
                  ['showLogo', 'Logo'],
                  ['showGstin', 'GSTIN'],
                  ['showSeal', 'Company seal'],
                  ['showSignature', 'Signature block'],
                  ['showBankDetails', 'Bank details'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox" disabled={!canEdit}
                      checked={opts[key]}
                      onChange={(e) => set({ [key]: e.target.checked } as Partial<TemplateOptions>)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">Cover note</span>
              <textarea
                rows={2} disabled={!canEdit} value={opts.coverNote}
                onChange={(e) => set({ coverNote: e.target.value })}
                placeholder="Thank you for your enquiry. We are pleased to quote as follows."
                className="w-full rounded-md border border-border bg-background p-2 text-sm"
              />
            </label>

            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">Terms (leave empty to use your saved Terms)</span>
              <textarea
                rows={3} disabled={!canEdit} value={opts.termsOverride}
                onChange={(e) => set({ termsOverride: e.target.value })}
                className="w-full rounded-md border border-border bg-background p-2 text-sm"
              />
            </label>

            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">Footer line</span>
              <input
                disabled={!canEdit} value={opts.footerNote}
                onChange={(e) => set({ footerNote: e.target.value })}
                placeholder="This is a computer-generated document."
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              />
            </label>

            {canEdit && (
              <div className="mt-4 flex justify-end">
                <Button icon="check" loading={busy} onClick={() => void save()}>Save</Button>
              </div>
            )}
          </SectionCard>
        </div>

        <Preview options={previewOptions} />
      </div>
    </>
  );
}

/**
 * A miniature of the printed page.
 *
 * Uses the same `showsColumn` and `rowPadding` helpers the real document
 * does - if they ever disagree, the bug is in one place rather than two.
 */
function Preview({ options }: { options: TemplateOptions }) {
  const accent = options.accentColour || 'var(--brand, #6d4aff)';
  const pad = rowPadding(options);

  return (
    <SectionCard title="How it will print" icon="eye">
      <div className="rounded-md border border-border bg-white p-4 text-black shadow-sm">
        {options.headerStyle === 'banner' && (
          <div className="mb-3 flex items-center gap-2 rounded p-2 text-white" style={{ background: accent }}>
            {options.showLogo && <div className="h-7 w-7 rounded bg-white/30" />}
            <div>
              <p className="text-xs font-bold leading-tight">Your Company</p>
              {options.showGstin && <p className="text-xs opacity-90">GSTIN: 22AAAAA0000A1Z5</p>}
            </div>
          </div>
        )}
        {options.headerStyle === 'minimal' && (
          <div className="mb-3 border-b-2 pb-2" style={{ borderColor: accent }}>
            <p className="text-xs font-bold">Your Company</p>
            {options.showGstin && <p className="text-xs text-neutral-600">GSTIN: 22AAAAA0000A1Z5</p>}
          </div>
        )}
        {options.headerStyle === 'centred' && (
          <div className="mb-3 text-center">
            {options.showLogo && <div className="mx-auto mb-1 h-7 w-7 rounded" style={{ background: accent }} />}
            <p className="text-xs font-bold">Your Company</p>
            {options.showGstin && <p className="text-xs text-neutral-600">GSTIN: 22AAAAA0000A1Z5</p>}
          </div>
        )}

        {options.coverNote && (
          <p className="mb-2 text-xs leading-relaxed text-neutral-700">{options.coverNote}</p>
        )}

        <table className="w-full text-xs">
          <thead>
            <tr className="border-b" style={{ borderColor: accent }}>
              {showsColumn(options, 'srNo') && <th className={`${pad} text-start`}>#</th>}
              <th className={`${pad} text-start`}>Description</th>
              {showsColumn(options, 'code') && <th className={`${pad} text-start`}>Code</th>}
              {showsColumn(options, 'hsn') && <th className={`${pad} text-start`}>HSN</th>}
              <th className={`${pad} text-end`}>Qty</th>
              {showsColumn(options, 'rate') && <th className={`${pad} text-end`}>Rate</th>}
              {showsColumn(options, 'discount') && <th className={`${pad} text-end`}>Disc</th>}
              {showsColumn(options, 'tax') && <th className={`${pad} text-end`}>Tax</th>}
              <th className={`${pad} text-end`}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2].map((n) => (
              <tr key={n} className="border-b border-neutral-200">
                {showsColumn(options, 'srNo') && <td className={pad}>{n}</td>}
                <td className={pad}>Sample item {n}</td>
                {showsColumn(options, 'code') && <td className={pad}>P-100{n}</td>}
                {showsColumn(options, 'hsn') && <td className={pad}>8414</td>}
                <td className={`${pad} text-end`}>{n}</td>
                {showsColumn(options, 'rate') && <td className={`${pad} text-end`}>5,000</td>}
                {showsColumn(options, 'discount') && <td className={`${pad} text-end`}>0</td>}
                {showsColumn(options, 'tax') && <td className={`${pad} text-end`}>18%</td>}
                <td className={`${pad} text-end`}>{(5000 * n).toLocaleString('en-IN')}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-2 flex justify-end">
          <p className="text-xs font-bold">Total ₹17,700</p>
        </div>

        {options.termsOverride && (
          <p className="mt-2 border-t border-neutral-200 pt-1 text-xs leading-relaxed text-neutral-600">
            {options.termsOverride.slice(0, 180)}
          </p>
        )}

        {(options.showBankDetails || options.showSignature) && (
          <div className="mt-2 flex items-end justify-between border-t border-neutral-200 pt-2">
            {options.showBankDetails
              ? <p className="text-xs text-neutral-600">Bank: HDFC · A/c 00000000 · IFSC HDFC0000000</p>
              : <span />}
            {options.showSignature && (
              <div className="text-end">
                {options.showSeal && <div className="ms-auto mb-1 h-6 w-6 rounded-full border border-neutral-300" />}
                <p className="text-xs font-semibold">For Your Company</p>
              </div>
            )}
          </div>
        )}

        {options.footerNote && (
          <p className="mt-2 text-center text-xs text-neutral-500">{options.footerNote}</p>
        )}
      </div>

      <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
        <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        A miniature, drawn with the same rules the printed page uses. Your real logo, colours
        and company details replace the samples.
      </p>
    </SectionCard>
  );
}
