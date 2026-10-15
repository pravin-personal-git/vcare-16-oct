import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

/**
 * THE INVOICE PDF, MADE ON THE PHONE (13 Oct 2026, native admin app part 3,
 * decision S4): with no signal the customer can still be handed a proper tax
 * invoice - WhatsApp, Bluetooth or print - the moment it is made. The office's
 * link to the same invoice follows once it has synced.
 *
 * Plain HTML rendered by the phone (expo-print), the same blocks as the
 * website's invoice: seller, buyer, lines, the tax split, totals.
 */
export interface PdfInvoice {
  title: 'TAX INVOICE' | 'QUOTATION' | 'DRAFT INVOICE';
  number: string;
  date: string;
  seller: { name: string; gstin: string | null; mobile: string | null; email: string | null; storeName: string; storeAddress: string | null } | null;
  buyer: { name: string; company: string | null; phone: string; gstin: string | null; address: string | null };
  lines: { name: string; qty: number; unitPricePaise: number; discountPct: number; taxRatePct: number; amountPaise: number }[];
  taxMode: 'CGST_SGST' | 'IGST' | 'NONE' | string;
  subtotalPaise: number; discountPaise: number; taxablePaise: number;
  cgstPaise: number; sgstPaise: number; igstPaise: number; deliveryPaise: number; grandTotalPaise: number;
  paidPaise?: number;
  note?: string | null;
}

const esc = (s: string | null | undefined) => (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const rs = (p: number) => `Rs ${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function invoiceHtml(d: PdfInvoice): string {
  const tax = d.taxMode === 'IGST'
    ? `<tr><td>IGST</td><td>${rs(d.igstPaise)}</td></tr>`
    : d.taxMode === 'NONE' ? '' : `<tr><td>CGST</td><td>${rs(d.cgstPaise)}</td></tr><tr><td>SGST</td><td>${rs(d.sgstPaise)}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#111;margin:24px}
    h1{font-size:16px;margin:0 0 4px} .muted{color:#555} table{width:100%;border-collapse:collapse;margin-top:12px}
    th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left} th{background:#f3f4f6}
    .r{text-align:right} .tot td{border:0;padding:3px 4px} .tot td:last-child{text-align:right} .grand td{font-weight:bold;font-size:14px;border-top:2px solid #111}
    .head{display:flex;justify-content:space-between;gap:16px} .box{border:1px solid #ddd;padding:8px;border-radius:6px;margin-top:10px}
  </style></head><body>
  <div class="head"><div>
    <h1>${esc(d.seller?.name ?? '')}</h1>
    <div class="muted">${esc(d.seller?.storeName)}${d.seller?.storeAddress ? `<br>${esc(d.seller.storeAddress)}` : ''}</div>
    ${d.seller?.gstin ? `<div>GSTIN: <b>${esc(d.seller.gstin)}</b></div>` : ''}
    <div class="muted">${[d.seller?.mobile, d.seller?.email].filter(Boolean).map(esc).join(' &middot; ')}</div>
  </div><div style="text-align:right">
    <h1>${d.title}</h1><div><b>${esc(d.number)}</b></div><div class="muted">${esc(d.date)}</div>
  </div></div>
  <div class="box"><b>Bill to:</b> ${esc(d.buyer.name)}${d.buyer.company ? ` &middot; ${esc(d.buyer.company)}` : ''}<br>
    ${esc(d.buyer.phone)}${d.buyer.gstin ? ` &middot; GSTIN ${esc(d.buyer.gstin)}` : ''}${d.buyer.address ? `<br>${esc(d.buyer.address)}` : ''}</div>
  <table><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Disc %</th><th class="r">GST %</th><th class="r">Amount</th></tr></thead><tbody>
  ${d.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}</td><td class="r">${l.qty}</td><td class="r">${rs(l.unitPricePaise)}</td><td class="r">${l.discountPct || ''}</td><td class="r">${l.taxRatePct}</td><td class="r">${rs(l.amountPaise)}</td></tr>`).join('')}
  </tbody></table>
  <table class="tot" style="width:50%;margin-left:auto">
    <tr><td>Subtotal</td><td>${rs(d.subtotalPaise)}</td></tr>
    ${d.discountPaise ? `<tr><td>Discount</td><td>- ${rs(d.discountPaise)}</td></tr>` : ''}
    <tr><td>Taxable value</td><td>${rs(d.taxablePaise)}</td></tr>
    ${tax}
    ${d.deliveryPaise ? `<tr><td>Delivery</td><td>${rs(d.deliveryPaise)}</td></tr>` : ''}
    <tr class="grand"><td>Total</td><td>${rs(d.grandTotalPaise)}</td></tr>
    ${d.paidPaise ? `<tr><td>Paid</td><td>${rs(d.paidPaise)}</td></tr><tr><td><b>Due</b></td><td><b>${rs(Math.max(0, d.grandTotalPaise - d.paidPaise))}</b></td></tr>` : ''}
  </table>
  ${d.note ? `<p class="muted">${esc(d.note)}</p>` : ''}
  <p class="muted" style="margin-top:24px">Computer-generated document.</p>
  </body></html>`;
}

/** Make the PDF and open the phone's share sheet (WhatsApp, Bluetooth, print...). */
export async function shareInvoicePdf(d: PdfInvoice): Promise<void> {
  const { uri } = await Print.printToFileAsync({ html: invoiceHtml(d) });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `${d.title} ${d.number}`, UTI: 'com.adobe.pdf' });
  } else {
    await Print.printAsync({ uri });
  }
}
