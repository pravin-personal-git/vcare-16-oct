'use server';

import { requireContext } from '@/server/context';
import {
  dryRunCustomers, dryRunProducts, commitCustomers, commitProducts,
  type DryRunReport, type ImportOutcome,
} from '@/server/import';
import { MAX_IMPORT_ROWS, type ImportTarget } from '@/lib/import-fields';

export interface ImportActionState<T> {
  error?: string;
  data?: T;
}

function checkPermission(target: ImportTarget, permissions: { has: (k: string) => boolean }): string | null {
  const key = target === 'customers' ? 'customers.create' : 'products.edit';
  if (!permissions.has(key)) {
    return target === 'customers'
      ? 'You do not have permission to add customers.'
      : 'You do not have permission to add products.';
  }
  return null;
}

function checkSize(rows: unknown[]): string | null {
  if (rows.length === 0) return 'The file has no data rows.';
  if (rows.length > MAX_IMPORT_ROWS) {
    return `That file has ${rows.length} rows. Import ${MAX_IMPORT_ROWS} at a time - split it and run this again.`;
  }
  return null;
}

export async function dryRunImport(
  target: ImportTarget, headers: string[], rows: Record<string, string>[],
): Promise<ImportActionState<DryRunReport>> {
  try {
    const ctx = await requireContext();
    const permError = checkPermission(target, ctx.permissions);
    if (permError) return { error: permError };

    const sizeError = checkSize(rows);
    if (sizeError) return { error: sizeError };

    const report = target === 'customers'
      ? await dryRunCustomers(ctx.scope, headers, rows)
      : await dryRunProducts(ctx.scope, headers, rows);

    return { data: report };
  } catch (err) {
    console.error('[import] dry run failed', err);
    return { error: 'Could not read that file. Check it is a plain CSV export.' };
  }
}

export async function commitImport(
  target: ImportTarget, headers: string[], rows: Record<string, string>[],
): Promise<ImportActionState<ImportOutcome[]>> {
  try {
    const ctx = await requireContext();
    const permError = checkPermission(target, ctx.permissions);
    if (permError) return { error: permError };

    if (ctx.scope.kind !== 'single') {
      return { error: 'Select a single store before importing - All Company is read-only.' };
    }

    const sizeError = checkSize(rows);
    if (sizeError) return { error: sizeError };

    const outcomes = target === 'customers'
      ? await commitCustomers(ctx.scope, headers, rows)
      : await commitProducts(ctx.scope, headers, rows);

    return { data: outcomes };
  } catch (err) {
    console.error('[import] commit failed', err);
    return { error: 'The import failed partway through. Rows already created above are real; re-run the file to pick up the rest.' };
  }
}
