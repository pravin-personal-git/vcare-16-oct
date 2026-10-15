'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { KIND_ICON, KIND_LABEL, type ResultKind } from '@/lib/search-kinds';
import { classifyCode } from '@/lib/scan/codes';
import type { ProductLabelScan, ScanKind, ScanResult, VisitingCardScan } from '@/lib/scan/extraction';
import { ScannerOverlay } from './ScannerOverlay';
import { aiUnavailableReason, fetchAiStatus, readPhoto, type AiStatus } from './ai';
import { setHandoff, setReceiveHandoff } from './handoff';
import { QuickProductDialog } from './QuickProductDialog';
import { scanShape } from '@/lib/scan/decode';
import { cleanScannedCode } from '@/lib/scan/codes';
import { createWedgeDetector, isEditableTarget } from '@/lib/scan/wedge';
import { lookupScanAction, type CreatedProduct } from '@/app/(app)/products/scan-actions';

/**
 * The Scan button in the header - one camera for everything.
 *
 * A barcode or QR code is looked up across the whole business (the same
 * search as the box beside it): one match opens straight away, several are
 * listed, none offers the obvious next step. A photo is read by AI and sent
 * where it belongs - an invoice to Goods Receipt, a card to a new lead, a
 * box label to whatever unit or product it names.
 */

interface Hit { kind: ResultKind; title: string; subtitle: string; meta?: string; route: string }

type Step =
  | { at: 'menu' }
  | { at: 'code' }
  | { at: 'photo'; kind: ScanKind }
  | { at: 'reading'; kind: ScanKind }
  | { at: 'found'; query: string; hits: Hit[]; label?: ProductLabelScan; serial?: string | null }
  /** A barcode that names one product (G5): open it, or receive more of it. */
  | { at: 'product'; query: string; product: ScannedProduct; serial: string | null }
  /** The quick form, opened from an unknown barcode (G2). */
  | { at: 'create'; barcode: string | null; serial: string | null; thenReceive: boolean }
  | { at: 'error'; message: string };

const EMPTY_CARD: VisitingCardScan = {
  companyName: null, personName: null, designation: null, mobiles: [], email: null,
  website: null, address: null, city: null, state: null, pincode: null, gstin: null,
};

interface ScannedProduct { id: string; code: string; name: string; trackingMode: string }

async function search(q: string): Promise<Hit[]> {
  if (q.trim().length < 3) return [];
  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { cache: 'no-store' });
    const j = await r.json();
    return Array.isArray(j.hits) ? j.hits : [];
  } catch {
    return [];
  }
}

export function HeaderScanButton() {
  const router = useRouter();
  const [step, setStep] = useState<Step | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);

  useEffect(() => { if (step?.at === 'menu') fetchAiStatus().then(setAi); }, [step?.at]);

  /*
   * SCAN ANYWHERE (13 Oct 2026, lib/scan/wedge). A USB / Bluetooth barcode
   * reader types the code and presses Enter. In a focused box that already
   * works; with nothing focused it went nowhere. Now a reader's burst, on any
   * page, opens here exactly like the camera's read. A person typing is never
   * taken for a scan, and nothing is caught while another window (a dialog)
   * is open unless it is this scanner's own.
   */
  const onCodeRef = useRef<(c: string) => void>(() => undefined);
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const wedge = createWedgeDetector();
    const onKey = (e: KeyboardEvent) => {
      const s = stepRef.current;
      const ownWindow = s?.at === 'menu' || s?.at === 'found' || s?.at === 'product' || s?.at === 'error';
      const otherDialog = !ownWindow && !!document.querySelector('[role="dialog"], [aria-modal="true"]');
      const code = wedge.feed({
        key: e.key, at: e.timeStamp, editable: otherDialog || isEditableTarget(e.target) || s?.at === 'create' || s?.at === 'code' || s?.at === 'photo',
        modified: e.ctrlKey || e.altKey || e.metaKey,
      });
      if (!code) return;
      // The Enter that ended the scan must not also press a focused button.
      e.preventDefault();
      e.stopPropagation();
      const clean = cleanScannedCode(code);
      if (clean) onCodeRef.current(clean);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const close = () => setStep(null);

  const onCode = async (raw: string) => {
    setStep({ at: 'found', query: raw, hits: [] });
    // Scan-to-Stock (12 Oct 2026): a product barcode opens the product with
    // its next steps; a GS1 code is read for both its barcode and its serial.
    const shape = scanShape(raw);
    const code = shape.kind === 'gs1' ? (shape.serial ?? shape.gtin) : raw;
    const look = await lookupScanAction(code).catch(() => null);
    if (look && look.units.length === 0) {
      const byBarcode = look.products.length === 1 ? look.products[0]
        : shape.kind === 'gs1' ? (await lookupScanAction(shape.gtin).catch(() => null))?.products[0] : undefined;
      if (byBarcode && (look.products.length === 1 || shape.kind === 'gs1')) {
        setStep({ at: 'product', query: raw, product: byBarcode, serial: shape.kind === 'gs1' ? shape.serial : null });
        return;
      }
    }
    const hits = await search(code);
    if (hits.length === 1) { close(); router.push(hits[0].route); return; }
    setStep({ at: 'found', query: shape.kind === 'gs1' ? shape.gtin : code, hits, serial: shape.kind === 'gs1' ? shape.serial : null });
  };

  onCodeRef.current = (c: string) => { void onCode(c); };

  const receive = (p: ScannedProduct | CreatedProduct, serial: string | null) => {
    setReceiveHandoff({ id: p.id, name: p.name, code: p.code, trackingMode: p.trackingMode }, serial);
    close();
    router.push('/goods-receipt');
  };

  const onPhoto = async (kind: ScanKind, photo: Blob) => {
    setStep({ at: 'reading', kind });
    let result: ScanResult;
    try {
      result = await readPhoto(kind, photo);
    } catch (e) {
      setStep({ at: 'error', message: e instanceof Error ? e.message : 'Could not read that photo.' });
      return;
    }
    if (result.kind === 'supplier_invoice') {
      setHandoff(result, photo); close(); router.push('/goods-receipt'); return;
    }
    if (result.kind === 'visiting_card') {
      setHandoff(result, photo); close(); router.push('/crm/leads'); return;
    }
    // A label: the serial finds the unit, the model finds the product.
    const d = result.data;
    const queries = [...d.serials, d.model, d.barcode].filter((q): q is string => !!q);
    const seen = new Set<string>();
    const hits: Hit[] = [];
    for (const q of queries.slice(0, 4)) {
      for (const h of await search(q)) {
        if (seen.has(h.route)) continue;
        seen.add(h.route); hits.push(h);
      }
    }
    setHandoff(result, photo);
    setStep({ at: 'found', query: [d.brand, d.model].filter(Boolean).join(' ') || d.serials[0] || 'label', hits, label: d });
  };

  const newLeadWith = (card: VisitingCardScan) => {
    setHandoff({ kind: 'visiting_card', data: card }, null);
    close();
    router.push('/crm/leads');
  };

  const why = ai ? aiUnavailableReason(ai) : null;
  const choices: { key: string; icon: IconName; title: string; hint: string; ai: boolean; go: () => void }[] = [
    { key: 'code', icon: 'scan', title: 'Barcode or QR code', hint: 'Serial, product barcode, challan or invoice number - opens the record', ai: false, go: () => setStep({ at: 'code' }) },
    { key: 'inv', icon: 'file-text', title: 'Supplier invoice', hint: 'Fills a goods receipt: supplier, invoice no., items, GST', ai: true, go: () => setStep({ at: 'photo', kind: 'supplier_invoice' }) },
    { key: 'card', icon: 'user-plus', title: 'Visiting card', hint: 'Starts a new lead with the name, phones, email and GSTIN', ai: true, go: () => setStep({ at: 'photo', kind: 'visiting_card' }) },
    { key: 'label', icon: 'package', title: 'Product label', hint: 'Reads model and serial off the box and finds the unit or product', ai: true, go: () => setStep({ at: 'photo', kind: 'product_label' }) },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setStep({ at: 'menu' })}
        aria-label="Scan"
        title="Scan a barcode, QR code, invoice, visiting card or label"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <Icon name="scan" className="h-5 w-5" />
      </button>

      {step?.at === 'menu' && (
        <Modal title="Scan" subtitle="What are you pointing the camera at?" icon="scan" size="sm" onClose={close}>
          <div className="grid gap-2">
            {choices.map((c) => {
              const off = c.ai && !!why;
              return (
                <button key={c.key} type="button" disabled={off} onClick={c.go}
                  className="flex items-start gap-3 rounded-lg border border-border p-3 text-start transition hover:border-brand hover:bg-brand/[0.04] disabled:cursor-not-allowed disabled:opacity-55">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-on-tint-brand">
                    <Icon name={c.icon} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      {c.title}
                      {c.ai && <span className="rounded bg-accent/15 px-1.5 py-px text-micro font-bold uppercase tracking-wide text-accent">AI</span>}
                    </span>
                    <span className="block text-xs text-muted-foreground">{c.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 flex items-start gap-2 rounded-md bg-brand/[0.06] px-3 py-2 text-xs leading-relaxed">
            <Icon name="scan" className="mt-px h-4 w-4 shrink-0 text-brand" />
            <span>Using a USB or Bluetooth barcode reader? Just scan - on any page, no need to click anything first.</span>
          </p>
          {why && <p className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">{why}</p>}
          {ai && !why && <p className="mt-3 text-xs text-muted-foreground">{ai.remaining} of {ai.limit} AI reads left this month.</p>}
        </Modal>
      )}

      {step?.at === 'code' && (
        <ScannerOverlay mode="code" title="Scan a code" onCodes={(c) => onCode(c[0])} onClose={() => setStep((s) => (s?.at === 'code' ? null : s))} />
      )}

      {step?.at === 'photo' && (
        <ScannerOverlay
          mode="photo"
          title={step.kind === 'supplier_invoice' ? 'Supplier invoice' : step.kind === 'visiting_card' ? 'Visiting card' : 'Product label'}
          hint="The photo is read by AI."
          onPhoto={(p) => onPhoto(step.kind, p)}
          onClose={() => setStep((s) => (s?.at === 'photo' ? null : s))}
        />
      )}

      {step?.at === 'reading' && (
        <Modal title="Reading the photo…" subtitle="This takes a few seconds" icon="sparkles" size="sm" onClose={close}>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="refresh" className="h-4 w-4 animate-spin" /> Reading what is printed…
          </p>
        </Modal>
      )}

      {step?.at === 'error' && (
        <Modal title="Could not read it" icon="alert-circle" tone="danger" size="sm" onClose={close}>
          <p className="text-sm">{step.message}</p>
          <button type="button" onClick={() => setStep({ at: 'menu' })} className="mt-3 text-sm font-medium text-brand hover:underline">Try again</button>
        </Modal>
      )}

      {step?.at === 'found' && (
        <Modal title="Scanned" subtitle={step.query} icon="scan" size="sm" onClose={close}>
          {step.label && (
            <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-muted/40 p-3 text-xs">
              {step.label.brand && <><dt className="text-muted-foreground">Brand</dt><dd>{step.label.brand}</dd></>}
              {step.label.model && <><dt className="text-muted-foreground">Model</dt><dd className="font-mono">{step.label.model}</dd></>}
              {step.label.serials.length > 0 && <><dt className="text-muted-foreground">Serial</dt><dd className="font-mono">{step.label.serials.join(', ')}</dd></>}
            </dl>
          )}
          {step.hits.length > 0 ? (
            <ul className="divide-y divide-border rounded-md border border-border">
              {step.hits.map((h) => (
                <li key={h.route}>
                  <button type="button" onClick={() => { close(); router.push(h.route); }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-muted/50">
                    <Icon name={KIND_ICON[h.kind]} className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{h.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{KIND_LABEL[h.kind]} · {h.subtitle}</span>
                    </span>
                    <Icon name="chevron-right" className="h-4 w-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <NoMatch query={step.query} isLabel={!!step.label} onNewLead={newLeadWith}
              onReceive={() => { close(); router.push('/goods-receipt'); }}
              onCreate={(thenReceive) => setStep({ at: 'create', barcode: step.label ? step.label.barcode ?? null : step.query, serial: step.serial ?? step.label?.serials[0] ?? null, thenReceive })} />
          )}
          {step.label && step.hits.length > 0 && (
            <button type="button" onClick={() => { close(); router.push('/goods-receipt'); }}
              className="mt-3 text-sm font-medium text-brand hover:underline">Receive this into stock →</button>
          )}
          <button type="button" onClick={() => setStep({ at: 'menu' })} className="mt-3 block text-xs text-muted-foreground hover:underline">Scan something else</button>
        </Modal>
      )}

      {step?.at === 'product' && (
        <Modal title={step.product.name} subtitle={`${step.product.code} · barcode ${step.query}`} icon="package" size="sm" onClose={close}>
          <p className="mb-3 text-sm text-muted-foreground">
            This barcode names a <b className="text-foreground">product</b> (the model), not one box.
            {step.serial && <> The code also carries serial <span className="font-mono text-foreground">{step.serial}</span>.</>}
          </p>
          <div className="grid gap-2">
            <button type="button" onClick={() => receive(step.product, step.serial)}
              className="flex items-center gap-3 rounded-lg border border-border p-3 text-start hover:border-brand hover:bg-brand/[0.04]">
              <Icon name="download" className="h-5 w-5 text-brand" />
              <span><span className="block text-sm font-semibold">Receive more</span><span className="block text-xs text-muted-foreground">A goods receipt with this product on it</span></span>
            </button>
            <button type="button" onClick={() => { close(); router.push(`/products/stock-in?product=${step.product.id}${step.serial ? `&serial=${encodeURIComponent(step.serial)}` : ''}`); }}
              className="flex items-center gap-3 rounded-lg border border-border p-3 text-start hover:border-brand hover:bg-brand/[0.04]">
              <Icon name="plus" className="h-5 w-5 text-brand" />
              <span><span className="block text-sm font-semibold">Stock in by scan</span><span className="block text-xs text-muted-foreground">Opening stock or stock found - no supplier</span></span>
            </button>
            <button type="button" onClick={() => { close(); router.push(`/product-journey?product=${step.product.id}`); }}
              className="flex items-center gap-3 rounded-lg border border-border p-3 text-start hover:border-brand hover:bg-brand/[0.04]">
              <Icon name="eye" className="h-5 w-5 text-brand" />
              <span><span className="block text-sm font-semibold">Open the product</span><span className="block text-xs text-muted-foreground">Stock, documents and its units</span></span>
            </button>
          </div>
        </Modal>
      )}

      {step?.at === 'create' && (
        <QuickProductDialog
          barcode={step.barcode}
          actionLabel={step.thenReceive ? 'Save and receive' : 'Save product'}
          onClose={close}
          onCreated={(p) => {
            if (step.thenReceive) receive(p, step.serial);
            else { close(); router.push(`/product-journey?product=${p.id}`); }
          }}
        />
      )}
    </>
  );
}

function NoMatch({ query, isLabel, onNewLead, onReceive, onCreate }: {
  query: string;
  isLabel: boolean;
  onNewLead: (card: VisitingCardScan) => void;
  onReceive: () => void;
  /** G2: make the product from this code (`true` = then receive it). */
  onCreate: (thenReceive: boolean) => void;
}) {
  const kind = classifyCode(query);
  const shape = scanShape(query);
  // A product barcode (or anything that is not a phone, GSTIN or link) can become a product.
  const productish = isLabel || shape.kind === 'barcode' || shape.kind === 'gs1' || (kind === 'text' && shape.kind === 'unclear');
  return (
    <div className="space-y-2 text-sm">
      <p>Nothing on file matches <span className="font-mono font-semibold">{query}</span>.</p>
      {!isLabel && kind === 'text' && (
        <p className="rounded-md bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
          {shape.kind === 'barcode' ? 'It reads as a product barcode: ' : shape.kind === 'serial' ? 'It reads as a serial (one box), not a product barcode: ' : ''}{shape.why}.
          {shape.kind === 'serial' && ' A new serial goes in on a goods receipt or Stock in by scan, under its product.'}
        </p>
      )}
      {productish && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={() => onCreate(true)} className="rounded-full bg-brand px-3.5 py-1.5 text-xs font-semibold text-brand-fg">Create product and receive</button>
          <button type="button" onClick={() => onCreate(false)} className="rounded-full px-3.5 py-1.5 text-xs font-semibold ring-1 ring-inset ring-border hover:ring-brand">Create product only</button>
        </div>
      )}
      {isLabel && (
        <button type="button" onClick={onReceive} className="font-medium text-brand hover:underline">Receive it into stock with this label →</button>
      )}
      {kind === 'phone' && (
        <button type="button" onClick={() => onNewLead({ ...EMPTY_CARD, mobiles: [query.replace(/\D/g, '').slice(-10)] })}
          className="font-medium text-brand hover:underline">New lead with this number →</button>
      )}
      {kind === 'gstin' && (
        <button type="button" onClick={() => onNewLead({ ...EMPTY_CARD, gstin: query.trim().toUpperCase() })}
          className="font-medium text-brand hover:underline">New lead with this GSTIN →</button>
      )}
      {kind === 'url' && (
        <a href={query} target="_blank" rel="noopener noreferrer" className="block break-all font-medium text-brand hover:underline">Open the link ↗</a>
      )}
    </div>
  );
}
