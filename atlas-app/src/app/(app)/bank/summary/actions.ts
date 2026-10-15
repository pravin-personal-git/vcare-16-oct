'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  listStatementLines, importStatement, autoReconcile, suggestMatches, confirmMatch, clearMatch,
  BankSummaryError, type MatchedType,
} from '@/server/bank-summary';

export interface ActionState {
  ok?: boolean;
  error?: string;
}

function requirePermission(ctx: Awaited<ReturnType<typeof requireContext>>) {
  if (!ctx.permissions.has('accounts.edit')) throw new BankSummaryError('You do not have permission to change bank statement data.');
}

export async function loadStatementAction(bankAccountId: string, fromIso: string | null, toIso: string | null) {
  const ctx = await requireContext();
  const { account, lines } = await listStatementLines(
    ctx.scope, bankAccountId, fromIso ? new Date(fromIso) : undefined, toIso ? new Date(toIso) : undefined,
  );
  return {
    account,
    lines: lines.map((l) => ({ ...l, txnDate: l.txnDate.toISOString(), matchedAt: l.matchedAt?.toISOString() ?? null })),
  };
}

export async function importStatementAction(
  bankAccountId: string, rows: Record<string, string>[],
): Promise<ActionState & { imported?: number; duplicates?: number; errors?: string[] }> {
  try {
    const ctx = await requireContext();
    requirePermission(ctx);
    const result = await importStatement(ctx.scope, bankAccountId, rows, ctx.user.id);
    revalidatePath('/bank/summary');
    return { ok: true, imported: result.importedCount, duplicates: result.duplicateCount, errors: result.errors };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not import that file.' };
  }
}

export async function autoReconcileAction(bankAccountId: string): Promise<ActionState & { autoMatched?: number; ambiguous?: number; stillUnmatched?: number }> {
  try {
    const ctx = await requireContext();
    requirePermission(ctx);
    const result = await autoReconcile(ctx.scope, bankAccountId, ctx.user.id);
    revalidatePath('/bank/summary');
    return { ok: true, ...result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not reconcile.' };
  }
}

export async function suggestMatchesAction(bankTransactionId: string) {
  const ctx = await requireContext();
  const candidates = await suggestMatches(ctx.scope, bankTransactionId);
  return candidates.map((c) => ({ ...c, date: c.date.toISOString() }));
}

export async function confirmMatchAction(bankTransactionId: string, matchedType: MatchedType, matchedId: string): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    requirePermission(ctx);
    await confirmMatch(ctx.scope, bankTransactionId, matchedType, matchedId, ctx.user.id);
    revalidatePath('/bank/summary');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save that match.' };
  }
}

export async function clearMatchAction(bankTransactionId: string): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    requirePermission(ctx);
    await clearMatch(ctx.scope, bankTransactionId);
    revalidatePath('/bank/summary');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not clear that match.' };
  }
}
