'use client';

import { formatCurrency } from '@/lib/format';
import { amountInWords } from '@/lib/amount-in-words';
import type { PayslipDocumentVM } from './PayslipViewClient';

const fmt = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

const fmtMonth = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'long', year: 'numeric' });

/**
 * The printable payslip. Same "screen at A4 proportions, print styles hide
 * the app chrome" pattern as `QuotationPaper` - see that file for why.
 */
export function PayslipPaper({ slip: s }: { slip: PayslipDocumentVM }) {
  return (
    <div className="mx-auto max-w-3xl">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #payslip-paper, #payslip-paper * { visibility: visible; }
          #payslip-paper {
            position: absolute; inset-inline-start: 0; top: 0; width: 100%;
            box-shadow: none; border: 0;
          }
          @page { margin: 12mm; }
        }
      `}</style>

      <div
        id="payslip-paper"
        className="rounded-lg border border-border bg-card p-6 shadow-card sm:p-10"
      >
        {/* ---- letterhead -------------------------------------------------- */}
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4">
          <div className="flex min-w-0 gap-3">
            {s.org.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted brand image
              <img src={s.org.logoUrl} alt={s.org.name} className="h-14 w-14 shrink-0 rounded-lg object-contain" />
            ) : (
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-brand text-xl font-black text-brand-fg">
                {s.org.name.slice(0, 1)}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="text-lg font-bold leading-tight">{s.org.name}</h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {s.store.name}
                {s.store.address && <><br />{s.store.address}</>}
              </p>
              {s.org.gstin && <p className="text-xs font-semibold">GSTIN: {s.org.gstin}</p>}
            </div>
          </div>

          <div className="text-end">
            <p className="text-2xl font-black uppercase tracking-tight text-accent">Payslip</p>
            <p className="mt-1 text-sm font-semibold">
              {fmtMonth(s.run.periodStart)}
            </p>
            <p className="text-xs text-muted-foreground">
              {fmt(s.run.periodStart)} - {fmt(s.run.periodEnd)}
            </p>
          </div>
        </div>

        <div className="h-0.5 w-full bg-navy" />

        {/* ---- net pay banner ------------------------------------------------ */}
        <div className="mt-4 flex items-center justify-between rounded-lg bg-navy px-4 py-3 text-navy-fg">
          <span className="text-sm font-semibold">Employee Net Pay</span>
          <span className="font-mono text-xl font-black tabular-nums text-accent">
            {formatCurrency(s.netPaise)}
          </span>
        </div>

        {/* ---- employee info --------------------------------------------- */}
        <div className="mt-4 grid gap-x-6 gap-y-1 rounded-lg border border-border p-3 text-xs sm:grid-cols-2">
          <Info label="Employee ID" value={s.employeeCode} />
          <Info label="Employee Name" value={s.employeeName} />
          <Info label="Designation" value={s.designation ?? '-'} />
          <Info label="Department" value={s.department ?? '-'} />
          <Info label="Bank Account" value={s.bankAccountNumber ?? '-'} />
          <Info label="Payment Reference" value={s.paymentRef ?? '-'} />
          <Info label="Paid Days" value={`${s.paidDays} / ${s.workingDays}`} />
          <Info label="LOP Days" value={s.lopDays} />
        </div>

        {/* ---- earnings / deductions ---------------------------------------- */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <LineTable
            title="Earnings"
            rows={s.earnings}
            totalLabel="Total Gross Pay"
            totalPaise={s.grossPaise}
            emptyMessage="No earnings this period."
          />
          <LineTable
            title="Deductions"
            rows={s.deductions}
            totalLabel="Total Deductions"
            totalPaise={s.totalDeductionsPaise}
            emptyMessage="No deductions this period."
            negative
          />
        </div>

        {/* ---- net payable ---------------------------------------------- */}
        <div className="mt-4 flex items-center justify-between rounded-lg bg-navy px-4 py-2.5 text-navy-fg">
          <span className="text-sm font-bold">Net Payable</span>
          <span className="font-mono text-base font-bold tabular-nums text-accent">
            {formatCurrency(s.netPaise)}
          </span>
        </div>
        <p className="mt-1 text-xs italic text-muted-foreground">
          {amountInWords(s.netPaise)}
        </p>

        {/* ---- employer contributions (informational only) ------------------- */}
        {s.employerContributions.length > 0 && (
          <div className="mt-5">
            <p className="text-micro font-bold uppercase text-muted-foreground">
              Employer Contributions
            </p>
            <p className="mb-1.5 text-xs text-muted-foreground">
              Paid by the employer on top of net pay - not deducted from this payslip.
            </p>
            <table className="w-full text-xs">
              <tbody>
                {s.employerContributions.map((l) => (
                  <tr key={l.code} className="border-b border-border/60">
                    <td className="py-1 text-xs text-muted-foreground">{l.label}</td>
                    <td className="py-1 text-end font-mono text-xs tabular-nums">
                      {formatCurrency(l.amountPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-6 border-t border-border pt-2 text-center text-xs text-muted-foreground">
          This is a system-generated payslip and does not require a signature.
        </p>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-border/50 py-0.5 sm:justify-start">
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function LineTable({
  title, rows, totalLabel, totalPaise, emptyMessage, negative,
}: {
  title: string;
  rows: { code: string; label: string; amountPaise: number }[];
  totalLabel: string;
  totalPaise: number;
  emptyMessage: string;
  negative?: boolean;
}) {
  return (
    <div>
      <p className="mb-1.5 text-micro font-bold uppercase text-muted-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyMessage}</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((l) => (
              <tr key={l.code} className="border-b border-border/60">
                <td className="py-1.5 pe-4 text-xs text-muted-foreground">{l.label}</td>
                <td className="py-1.5 text-end font-mono text-xs tabular-nums">
                  {negative ? '-' : ''}{formatCurrency(l.amountPaise)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-1 flex items-center justify-between border-t border-border pt-1.5">
        <span className="text-xs font-bold">{totalLabel}</span>
        <span className={`font-mono text-xs font-bold tabular-nums ${negative ? 'text-danger' : ''}`}>
          {negative ? '-' : ''}{formatCurrency(totalPaise)}
        </span>
      </div>
    </div>
  );
}
