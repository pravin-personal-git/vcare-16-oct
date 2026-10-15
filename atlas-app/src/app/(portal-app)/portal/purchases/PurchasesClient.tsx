'use client';

import { useState } from 'react';
import { Badge, Card, EmptyState, PageHeader, type BadgeTone } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import { STATUS_LABEL, type InvoiceStatus } from '@/lib/invoice-status';
import type { PortalInvoiceRow } from '@/server/portal';
import { CustomerFileList } from '@/components/document/CustomerFileList';

const STATUS_TONE: Record<InvoiceStatus, BadgeTone> = {
  draft: 'neutral',
  pending: 'warning',
  sent: 'info',
  partially_paid: 'warning',
  paid: 'success',
  overdue: 'danger',
  cancelled: 'neutral',
};

const fmtDate = (d: Date) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export function PurchasesClient({ invoices }: { invoices: PortalInvoiceRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div>
      <PageHeader badge="receipt" title="My Purchases" subtitle={`${invoices.length} invoice${invoices.length === 1 ? '' : 's'} on file`} />

      {invoices.length === 0 ? (
        <Card>
          <EmptyState icon="receipt" title="No purchases on file yet"
            hint="Invoices raised against your account will show up here." />
        </Card>
      ) : (
        <div className="space-y-2">
          {invoices.map((inv) => {
            const open = openId === inv.id;
            return (
              <Card key={inv.id} className="overflow-hidden">
                <button type="button" onClick={() => setOpenId(open ? null : inv.id)}
                  className="flex w-full items-center gap-3 p-3.5 text-start transition hover:bg-muted/40">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-on-tint-brand">
                    <Icon name="receipt" className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{inv.invoiceNo}</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(inv.invoiceDate)} · {inv.items.length} item{inv.items.length === 1 ? '' : 's'}</p>
                  </div>
                  <div className="text-end">
                    <p className="font-mono text-sm font-semibold">{formatCurrency(inv.grandTotalPaise)}</p>
                    <Badge tone={STATUS_TONE[inv.status]}>{STATUS_LABEL[inv.status]}</Badge>
                  </div>
                  <Icon name={open ? 'chevron-up' : 'chevron-down'} className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>

                {open && (
                  <div className="border-t border-border bg-background/60 px-3.5 py-3">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground">
                          <th className="pb-1.5 text-start font-medium">Item</th>
                          <th className="pb-1.5 text-end font-medium">Qty</th>
                          <th className="pb-1.5 text-end font-medium">Rate</th>
                          <th className="pb-1.5 text-end font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inv.items.map((it, i) => (
                          <tr key={i} className="border-t border-border/60">
                            <td className="py-1.5">{it.productName}</td>
                            <td className="py-1.5 text-end font-mono">{it.qty}</td>
                            <td className="py-1.5 text-end font-mono">{formatCurrency(it.unitPricePaise)}</td>
                            <td className="py-1.5 text-end font-mono">{formatCurrency(it.lineTotalPaise)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {inv.files.length > 0 && <div className="mt-3"><CustomerFileList files={inv.files} /></div>}
                    {inv.amountDuePaise > 0 && (
                      <p className="mt-2 text-xs font-medium text-warning">
                        {formatCurrency(inv.amountDuePaise)} still due
                      </p>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
