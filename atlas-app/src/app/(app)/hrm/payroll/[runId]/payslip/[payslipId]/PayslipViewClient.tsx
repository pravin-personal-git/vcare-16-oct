'use client';

import { DetailHeader } from '@/components/document/DetailHeader';
import { formatCurrency } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { PayslipPaper } from './PayslipPaper';

export interface PayslipDocumentVM {
  id: string;
  generatedAt: string;
  paymentRef: string | null;

  org: { name: string; gstin: string | null; logoUrl: string | null };
  store: { name: string; address: string | null };
  run: { label: string; periodStart: string; periodEnd: string; status: string };

  employeeName: string;
  employeeCode: string;
  designation: string | null;
  department: string | null;
  bankAccountNumber: string | null;

  workingDays: number;
  paidDays: string;
  lopDays: string;

  grossPaise: number;
  totalDeductionsPaise: number;
  netPaise: number;

  earnings: { code: string; label: string; amountPaise: number }[];
  deductions: { code: string; label: string; amountPaise: number }[];
  employerContributions: { code: string; label: string; amountPaise: number }[];
}

export function PayslipViewClient({ slip, runId }: { slip: PayslipDocumentVM; runId: string }) {
  return (
    <div>
      <DetailHeader
        icon="file-text"
        kind="Payslip"
        number={slip.employeeName}
        facts={[
          { label: 'Run', value: slip.run.label },
          { label: 'Code', value: slip.employeeCode },
          { label: 'Net pay', value: formatCurrency(slip.netPaise) },
        ]}
        backHref={`/hrm/payroll/${runId}`}
        backLabel="Back to payroll run"
        actions={
          <>
            <Button variant="outline" size="icon" icon="printer" title="Print" onClick={() => window.print()} />
            <Button variant="primary" size="icon" icon="download" title="Download PDF" onClick={() => window.print()} />
          </>
        }
      />

      <PayslipPaper slip={slip} />
    </div>
  );
}
