import { requireContext } from '@/server/context';
import { listFaqCategories, listFaqs } from '@/server/helpdesk';
import { Card, EmptyState, PageHeader } from '@/components/ui/Layout';
import { FaqsClient } from './FaqsClient';

export default async function HelpdeskFaqsPage() {
  const ctx = await requireContext();

  if (ctx.scope.kind === 'all') {
    return (
      <div>
        <PageHeader badge="FQ" title="FAQs" subtitle="Answers to questions employees ask often" />
        <Card>
          <EmptyState icon="building" title="Choose a branch first" hint="FAQs are kept per branch." />
        </Card>
      </div>
    );
  }

  const [categories, faqs] = await Promise.all([
    listFaqCategories(ctx.scope),
    listFaqs(ctx.scope),
  ]);

  return (
    <FaqsClient
      categories={categories}
      faqs={faqs}
      canManage={ctx.permissions.has('helpdesk.edit')}
    />
  );
}
