'use client';

import { CustomerJobPanel, type CustomerJobVM } from '@/components/services/CustomerJobPanel';
import { linkAct } from './actions';

/** The no-login link page: the customer panel, acting through the link's token. */
export function JobLinkClient({ token, job, businessName }: { token: string; job: CustomerJobVM; businessName: string }) {
  return <CustomerJobPanel job={job} businessName={businessName} reportHref={`/j/${token}/report`} act={(op, body) => linkAct(token, op, body)} />;
}
