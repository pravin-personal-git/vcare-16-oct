import { requireContext } from '@/server/context';
import {
  listSalaryContracts, COMPONENT_PRESETS, CONTRACT_TYPES, CALC_TYPES,
  OVERTIME_KINDS, CONDITION_FIELDS, CONDITION_OPERATORS,
} from '@/server/salary-contracts';
import { ContractsClient } from './ContractsClient';
import { EmptyState, PageHeader } from '@/components/ui/Layout';

export default async function ContractsPage() {
  const ctx = await requireContext();

  if (ctx.scope.kind !== 'single') {
    return (
      <div>
        <PageHeader badge="₹" title="Contracts" subtitle="Salary structure per employee" />
        <EmptyState
          icon="building"
          title="Choose a branch first"
          hint="A salary contract belongs to one branch - pick one from the branch switcher above."
        />
      </div>
    );
  }

  const rows = await listSalaryContracts(ctx.scope);

  return (
    <ContractsClient
      rows={rows.map((r) => ({
        ...r,
        effectiveFrom: r.effectiveFrom?.toISOString() ?? null,
        components: r.components.map((c) => ({
          ...c, oneTimePeriodStart: c.oneTimePeriodStart?.toISOString() ?? null,
        })),
      }))}
      presets={[...COMPONENT_PRESETS]}
      contractTypes={[...CONTRACT_TYPES]}
      calcTypes={[...CALC_TYPES]}
      overtimeKinds={[...OVERTIME_KINDS]}
      conditionFields={[...CONDITION_FIELDS]}
      conditionOperators={[...CONDITION_OPERATORS]}
      canEdit={ctx.permissions.has('payroll.configure')}
    />
  );
}
