import 'server-only';
import type { Prisma } from '@prisma/client';
import { accessFor } from './app-access';
import { teamIds } from './team-reach';
import type { AppContext } from './context';

/**
 * WHOSE QUOTATIONS, ORDERS AND INVOICES A PERSON SEES (B4 step 3, 11 Oct 2026).
 *
 * By the salesperson on the document, from the role's "Quotations, orders and
 * invoices they see" (Settings > Roles > Phone app > On the website too):
 * only mine, mine + unassigned, mine + my team (+ unassigned), or the whole
 * branch. Null = no limit (whole branch, or the owner). Every list, count,
 * export, search, the Sales dashboard, the customer page and the document
 * pages read THIS, so they cannot disagree.
 */
export interface SalesReach {
  allows: (salespersonId: string | null | undefined) => boolean;
  /** The same rule as a Prisma filter, for queries counted in the database. */
  where: { OR: Prisma.QuotationWhereInput[] } & { OR: Prisma.SalesOrderWhereInput[] } & { OR: Prisma.InvoiceWhereInput[] };
}

export async function salesReach(ctx: AppContext): Promise<SalesReach | null> {
  const access = await accessFor(ctx);
  const mode = access.scope.sales;
  if (access.isOwner || mode === 'branch') return null;
  const team = mode === 'team' ? await teamIds(ctx.scope, ctx.user.id) : new Set<string>();
  const ids = [ctx.user.id, ...team];
  const unassigned = mode !== 'mine';
  const mine = new Set(ids);
  return {
    allows: (sp) => (sp ? mine.has(sp) : unassigned),
    where: { OR: [{ salespersonId: { in: ids } }, ...(unassigned ? [{ salespersonId: null }] : [])] },
  };
}

/** The reach as a spread-able `{ AND: [...] }` (or nothing), beside a where's own branch filter. */
export function reachAnd(reach: SalesReach | null): { AND?: SalesReach['where'][] } {
  return reach ? { AND: [reach.where] } : {};
}

/** Add the reach to a Prisma where - AND, so it never loosens what is there. */
export function withReach<W extends object>(where: W, reach: SalesReach | null): W {
  return reach ? { ...where, AND: [reach.where] } : where;
}

/**
 * A document page outside the person's reach: no-access, said plainly - the
 * same answer as a page hidden in their menu (B1). A link from a customer
 * page or a trail never opens somebody else's document.
 */
export async function guardSalesDoc(ctx: AppContext, salespersonId: string | null | undefined, path: string): Promise<void> {
  const reach = await salesReach(ctx);
  if (reach && !reach.allows(salespersonId)) {
    const { redirect } = await import('next/navigation');
    redirect(`/no-access?from=${encodeURIComponent(path)}&reach=1`);
  }
}

/** The same check for a server action: throws instead of redirecting. */
export async function guardSalesDocOrThrow(ctx: AppContext, salespersonId: string | null | undefined): Promise<void> {
  const reach = await salesReach(ctx);
  if (reach && !reach.allows(salespersonId)) throw new Error('This document belongs to someone else.');
}
