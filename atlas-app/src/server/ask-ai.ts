import 'server-only';
import type { StoreScope } from './store-scope';
import { getAccountsTab, getStockTab, getHrTab, type DrillCard } from './dashboard-tabs';
import { getPayrollSummary } from './payroll';
import { listUserAccounts } from './staff-accounts';
import { ASK_AI_WORKFLOWS } from '@/lib/ask-ai-workflows';

/**
 * "Ask AI" - a fixed set of questions an admin actually asks, each backed by
 * the exact same function its dashboard card or detail screen uses. Not a
 * language model: a picker over prewritten questions, each one a real query
 * against this tenant's own data. See `AskAiButton.tsx` for why that
 * distinction is said out loud rather than hidden behind a chat box.
 *
 * Reuses `dashboard-tabs.ts` cards rather than re-deriving the same number a
 * different way - the whole reason that file exists is so two screens never
 * disagree about what a figure is.
 *
 * The question list itself lives in `lib/ask-ai-workflows.ts`, not here -
 * that file has no database access, so the client button can import it
 * directly without pulling this `server-only` module into its bundle.
 */
export { ASK_AI_WORKFLOWS } from '@/lib/ask-ai-workflows';

export interface AskAiAnswer {
  question: string;
  value: string;
  sub?: string;
  route: string;
  tone: DrillCard['tone'];
}

function fromCard(question: string, card: DrillCard): AskAiAnswer {
  return { question, value: card.value, sub: card.sub, route: card.route, tone: card.tone };
}

function findCard(cards: DrillCard[], label: string): DrillCard {
  const c = cards.find((x) => x.label === label);
  if (!c) throw new Error(`[ask-ai] expected card "${label}" was not found - dashboard-tabs.ts changed shape`);
  return c;
}

export async function runAskAiWorkflow(scope: StoreScope, id: string): Promise<AskAiAnswer> {
  const wf = ASK_AI_WORKFLOWS.find((w) => w.id === id);
  if (!wf) throw new Error('Unknown question.');

  switch (id) {
    case 'out-of-stock': {
      const t = await getStockTab(scope);
      return fromCard(wf.question, findCard(t.cards, 'Out of stock'));
    }
    case 'reorder': {
      const t = await getStockTab(scope);
      const card = findCard(t.cards, 'Need reordering');
      const names = t.reorder.slice(0, 5).map((r) => r.name).join(', ');
      return { ...fromCard(wf.question, card), sub: names ? `top: ${names}` : card.sub };
    }
    case 'stock-value': {
      const t = await getStockTab(scope);
      return fromCard(wf.question, findCard(t.cards, 'Stock value'));
    }
    case 'receivable': {
      const t = await getAccountsTab(scope);
      return fromCard(wf.question, findCard(t.cards, 'Owed to you'));
    }
    case 'overdue': {
      const t = await getAccountsTab(scope);
      return fromCard(wf.question, findCard(t.cards, 'Overdue'));
    }
    case 'payable': {
      const t = await getAccountsTab(scope);
      return fromCard(wf.question, findCard(t.cards, 'You owe'));
    }
    case 'net-position': {
      const t = await getAccountsTab(scope);
      return fromCard(wf.question, findCard(t.cards, 'Net position'));
    }
    case 'gross-margin': {
      const t = await getAccountsTab(scope);
      return fromCard(wf.question, findCard(t.cards, 'Gross margin'));
    }
    case 'on-shift': {
      const t = await getHrTab(scope);
      return fromCard(wf.question, findCard(t.cards, 'On shift now'));
    }
    case 'not-marked': {
      const t = await getHrTab(scope);
      return fromCard(wf.question, findCard(t.cards, 'Not marked today'));
    }
    case 'salary-advances': {
      const accounts = await listUserAccounts(scope);
      const owing = accounts.rows.filter((r) => r.advanceOutstandingPaise > 0);
      const totalPaise = owing.reduce((n, r) => n + r.advanceOutstandingPaise, 0);
      const names = owing.slice(0, 5).map((r) => r.fullName).join(', ');
      return {
        question: wf.question,
        value: `₹${Math.round(totalPaise / 100).toLocaleString('en-IN')}`,
        sub: owing.length > 0 ? `${owing.length} staff: ${names}` : 'nobody carries an advance right now',
        route: '/user/account',
        tone: owing.length > 0 ? 'warning' : 'success',
      };
    }
    case 'payroll': {
      const p = await getPayrollSummary(scope);
      const rupees = (n: number) => `₹${Math.round(n / 100).toLocaleString('en-IN')}`;
      return {
        question: wf.question,
        value: rupees(p.netPaise),
        sub: `net, for ${p.employeeCount} employee${p.employeeCount === 1 ? '' : 's'} - gross ${rupees(p.grossPaise)}, PF ${rupees(p.pfPaise)}, ESIC ${rupees(p.esicPaise)}, advances ${rupees(p.advancesOutstandingPaise)}`,
        route: '/hrm/salary',
        tone: 'info',
      };
    }
    default:
      throw new Error('Unknown question.');
  }
}
