'use client';

import { PickList } from '@/components/ui/PickList';
import { SupplierLink } from '@/components/document/SupplierLink';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { PageHeader, Badge, Card, Field, SectionCard, StatusBadge } from '@/components/ui/Layout';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { useListParams } from '@/components/ui/useListParams';
import { WithFormOptions } from '@/components/document/WithFormOptions';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Button } from '@/components/ui/Button';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import { receiveGoods, cancelReceipt, type GrnLineForm } from './actions';
import { TRACKING_MODE_LABEL, type TrackingMode } from '@/lib/stock-tracking';
import {
  CAPTURE_HINT, CAPTURE_LABEL, CAPTURE_MODES, parseSerialList, type CaptureMode,
} from '@/lib/stock-intake';
import { appendCodes, cleanScannedCode } from '@/lib/scan/codes';
import { readUnknownScan, scanShape } from '@/lib/scan/decode';
import { lookupScanAction } from '@/app/(app)/products/scan-actions';
import { matchProduct, matchSupplier } from '@/lib/scan/match';
import type { ProductLabelScan, SupplierInvoiceScan } from '@/lib/scan/extraction';
import { ScanButton } from '@/components/scan/ScanButton';
import { AiScanButton } from '@/components/scan/AiScanButton';
import { attachScanPhoto } from '@/components/scan/ai';
import { takeHandoff, takeReceiveHandoff, type ReceiveHandoff } from '@/components/scan/handoff';
import { QuickProductDialog } from '@/components/scan/QuickProductDialog';
import { DocPhotos } from '@/components/scan/DocPhotos';
import { receiptStockSummary } from '@/lib/receipt-safety';

/** A scan the modal should open with - handed over from the header scanner. */
type InitialScan =
  | { kind: 'supplier_invoice'; data: SupplierInvoiceScan; photo: Blob | null }
  | { kind: 'product_label'; data: ProductLabelScan; photo: Blob | null };

interface ReceiptVM {
  id: string;
  grnNo: string;
  supplierName: string;
  partyId: string;
  receivedDate: string;
  status: string;
  sourceBillId: string | null;
  /** The bill that paid for it, when the goods came first (28 Oct 2026). */
  billedOnId?: string | null;
  purchaseOrderId: string | null;
  notes: string | null;
  supplierInvoiceNo: string | null;
  qty: number;
  /** Photos attached - the supplier invoice it was scanned from. */
  photoCount: number;
}

interface OrderItemVM {
  id: string;
  productId: string | null;
  productName: string;
  productCode: string | null;
  qty: number;
  receivedQty: number;
  unitCostPaise: number;
}

interface OrderVM {
  id: string;
  orderNo: string;
  partyId: string;
  supplierName: string;
  items: OrderItemVM[];
}

interface SupplierVM { id: string; name: string; gstin: string | null }
interface ProductVM { id: string; name: string; code: string; trackingMode: string }

interface LineDraft {
  purchaseOrderItemId: string | null;
  productId: string | null;
  productName: string;
  productCode: string | null;
  qty: string;
  unitCost: string;
  taxRate: string;
  /** The supplier's warranty to us, in months. */
  warrantyMonths: string;
  refurbished: boolean;
  lotNo: string;
  expiryDate: string;
  capture: CaptureMode;
  /** Scanned or pasted serials, one per line - parsed by lib/stock-intake. */
  serialsText: string;
  /** Boxes whose serial can't be read, scanned by their barcode - house tags at posting (G4). */
  noSerial: number;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit' });

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'danger'> = {
  posted: 'success', cancelled: 'neutral',
};

function toPaise(v: string): number {
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export function GoodsReceiptClient({
  receipts, paging, counts, status, orders, canEdit, isSingleStore, totalAll, rangeLabel, canExport, views,
}: {
  /** Every receipt, before the date filter - for the "nothing yet" message. */
  totalAll: number;
  rangeLabel: string;
  canExport: boolean;
  views: FilterBarViews;
  /** One page, searched and sorted on the server. */
  receipts: ReceiptVM[];
  paging: ServerPaging;
  counts: { posted: number; cancelled: number; noStock: number; total: number };
  /** posted | cancelled | nostock | null - from ?status=. */
  status: string | null;
  orders: OrderVM[];
  canEdit: boolean;
  isSingleStore: boolean;
}) {
  const list = useListParams();
  const [showNew, setShowNew] = useState(false);
  const [initialScan, setInitialScan] = useState<InitialScan | null>(null);
  const [initialReceive, setInitialReceive] = useState<ReceiveHandoff | null>(null);

  // Arrived from the header scanner with an invoice or a label already read:
  // open the receipt form with it filled in.
  useEffect(() => {
    if (!canEdit) return;
    const inv = takeHandoff('supplier_invoice');
    if (inv) { setInitialScan({ kind: 'supplier_invoice', data: inv.result.data, photo: inv.photo }); setShowNew(true); return; }
    const label = takeHandoff('product_label');
    if (label) { setInitialScan({ kind: 'product_label', data: label.result.data, photo: label.photo }); setShowNew(true); return; }
    // G2/G5: "Receive more" or "Create product and receive" from the header scanner.
    const rec = takeReceiveHandoff();
    if (rec) { setInitialReceive(rec); setShowNew(true); }
  }, [canEdit]);
  const [cancelling, setCancelling] = useState<ReceiptVM | null>(null);
  const [viewing, setViewing] = useState<ReceiptVM | null>(null);
  const [busy, setBusy] = useState<string | boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const { posted, cancelled, noStock } = counts;

  const cards: KpiCard[] = [
    { key: 'posted', label: 'Receipts posted', count: posted, subLabel: 'stock is in', icon: 'download', tone: 'success' },
    { key: 'cancelled', label: 'Cancelled', count: cancelled, subLabel: cancelled > 0 ? 'stock taken back out' : 'none', icon: 'x-circle' },
    { key: 'open-pos', label: 'Orders awaiting receipt', count: orders.length, subLabel: 'approved or partially received', icon: 'shopping-cart' },
    // G1 (12 Oct 2026): receipts posted before the block, with a text-only line
    // that never reached the shelf. Each opens with "Link to a product".
    { key: 'nostock', label: 'Lines that added no stock', count: noStock, subLabel: noStock > 0 ? 'open one to link its product' : 'none', icon: 'alert-triangle', tone: noStock > 0 ? 'danger' : undefined },
  ];

  const columns: Column<ReceiptVM>[] = [
    { key: 'grnNo', header: 'Receipt', sortValue: (r) => r.grnNo, render: (r) => <Link href={`/goods-receipt/${r.id}`} className="font-mono text-xs font-medium text-brand hover:underline">{r.grnNo}</Link> },
    {
      key: 'supplier', header: 'Supplier', sortValue: (r) => r.supplierName,
      render: (r) => (
        <span>
          <SupplierLink id={r.partyId}>{r.supplierName}</SupplierLink>
          {r.supplierInvoiceNo && <span className="block font-mono text-xs text-muted-foreground">their inv {r.supplierInvoiceNo}</span>}
        </span>
      ),
    },
    { key: 'date', header: 'Received', sortValue: (r) => new Date(r.receivedDate).getTime(), render: (r) => <span className="text-xs">{fmtDate(r.receivedDate)}</span> },
    { key: 'source', header: 'Source', render: (r) => (
      <span className="text-xs text-muted-foreground">
        {r.sourceBillId ? 'Auto - with a bill' : r.purchaseOrderId ? 'Purchase order' : 'Direct'}
        {!r.sourceBillId && r.status === 'posted' && (r.billedOnId
          ? <Link href={`/purchase/bills/${r.billedOnId}`} className="ms-1 text-brand hover:underline">· billed</Link>
          : <span className="ms-1 text-warning">· not billed</span>)}
      </span>
    ) },
    { key: 'qty', header: 'Qty', align: 'end', sortValue: (r) => r.qty, render: (r) => <span className="tabular-nums">{r.qty}</span> },
    { key: 'status', header: 'Status', sortValue: (r) => r.status, render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status === 'posted' ? 'Posted' : 'Cancelled'}</Badge> },
    {
      key: 'actions', header: '', align: 'end',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          {r.photoCount > 0 && (
            <Button size="sm" variant="ghost" icon="paperclip" onClick={() => setViewing(r)} aria-label={`Invoice photo for ${r.grnNo}`}>
              Photo
            </Button>
          )}
          {canEdit && r.status === 'posted' && !r.sourceBillId && (
            <Button size="sm" variant="outline" onClick={() => setCancelling(r)}>Cancel</Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        badge="GR"
        title="Goods Receipt Note"
        subtitle="What physically arrived, against which purchase order"
      />

      {error && (
        <Card className="mb-3 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}
      {flash && (
        <Card className="mb-3 border-success/30 bg-success/[0.06] px-3 py-2.5">
          <p className="text-xs leading-relaxed">{flash}</p>
        </Card>
      )}
      {!isSingleStore && (
        <Card className="mb-3 border-warning/40 bg-warning/10 p-3">
          <p className="text-sm"><strong>All Company</strong> is read-only. Select a single store to receive goods.</p>
        </Card>
      )}

      <FilterBar
        searchPlaceholder="Receipt no, old no, supplier, supplier's bill no, notes…"
        dates={{ defaultPreset: 'all', label: 'Received', activeLabel: rangeLabel }}
        shown={paging.total}
        clearKeys={['status']}
        exportScreen={canExport ? 'grn' : null}
        views={views}
        tools={canEdit ? <Button variant="primary" icon="plus" onClick={() => setShowNew(true)}>Receive goods</Button> : undefined}
      />

      <div className="mb-3">
        <KpiStrip
          cards={cards}
          activeKey={status}
          onSelect={(k) => { if (k === 'posted' || k === 'cancelled' || k === 'nostock' || k === null) list.set({ status: k }); }}
          columns={4}
        />
      </div>

      <DataGrid
        rows={receipts}
        server={paging}
        columns={columns}
        rowKey={(r) => r.id}
        mobileCard={(r) => (
          <div>
            <div className="flex items-center justify-between gap-2">
              <Link href={`/goods-receipt/${r.id}`} className="font-mono text-xs font-semibold text-brand hover:underline">{r.grnNo}</Link>
              <StatusBadge status={r.status === 'posted' ? 'done' : r.status} label={r.status === 'posted' ? 'Posted' : 'Cancelled'} />
            </div>
            <p className="mt-1 truncate text-sm font-medium">{r.supplierName}</p>
            <p className="text-xs text-muted-foreground">{new Date(r.receivedDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })} · {r.qty} units{r.supplierInvoiceNo ? ` · bill ${r.supplierInvoiceNo}` : ''}</p>
          </div>
        )}
        emptyIcon="download"
        emptyMessage={totalAll === 0 ? 'Nothing received yet' : 'No receipts match'}
        emptyHint={totalAll === 0 ? 'A receipt appears here the moment goods are logged in - by hand against a purchase order, or automatically when a purchase bill is posted.' : undefined}
      />

      {showNew && (
        <WithFormOptions need={['parties', 'stockProducts']} onClose={() => { setShowNew(false); setInitialScan(null); }}>
          {(o) => (
        <ReceiveGoodsModal
          orders={orders}
          suppliers={o.parties.map((p) => ({ id: p.id, name: p.name, gstin: p.gstin }))}
          products={o.stockProducts}
          initialScan={initialScan}
          initialReceive={initialReceive}
          onClose={() => { setShowNew(false); setInitialScan(null); setInitialReceive(null); }}
          onSubmit={async (input, photo) => {
            setBusy('save');
            setError(null);
            const res = await receiveGoods(input);
            if (res.error) { setBusy(false); setError(res.error); return res; }
            // The supplier's invoice the receipt was read from, kept on it.
            let attachNote = '';
            if (photo && res.id) {
              const failed = await attachScanPhoto('goods_receipt', res.id, photo, 'Scanned supplier invoice');
              attachNote = failed ? ` The invoice photo was not attached: ${failed}` : ' The invoice photo is attached.';
            }
            setBusy(false);
            setFlash((res.message ?? '') + attachNote);
            setShowNew(false);
            setInitialScan(null);
            return res;
          }}
        />
          )}
        </WithFormOptions>
      )}

      {viewing && (
        <Modal title={`${viewing.grnNo} - invoice photo`} subtitle={viewing.supplierName} icon="paperclip" size="md" onClose={() => setViewing(null)}>
          <DocPhotos docType="goods_receipt" docId={viewing.id} />
        </Modal>
      )}

      {cancelling && (
        <ConfirmDialog
          title="Cancel this receipt?"
          message={`"${cancelling.grnNo}" will be marked cancelled and the stock it brought in taken back out.`}
          confirmLabel="Cancel receipt"
          tone="danger"
          busy={busy === `cancel-${cancelling.id}`}
          onClose={() => setCancelling(null)}
          onConfirm={async () => {
            setBusy(`cancel-${cancelling.id}`);
            const res = await cancelReceipt(cancelling.id, 'Cancelled by user');
            setBusy(false);
            if (res.error) setError(res.error); else setCancelling(null);
          }}
        />
      )}
    </>
  );
}

export function ReceiveGoodsModal({
  orders, suppliers, products: baseProducts, initialScan, initialReceive, addTo, onClose, onSubmit,
}: {
  /** Adding lines to a posted receipt (29 Oct 2026): only the items part of the form shows. */
  addTo?: { grnNo: string; partyId: string };
  orders: OrderVM[];
  suppliers: SupplierVM[];
  products: ProductVM[];
  initialScan: InitialScan | null;
  initialReceive: ReceiveHandoff | null;
  onClose: () => void;
  onSubmit: (input: {
    purchaseOrderId: string | null; partyId: string; receivedDate: string;
    supplierInvoiceNo: string | null; notes: string | null;
    lines: GrnLineForm[];
  }, photo: Blob | null) => Promise<{ error?: string; ok?: boolean }>;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const [orderId, setOrderId] = useState('');
  const [partyId, setPartyId] = useState(addTo?.partyId ?? '');
  const [receivedDate, setReceivedDate] = useState(today);
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  // Products created from this form (G2) join the list without a reload.
  const [extraProducts, setExtraProducts] = useState<ProductVM[]>([]);
  const products = [...extraProducts, ...baseProducts.filter((p) => !extraProducts.some((x) => x.id === p.id))];
  const [creatingFor, setCreatingFor] = useState<number | null>(null);

  const order = orders.find((o) => o.id === orderId) ?? null;
  const modeOf = (productId: string | null) => products.find((p) => p.id === productId)?.trackingMode ?? 'quantity';

  const blankExtras = { taxRate: '', warrantyMonths: '', refurbished: false, lotNo: '', expiryDate: '', capture: 'serials' as CaptureMode, serialsText: '', noSerial: 0 };

  const pickOrder = (id: string) => {
    setOrderId(id);
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    setPartyId(o.partyId);
    setLines(
      o.items
        .filter((i) => i.receivedQty < i.qty)
        .map((i) => ({
          purchaseOrderItemId: i.id, productId: i.productId, productName: i.productName,
          productCode: i.productCode, qty: String(i.qty - i.receivedQty), unitCost: String(i.unitCostPaise / 100),
          ...blankExtras,
        })),
    );
  };

  const clearOrder = () => {
    setOrderId('');
    setPartyId('');
    setLines([]);
  };

  const setLine = (i: number, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };

  const pickProduct = (i: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) { setLine(i, { productId: null }); return; }
    setLine(i, { productId: p.id, productName: p.name, productCode: p.code });
  };

  const blankLine = (): LineDraft => ({
    purchaseOrderItemId: null, productId: null, productName: '', productCode: null, qty: '1', unitCost: '',
    ...blankExtras,
  });

  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

  /**
   * Fill the form from a photographed supplier invoice. Everything filled is
   * still an editable field - the person checks it before posting, and the
   * note says which parts need a human (an unknown supplier, lines with no
   * catalogue match).
   */
  const applyInvoice = (inv: SupplierInvoiceScan, shot: Blob | null) => {
    if (shot) setPhoto(shot);
    const notesOut: string[] = [];
    if (inv.invoiceNo) setSupplierInvoiceNo(inv.invoiceNo);
    if (!order) {
      const sup = matchSupplier(suppliers, inv);
      if (sup) setPartyId(sup.id);
      else if (inv.supplierName || inv.supplierGstin) {
        notesOut.push(`Supplier on the invoice: ${[inv.supplierName, inv.supplierGstin].filter(Boolean).join(' · ')} - not matched, choose it from the list (add it under Suppliers if it is new).`);
      }
    }
    if (inv.invoiceDate) setNotes((n) => n.trim() || `Supplier invoice dated ${inv.invoiceDate}`);

    if (order) {
      // Against a purchase order the lines are the order's; the invoice only
      // adds the GST rate and serials where a line can be matched.
      setLines((prev) => prev.map((l) => {
        const hit = inv.lines.find((x) => matchProduct([{ id: 'x', name: l.productName, code: l.productCode }], x.description));
        if (!hit) return l;
        return {
          ...l,
          taxRate: l.taxRate || (hit.taxRatePct !== null ? String(hit.taxRatePct) : ''),
          serialsText: hit.serials.length ? appendCodes(l.serialsText, hit.serials) : l.serialsText,
        };
      }));
    } else if (inv.lines.length) {
      let unmatched = 0;
      const drafts = inv.lines.map((x): LineDraft => {
        const p = matchProduct(products, x.description);
        if (!p) unmatched++;
        return {
          ...blankLine(),
          productId: p?.id ?? null,
          productName: p?.name ?? x.description,
          productCode: p?.code ?? null,
          qty: x.qty !== null ? String(x.qty) : '1',
          unitCost: x.unitPrice !== null ? String(x.unitPrice) : '',
          taxRate: x.taxRatePct !== null ? String(x.taxRatePct) : '',
          serialsText: x.serials.join('\n'),
        };
      });
      setLines((prev) => [...prev.filter((l) => l.productName.trim()), ...drafts]);
      if (unmatched) notesOut.push(`${unmatched} line${unmatched === 1 ? '' : 's'} did not match a catalogue product - pick the product on each, or leave it as a description.`);
    }
    setScanNote(['Filled from the invoice photo. Check every field before posting.', ...notesOut].join(' '));
  };

  /** A photographed box label becomes a line: the product it names, and its serials. */
  const applyLabel = (label: ProductLabelScan) => {
    const text = [label.brand, label.model, label.description].filter(Boolean).join(' ');
    const p = (label.model ? matchProduct(products, label.model) : null) ?? matchProduct(products, text);
    setLines((prev) => {
      const at = p ? prev.findIndex((l) => l.productId === p.id) : -1;
      if (at >= 0) {
        return prev.map((l, j) => (j === at ? { ...l, serialsText: appendCodes(l.serialsText, label.serials) } : l));
      }
      if (order) return prev;
      return [...prev.filter((l) => l.productName.trim()), {
        ...blankLine(),
        productId: p?.id ?? null,
        productName: p?.name ?? (text || 'Scanned item'),
        productCode: p?.code ?? null,
        qty: String(Math.max(1, label.serials.length)),
        serialsText: label.serials.join('\n'),
      }];
    });
    setScanNote(p
      ? `Label read: ${p.name}${label.serials.length ? ` · serial ${label.serials.join(', ')}` : ''}.`
      : `Label read (${text || 'no model'}) - no catalogue product matched; pick it on the line.`);
  };

  // Opened from the header scanner with a product to receive (G2/G5).
  useEffect(() => {
    if (!initialReceive) return;
    const p = initialReceive.product;
    setExtraProducts((x) => (x.some((y) => y.id === p.id) ? x : [{ id: p.id, name: p.name, code: p.code, trackingMode: p.trackingMode }, ...x]));
    setLines([{ ...blankLine(), productId: p.id, productName: p.name, productCode: p.code, serialsText: initialReceive.serial ?? '' }]);
    setScanNote(`${p.name} (${p.code}) from the scan. Set the quantity${p.trackingMode === 'serial' ? ' and scan each box\'s serial' : ''}, choose the supplier, then post.`);
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opened from the header scanner with a scan already read.
  useEffect(() => {
    if (!initialScan) return;
    if (initialScan.kind === 'supplier_invoice') applyInvoice(initialScan.data, initialScan.photo);
    else applyLabel(initialScan.data);
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);

    const res = await onSubmit({
      purchaseOrderId: orderId || null,
      partyId,
      receivedDate,
      supplierInvoiceNo: supplierInvoiceNo.trim() || null,
      notes: notes.trim() || null,
      lines: lines
        .filter((l) => l.productName.trim() && Number(l.qty) > 0)
        .map((l) => {
          const mode = modeOf(l.productId);
          return {
            purchaseOrderItemId: l.purchaseOrderItemId, productId: l.productId,
            productName: l.productName.trim(), productCode: l.productCode,
            qty: Number(l.qty), unitCostPaise: toPaise(l.unitCost),
            taxRatePct: numOrNull(l.taxRate),
            warrantyMonths: numOrNull(l.warrantyMonths),
            isRefurbished: l.refurbished,
            lotNo: mode === 'batch' ? l.lotNo.trim() || null : null,
            expiryDate: mode === 'batch' ? l.expiryDate || null : null,
            capture: mode === 'serial' ? l.capture : undefined,
            serials: mode === 'serial' && l.capture === 'serials' ? parseSerialList(l.serialsText).serials : undefined,
            noSerial: mode === 'serial' && l.capture === 'serials' ? l.noSerial : undefined,
          };
        }),
    }, photo);

    setBusy(false);
    if (res.error) setError(res.error);
  };

  // G1: what reaches the shelf, said before posting; an unlinked line blocks it.
  const summary = receiptStockSummary(lines.map((l) => ({
    productId: l.productId, productName: l.productName, qty: Number(l.qty) || 0,
    trackingMode: l.productId ? modeOf(l.productId) : null,
    serials: l.capture === 'serials' ? parseSerialList(l.serialsText).serials.length : 0,
    noSerial: l.capture === 'count' ? Number(l.qty) || 0 : l.capture === 'serials' ? l.noSerial : 0,
  })));

  /* ------------------------------------------------ Scan to add (G4, 12 Oct 2026)
   * Barcode -> its product's line (+1 per scan). Serial -> the line waiting
   * for serials (fills a box scanned by barcode first, else +1). A serial
   * already in stock or already on this receipt is refused. An unknown code
   * is read by lib/scan/decode: a product barcode offers Create product, a
   * serial goes to the waiting line, and anything unclear is ASKED. */
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [scanMsg, setScanMsg] = useState<{ tone: 'ok' | 'warn' | 'bad' | 'info'; text: string } | null>(null);
  const [askCode, setAskCode] = useState<string | null>(null);
  const [createFromScan, setCreateFromScan] = useState<{ barcode: string; serial: string | null } | null>(null);
  const [wedge, setWedge] = useState('');

  const commit = (next: LineDraft[]) => { linesRef.current = next; setLines(next); };

  /** Put one scanned box (with or without its serial) on its product's line. */
  const applyUnit = (p: ProductVM, serial: string | null): string => {
    const cur = linesRef.current.filter((l) => l.productId || l.productName.trim());
    let i = cur.findIndex((l) => l.productId === p.id);
    if (i < 0) {
      if (order) return `${p.name} is not on ${order.orderNo}. Receive it without the order, or add it to the order first.`;
      cur.push({ ...blankLine(), productId: p.id, productName: p.name, productCode: p.code, qty: '0' });
      i = cur.length - 1;
    }
    const l = cur[i]!;
    const qty = Number(l.qty) || 0;
    if (p.trackingMode === 'serial') {
      if (serial) {
        const have = parseSerialList(l.serialsText).serials;
        const at = have.findIndex((x) => x.toUpperCase() === serial.toUpperCase());
        if (at >= 0) return `${serial} is already on this receipt (box ${at + 1} of ${p.name}). Ignored - one box can't count twice.`;
        const fills = l.noSerial > 0;
        cur[i] = { ...l, capture: 'serials', serialsText: appendCodes(l.serialsText, [serial]), noSerial: fills ? l.noSerial - 1 : l.noSerial, qty: String(fills ? qty : qty + 1) };
      } else {
        cur[i] = { ...l, capture: 'serials', noSerial: l.noSerial + 1, qty: String(qty + 1) };
      }
    } else {
      if (serial) return `${p.name} is not tracked by serial, so ${serial} can't be recorded. Scan its barcode to count it.`;
      cur[i] = { ...l, qty: String(qty + 1) };
    }
    commit(cur);
    setActiveLine(i);
    return '';
  };

  const knowProduct = (p: { id: string; name: string; code: string; trackingMode: string }) => {
    if (!products.some((x) => x.id === p.id)) setExtraProducts((x) => [p, ...x]);
    return p;
  };

  /** The serial line a bare serial belongs to: the one last scanned into, else the last serial line. */
  const waitingLine = (): number => {
    const ls = linesRef.current;
    if (activeLine !== null && ls[activeLine]?.productId && modeOf(ls[activeLine]!.productId) === 'serial') return activeLine;
    for (let i = ls.length - 1; i >= 0; i--) if (ls[i]!.productId && modeOf(ls[i]!.productId) === 'serial') return i;
    return -1;
  };

  const serialToWaiting = (code: string): string => {
    const w = waitingLine();
    if (w < 0) return `${code} looks like a serial, but no line is waiting for serials. Scan the product's barcode first so Atlas knows what it is.`;
    const l = linesRef.current[w]!;
    const p = products.find((x) => x.id === l.productId)!;
    const err = applyUnit(p, code);
    return err || `ok:Serial ${code} added to ${p.name}.`;
  };

  const handleScan = async (raw: string) => {
    const code = cleanScannedCode(raw);
    if (!code) return;
    setAskCode(null);
    const say = (text: string, tone: 'ok' | 'warn' | 'bad' | 'info' = 'bad') => {
      if (text.startsWith('ok:')) setScanMsg({ tone: 'ok', text: text.slice(3) });
      else setScanMsg(text ? { tone, text } : null);
    };
    const shape = scanShape(code);
    if (shape.kind === 'gs1') {
      const look = await lookupScanAction(shape.gtin).catch(() => null);
      const p = look?.products[0];
      if (!p) { setCreateFromScan({ barcode: shape.gtin, serial: shape.serial }); say(`${shape.why}. No product has barcode ${shape.gtin} yet - create it.`, 'info'); return; }
      const err = applyUnit(knowProduct({ id: p.id, name: p.name, code: p.code, trackingMode: p.trackingMode }), shape.serial);
      say(err || `ok:${p.name}${shape.serial ? ` · serial ${shape.serial}` : ''} - both read from one code.`);
      return;
    }
    const look = await lookupScanAction(code).catch(() => null);
    if (!look) { say('Could not look that code up. Check the connection and scan again.'); return; }
    if (look.units.length > 0) {
      const u = look.units[0]!;
      say(`${code} is already on file - one ${u.productName ?? 'unit'} (${u.status.replace(/_/g, ' ')}). A serial can only arrive once.`);
      return;
    }
    if (look.products.length > 0) {
      const p = look.products[0]!;
      const err = applyUnit(knowProduct({ id: p.id, name: p.name, code: p.code, trackingMode: p.trackingMode }), null);
      say(err || `ok:${p.name} +1${p.trackingMode === 'serial' ? ' - scan its serial next, or leave it for a house tag' : ''}.`);
      return;
    }
    const reading = readUnknownScan(code, waitingLine() >= 0);
    if (reading.as === 'barcode') { setCreateFromScan({ barcode: code, serial: null }); say(`${reading.why}. Not on file - create the product.`, 'info'); return; }
    if (reading.as === 'serial') { say(serialToWaiting(code)); return; }
    setAskCode(code);
    say(`${code}: ${reading.why}. Which is it?`, 'warn');
  };

  const handleMany = async (codes: string[]) => { for (const c of codes) await handleScan(c); };
  const ready = partyId && lines.some((l) => l.productName.trim() && Number(l.qty) > 0) && summary.unlinked === 0;
  const input = 'rounded-md border border-border bg-card px-2 py-1 text-xs';

  return (
    <Modal
      title={addTo ? `Add items to ${addTo.grnNo}` : 'Receive goods'}
      subtitle={addTo ? 'Goods that came with this receipt. The lines already on it stay as they are.' : 'What arrived, how much, and - for tracked products - which ones'}
      icon="download"
      size="xl"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {lines.length > 0 && (
            <p className={`me-auto text-xs ${summary.unlinked ? 'font-semibold text-danger' : 'text-muted-foreground'}`}>{summary.text}</p>
          )}
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!ready || busy} loading={busy}>{addTo ? 'Add to receipt' : 'Post receipt'}</Button>
        </div>
      }
    >
      {error && (
        <Card className="mb-3 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <p className="text-xs leading-relaxed text-danger">{error}</p>
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-start gap-2">
        {!addTo && <AiScanButton kind="supplier_invoice" label="Scan supplier invoice" onResult={(r, shot) => applyInvoice(r.data, shot)} />}
        <AiScanButton kind="product_label" label="Scan box label" onResult={(r) => applyLabel(r.data)} />
      </div>
      <div className="mb-3 rounded-lg border border-brand/30 bg-brand/[0.04] p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-brand">Scan to add</span>
          <input
            aria-label="Scan a barcode or serial"
            className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1.5 font-mono text-sm"
            value={wedge}
            onChange={(e) => setWedge(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = wedge; setWedge(''); void handleScan(v); } }}
            placeholder="Scan a barcode or serial - each Enter adds it"
          />
          <ScanButton label="Camera" title="Scan to add" hint="Barcodes add their product; serials go to the line waiting for them. Press Done when finished." onScanMany={(codes) => void handleMany(codes)} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Barcode = which product (+1 each scan). Serial = which box. A box with a torn serial: scan its barcode - it gets a house tag.</p>
        {scanMsg && (
          <p role="status" className={`mt-1.5 rounded-md px-2 py-1 text-xs ${scanMsg.tone === 'ok' ? 'bg-success/10 text-success' : scanMsg.tone === 'bad' ? 'bg-danger/10 text-danger' : scanMsg.tone === 'warn' ? 'bg-warning/10 text-warning' : 'bg-brand/10 text-brand'}`}>{scanMsg.text}</p>
        )}
        {askCode && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { setCreateFromScan({ barcode: askCode, serial: null }); setAskCode(null); }}>It&apos;s the product barcode</Button>
            {waitingLine() >= 0 && (
              <Button size="sm" onClick={() => { const r = serialToWaiting(askCode); setScanMsg(r.startsWith('ok:') ? { tone: 'ok', text: r.slice(3) } : { tone: 'bad', text: r }); setAskCode(null); }}>
                It&apos;s a serial for {linesRef.current[waitingLine()]?.productName}
              </Button>
            )}
          </div>
        )}
      </div>

      {scanNote && (
        <Card className="mb-3 border-brand/30 bg-brand/[0.05] px-3 py-2.5">
          <p className="flex items-start gap-2 text-xs leading-relaxed">
            <Icon name="sparkles" className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            <span>{scanNote}{photo && ' The photo will be attached to the receipt.'}</span>
          </p>
        </Card>
      )}

      {!addTo && <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Against a purchase order" hint="Optional - leave blank for a purchase with no PO">
          <PickList id="grn-order" label="Purchase order" value={orderId} onChange={(v) => (v ? pickOrder(v) : clearOrder())} placeholder="Order no or supplier - or leave empty"
            options={orders.map((o) => ({ id: o.id, label: o.orderNo, sub: o.supplierName }))} />
        </Field>

        <Field label="Supplier">
          {order ? (
            // Set by the order, not from this dropdown's own list - that list
            // is suppliers only, and an order's party might not be marked as
            // one yet. A `<select>` with no matching `<option>` would just
            // show blank, which reads as "nothing chosen" when something is.
            <p className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-2 text-sm">
              {order.supplierName}
            </p>
          ) : (
            <PickList id="grn-supplier" label="Supplier" value={partyId} onChange={setPartyId} placeholder="Type the supplier's name…"
              options={suppliers.map((s) => ({ id: s.id, label: s.name }))} />
          )}
        </Field>

        <Field label="Received on">
          <input type="date" className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
        </Field>

        <Field label="Supplier's invoice number" hint="The number they quote when a unit goes back under warranty">
          <input className="w-full rounded-md border border-border bg-card px-2 py-1.5 font-mono text-sm"
            value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} placeholder="Optional" />
        </Field>

        <Field label="Notes" className="sm:col-span-2">
          <input className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </Field>
      </div>}

      <SectionCard title="Items" icon="package" className="mt-4" bodyClassName="p-0">
        {lines.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {order ? 'Everything on this order has already been received.' : 'Add a line below.'}
          </p>
        )}
        <div className="divide-y divide-border">
          {lines.map((l, i) => {
            const mode = modeOf(l.productId);
            return (
              <div key={i} className="space-y-2 px-3 py-2.5">
                <div className="grid gap-2 sm:grid-cols-[1fr_5rem_6rem_4.5rem_4.5rem_auto]">
                  <div>
                    {order && l.productId ? (
                      <p className="text-xs font-medium">{l.productName}</p>
                    ) : (
                      <>
                        <div className="mb-1">
                          <PickList id={`grn-product-${i}`} label="Product" value={l.productId ?? ''} onChange={(v) => pickProduct(i, v)} placeholder="Product name or code…"
                            options={products.map((p) => ({ id: p.id, label: p.name, sub: p.code }))} />
                        </div>
                        <input className={`w-full ${input}`} value={l.productName}
                          onChange={(e) => setLine(i, { productName: e.target.value })} placeholder="Description" />
                      </>
                    )}
                    {l.productId ? (
                      <p className="mt-0.5 text-micro uppercase tracking-wide text-muted-foreground">
                        {TRACKING_MODE_LABEL[mode as TrackingMode] ?? mode}
                      </p>
                    ) : l.productName.trim() ? (
                      <p className="mt-1 rounded-md bg-danger/[0.08] px-2 py-1 text-xs font-medium text-on-tint-danger">
                        Will not add stock - pick the product above, or{' '}
                        <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setCreatingFor(i)}>create it</button>.
                      </p>
                    ) : null}
                  </div>
                  <label className="text-xs text-muted-foreground">Qty
                    <input className={`w-full text-right tabular-nums ${input}`} value={l.qty}
                      onChange={(e) => setLine(i, { qty: e.target.value })} inputMode="numeric" />
                  </label>
                  <label className="text-xs text-muted-foreground">Unit cost ₹
                    <input className={`w-full text-right tabular-nums ${input}`} value={l.unitCost}
                      onChange={(e) => setLine(i, { unitCost: e.target.value })} inputMode="decimal" />
                  </label>
                  <label className="text-xs text-muted-foreground">GST %
                    <input className={`w-full text-right tabular-nums ${input}`} value={l.taxRate}
                      onChange={(e) => setLine(i, { taxRate: e.target.value })} inputMode="decimal" placeholder="-" />
                  </label>
                  <label className="text-xs text-muted-foreground" title="The supplier's warranty to you, in months from today">
                    Warr. mo
                    <input className={`w-full text-right tabular-nums ${input}`} value={l.warrantyMonths}
                      onChange={(e) => setLine(i, { warrantyMonths: e.target.value })} inputMode="numeric" placeholder="-" />
                  </label>
                  <div className="flex flex-col items-end justify-between gap-1">
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={l.refurbished} onChange={(e) => setLine(i, { refurbished: e.target.checked })} />
                      Refurb
                    </label>
                    {!order && lines.length > 1 && (
                      <button type="button" className="text-xs text-danger hover:underline"
                        onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                {mode === 'batch' && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className={input} value={l.lotNo} onChange={(e) => setLine(i, { lotNo: e.target.value })} placeholder="Lot / batch number *" />
                    <input className={input} type="date" value={l.expiryDate} onChange={(e) => setLine(i, { expiryDate: e.target.value })} title="Expiry date" />
                  </div>
                )}

                {mode === 'serial' && (
                  <SerialCapture
                    qty={Number(l.qty) || 0}
                    capture={l.capture}
                    noSerial={l.noSerial}
                    onNoSerial={(n) => setLine(i, { noSerial: Math.max(0, n) })}
                    text={l.serialsText}
                    onCapture={(capture) => setLine(i, { capture })}
                    onText={(serialsText) => setLine(i, { serialsText })}
                  />
                )}
              </div>
            );
          })}
        </div>

        {!order && (
          <div className="border-t border-border bg-muted/20 px-3 py-2">
            <Button size="sm" icon="plus" onClick={() => setLines((p) => [...p, blankLine()])}>Add line</Button>
          </div>
        )}
      </SectionCard>

      {createFromScan && (
        <QuickProductDialog
          barcode={createFromScan.barcode}
          actionLabel="Save and add to this receipt"
          onClose={() => setCreateFromScan(null)}
          onCreated={(p) => {
            const vm = knowProduct({ id: p.id, name: p.name, code: p.code, trackingMode: p.trackingMode });
            const err = applyUnit(vm, createFromScan.serial);
            setScanMsg(err ? { tone: 'bad', text: err } : { tone: 'ok', text: `${p.name} created (${p.code}) and added${createFromScan.serial ? ` with serial ${createFromScan.serial}` : ''}.` });
            setCreateFromScan(null);
          }}
        />
      )}

      {creatingFor !== null && lines[creatingFor] && (
        <QuickProductDialog
          name={lines[creatingFor].productName}
          actionLabel="Save and use on this line"
          onClose={() => setCreatingFor(null)}
          onCreated={(p) => {
            setExtraProducts((x) => [{ id: p.id, name: p.name, code: p.code, trackingMode: p.trackingMode }, ...x]);
            setLine(creatingFor, { productId: p.id, productName: p.name, productCode: p.code });
            setCreatingFor(null);
          }}
        />
      )}

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Posting puts this stock on the shelf immediately - there is no separate draft step here,
        because by the time somebody is logging a receipt, the goods have already physically arrived.
        Serialised units are created with it, in the same step.
      </p>
    </Modal>
  );
}

/**
 * The serials for one line, captured whichever way is fastest.
 *
 * SCAN: the cursor sits in one box, the scanner types a serial and presses
 * Enter, the serial joins the list and the box clears for the next. PASTE: a
 * column from the supplier's spreadsheet goes straight into the list. Both
 * feed the same text, so a person can scan most and paste the rest.
 */
function SerialCapture({
  qty, capture, text, onCapture, onText, noSerial, onNoSerial,
}: {
  qty: number;
  capture: CaptureMode;
  /** Boxes scanned by barcode because their serial can't be read - house tags (G4). */
  noSerial: number;
  onNoSerial: (n: number) => void;
  text: string;
  onCapture: (c: CaptureMode) => void;
  onText: (t: string) => void;
}) {
  const [scan, setScan] = useState('');
  const parsed = parseSerialList(text);
  const n = parsed.serials.length;

  const addScan = () => {
    const s = scan.trim();
    if (!s) return;
    onText(text ? `${text.replace(/\s+$/, '')}\n${s}` : s);
    setScan('');
  };

  return (
    <div className="rounded-md border border-border bg-muted/20 p-2">
      <div className="mb-2 flex flex-wrap gap-3 text-xs">
        {CAPTURE_MODES.map((c) => (
          <label key={c} className="flex items-center gap-1" title={CAPTURE_HINT[c]}>
            <input type="radio" checked={capture === c} onChange={() => onCapture(c)} />
            {CAPTURE_LABEL[c]}
          </label>
        ))}
      </div>

      {capture === 'serials' && (
        <>
          <div className="mb-1.5 flex gap-1.5">
            <input
              className="w-full rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs"
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addScan(); } }}
              placeholder="Scan here - each Enter adds one"
            />
            <ScanButton
              existing={parsed.serials}
              title="Scan serials"
              hint={`Point at each serial barcode in turn - ${qty} expected. Press Done when finished.`}
              onScanMany={(codes) => onText(appendCodes(text, codes))}
            />
          </div>
          <textarea
            rows={3}
            className="w-full rounded-md border border-border bg-card px-2 py-1 font-mono text-xs"
            value={text}
            onChange={(e) => onText(e.target.value)}
            placeholder="…or paste a column of serials, one per line"
          />
          <p className={`mt-1 text-xs ${n + noSerial === qty ? 'text-success' : 'text-muted-foreground'}`}>
            {n} of {qty} serial{qty === 1 ? '' : 's'}
            {noSerial > 0 && <> · {noSerial} without a readable serial (house tag{noSerial === 1 ? '' : 's'}) <button type="button" className="text-danger hover:underline" onClick={() => onNoSerial(noSerial - 1)} aria-label="One fewer box without a serial">−</button></>}
            {parsed.duplicates.length > 0 && <span className="text-danger"> · repeated: {parsed.duplicates.join(', ')}</span>}
            {n + noSerial !== qty && n > 0 && ' - they must match the quantity, or use "serials to follow"'}
          </p>
        </>
      )}
      {capture === 'placeholders' && (
        <p className="text-xs text-muted-foreground">
          {qty} unit{qty === 1 ? '' : 's'} will be created now with the serial left blank, ready to be filled in from
          the Serial &amp; Batch Stock screen when the list arrives.
        </p>
      )}
      {capture === 'count' && (
        /*
          This used to say "no unit records", which was true and was the problem:
          it is how 39,000 items came to be on shelves that Atlas could not name.
          Each item now gets a number of our own - see lib/house-tag.
        */
        <p className="text-xs text-muted-foreground">
          Nothing is printed on these items, so Atlas will number each one
          &mdash; {qty} label{qty === 1 ? '' : 's'} like{' '}
          <span className="font-mono">{'{CODE}'}-2610-0001</span>. Print them from the Serial
          &amp; Batch Stock screen and stick them on, and every item stays traceable.
        </p>
      )}
    </div>
  );
}
