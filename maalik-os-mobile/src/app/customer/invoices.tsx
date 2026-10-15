import { useCallback } from 'react';
import { useT } from '@/i18n/I18nProvider';
import { Banner } from '@/components/ui';
import { Empty, Loading, Pill, Row, SubScreen, fmtDate, rupees, useLoad } from '@/components/Kit';
import { customerInvoices } from '@/lib/jobs';

/** The customer's bills. Payments are not taken in the app (roadmap decision). */
export default function Invoices() {
  const { t } = useT();
  const { data, error, loading, reload } = useLoad(useCallback(() => customerInvoices(), []));
  return (
    <SubScreen title={t('My bills')} onRefresh={reload}>
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !data ? <Loading /> : data && (data.invoices.length === 0 ? <Empty icon="file" title={t('No bills yet')} /> : data.invoices.map((i) => (
        <Row
          key={i.id}
          title={i.invoiceNo}
          line={i.items.slice(0, 2).map((x) => `${x.productName} × ${x.qty}`).join(', ')}
          meta={`${fmtDate(i.invoiceDate)} · ${rupees(i.grandTotalPaise)}`}
          right={i.amountDuePaise > 0 ? <Pill label={`${t('Due')} ${rupees(i.amountDuePaise)}`} tone="warning" /> : <Pill label={t('Paid')} tone="success" />}
        />
      )))}
    </SubScreen>
  );
}
