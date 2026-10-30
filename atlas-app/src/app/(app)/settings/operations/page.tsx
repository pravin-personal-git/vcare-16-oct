import { redirect } from 'next/navigation';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { listPeopleAccess } from '@/server/user-access';
import { OperationsClient } from './OperationsClient';

/**
 * OPERATIONS & APPROVALS (30 Oct 2026, Vcare): one place that decides what
 * needs an approval and who may see, change or approve each thing. Each
 * person's access saves (server/user-access), and so does each approval
 * switch, into the approval rules the engine reads (server/approval-rules-admin).
 */
export default async function OperationsPage() {
  const ctx = await requireContext();
  if (!ctx.permissions.has('settings.edit')) redirect('/dashboard');
  if (ctx.scope.kind !== 'single') {
    return <p className="rounded-2xl bg-card p-5 text-sm">Upar ek branch chuniye - har branch ke approvals aur access alag hote hain.</p>;
  }
  const storeId = ctx.scope.storeId;
  const [rules, people] = await Promise.all([
    db.approvalRule.findMany({ where: { storeId }, select: { requestType: true, needsApproval: true, thresholdPaise: true, levels: { select: { level: true, approverKind: true } } } }),
    listPeopleAccess(storeId),
  ]);
  return (
    <OperationsClient
      meId={ctx.user.id}
      rules={Object.fromEntries(rules.map((r) => {
        // One level to the owner or the manager can be edited here; anything else is kept as set on Approval Rules.
        const kinds = r.levels.map((l) => l.approverKind);
        const approver = kinds.length === 1 && (kinds[0] === 'owner' || kinds[0] === 'manager') ? kinds[0] : kinds.length ? 'keep' : 'owner';
        return [r.requestType, { on: r.needsApproval, approver, thresholdPaise: r.thresholdPaise }];
      }))}
      people={people}
    />
  );
}
