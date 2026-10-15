'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { saveTermsTemplateAction, termsTemplatesAction } from '@/app/actions/search-options';
import type { TermsDocType, TermsTemplateOption } from '@/server/terms-templates';

/**
 * Terms & Conditions on a quotation, order or invoice (26 Sep 2026).
 *
 * Replaces a bare textarea (and, on quotations, three hard-coded templates).
 * - A NEW document starts with the template marked as its type's default.
 * - Pick any other template from the list; the text stays editable.
 * - A product whose category has its own terms offers them - "Use" swaps the
 *   text, "Add" appends them below what is there.
 * - "Save as template" keeps what was typed for next time.
 * Editing an existing document never changes its saved text by itself.
 */
export function TermsPicker({
  docType, value, onChange, autoApply, categories = [], placeholder, rows = 4,
}: {
  docType: TermsDocType;
  value: string;
  onChange: (text: string) => void;
  /** True on a new document - fill in the default once the templates load. */
  autoApply: boolean;
  /** Category names of the products on the document. */
  categories?: (string | null | undefined)[];
  placeholder?: string;
  rows?: number;
}) {
  const [templates, setTemplates] = useState<TermsTemplateOption[] | null>(null);
  const [canSave, setCanSave] = useState(false);
  const [pickedId, setPickedId] = useState('');
  const [naming, setNaming] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const applied = useRef(false);
  const latest = useRef({ value, onChange, autoApply });
  latest.current = { value, onChange, autoApply };

  useEffect(() => {
    let live = true;
    termsTemplatesAction().then((r) => {
      if (!live) return;
      setTemplates(r.templates);
      setCanSave(r.canSave);
      const def = r.templates.find((t) => t.docTypes.includes(docType));
      if (def && latest.current.autoApply && !applied.current) {
        applied.current = true;
        latest.current.onChange(def.body);
        setPickedId(def.id);
      }
    }).catch(() => { if (live) setTemplates([]); });
    return () => { live = false; };
  }, [docType]);

  const picked = templates?.find((t) => t.id === pickedId) ?? null;
  const edited = !!picked && picked.body.trim() !== value.trim();

  // Category templates for products on the document whose text is not already in.
  const suggestions = useMemo(() => {
    if (!templates) return [];
    const cats = new Set(categories.filter((c): c is string => !!c));
    return templates.filter((t) => t.id !== pickedId
      && !dismissed.includes(t.id)
      && t.categories.some((c) => cats.has(c))
      && !value.includes(t.body.trim()));
  }, [templates, categories, pickedId, dismissed, value]);

  const choose = (id: string) => {
    const t = templates?.find((x) => x.id === id);
    setPickedId(id);
    setMsg(null);
    if (t) onChange(t.body);
  };

  const save = async () => {
    if (naming === null) return;
    setSaving(true);
    setMsg(null);
    const r = await saveTermsTemplateAction(naming, value);
    setSaving(false);
    if ('error' in r && r.error) { setMsg({ tone: 'err', text: r.error }); return; }
    if ('template' in r && r.template) {
      const t = r.template;
      setTemplates((xs) => [...(xs ?? []), t].sort((a, b) => a.name.localeCompare(b.name)));
      setPickedId(t.id);
      setNaming(null);
      setMsg({ tone: 'ok', text: `Saved as "${t.name}" - it is in the list from now on.` });
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Terms template"
          value={pickedId}
          onChange={(e) => (e.target.value ? choose(e.target.value) : setPickedId(''))}
          className="field-input h-9 min-w-0 flex-1"
          disabled={!templates}
        >
          <option value="">
            {!templates ? 'Loading templates…' : templates.length ? '- Pick a terms template -' : 'No templates yet - type below'}
          </option>
          {templates?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}{t.docTypes.includes(docType) ? ' (default)' : ''}
            </option>
          ))}
        </select>
        {canSave && value.trim() && naming === null && (!picked || edited) && (
          <button type="button" onClick={() => { setNaming(''); setMsg(null); }}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted">
            <Icon name="plus" className="h-3.5 w-3.5" /> Save as template
          </button>
        )}
      </div>

      {naming !== null && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 p-2">
          <input
            autoFocus
            aria-label="New template name"
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } if (e.key === 'Escape') setNaming(null); }}
            placeholder="Name, e.g. CCTV - 1 year warranty"
            className="field-input h-8 min-w-0 flex-1 text-xs"
          />
          <button type="button" disabled={saving || !naming.trim()} onClick={() => void save()}
            className="h-8 rounded-lg bg-brand px-3 text-xs font-semibold text-white disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setNaming(null)} className="h-8 px-2 text-xs text-muted-foreground">Cancel</button>
        </div>
      )}

      {suggestions.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
          <Icon name="sparkles" className="h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            <b>{t.name}</b> - terms for {t.categories.filter((c) => categories.includes(c)).join(', ')} on this document
          </span>
          <button type="button" onClick={() => choose(t.id)} className="font-semibold text-brand hover:underline">Use</button>
          <button type="button" onClick={() => { onChange(value.trim() ? `${value.trimEnd()}\n${t.body}` : t.body); }}
            className="font-semibold text-brand hover:underline">Add below</button>
          <button type="button" aria-label="Dismiss" onClick={() => setDismissed((d) => [...d, t.id])} className="text-muted-foreground">
            <Icon name="x" className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      <textarea
        aria-label="Terms and conditions"
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Terms and conditions printed on the document'}
        className="field-input resize-y text-xs leading-relaxed"
      />
      {(edited || msg) && (
        <p className={`text-xs ${msg?.tone === 'err' ? 'text-danger' : 'text-muted-foreground'}`}>
          {msg?.text ?? `Edited from "${picked?.name}" - the change is for this document only.`}
        </p>
      )}
    </div>
  );
}
