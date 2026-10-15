'use client';

import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/Layout';
import type { BadgeTone } from '@/components/ui/Layout';
import type { LegalEntityRow } from '@/server/administration';

interface Props {
  entities: (Omit<LegalEntityRow, 'createdAt'> & { createdAt: string })[];
}

const STATUS_TONE: Record<string, BadgeTone> = {
  APPROVED: 'success',
  PENDING: 'warning',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
};

/**
 * Read-only for now (platform-ownership Slice 2, D046). Every tenant
 * already has exactly one legal entity, created automatically. A
 * create/approve/edit workflow (spec §6-§7) is a later slice - this makes
 * the concept visible without promising controls that don't exist yet.
 */
export function LegalEntitiesClient({ entities }: Props) {
  return (
    <div>
      <PageHeader
        badge="LE"
        title="Legal Entities"
        subtitle={`${entities.length} legal business ${entities.length === 1 ? 'entity' : 'entities'} under this organisation`}
      />

      {entities.length === 0 ? (
        <Card>
          <EmptyState
            icon="building"
            title="No legal entities yet"
            hint="Every organisation should have at least one - this is unexpected. Contact support."
          />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">GSTIN</th>
                <th className="px-4 py-2.5 font-medium">PAN</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Branches</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {entities.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{e.name}</div>
                    {e.legalName && e.legalName !== e.name && (
                      <div className="text-xs text-muted-foreground">{e.legalName}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{e.gstin ?? '—'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{e.pan ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={STATUS_TONE[e.status] ?? 'neutral'}>{e.status}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{e.storeCount}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {new Date(e.createdAt).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
                      day: '2-digit', month: 'short', year: 'numeric',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
