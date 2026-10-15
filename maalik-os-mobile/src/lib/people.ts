import { authed } from './api';

/**
 * People and money on the phone (13 Oct 2026, native admin app part 5):
 * the website's Team Today with who is on leave, and the money lists -
 * receipts, expenses, what we owe suppliers. Kept as the last copy (lib/net).
 */
export interface TeamPerson {
  userId: string; name: string; status: 'on_shift' | 'done' | 'not_marked' | 'on_leave';
  firstInAt: string | null; lastOutAt: string | null; workedMinutes: number | null; inWithinPolicy: boolean | null;
  source: string | null; phone: string; mockedToday: number;
}
export const teamToday = () =>
  authed<{ people: TeamPerson[]; onLeave: { userId: string; name: string; type: string; until: string }[] }>('/api/v1/people/today');

export interface MoneyPage {
  receiptsToday: { totalPaise: number; count: number };
  receiptsMonth: { totalPaise: number; count: number };
  recentReceipts: { id: string; receiptNo: string; partyName: string; amountPaise: number; method: string; receivedAt: string }[];
  expenseMonth: { totalPaise: number; incomePaise: number; pending: number };
  recentExpenses: { id: string; txnNo: string; amountPaise: number; date: string; description: string | null; status: string; method: string | null }[];
  payables: { totalPaise: number; suppliers: { partyId: string; name: string; owedPaise: number; bills: number; oldestDueDate: string | null }[] };
}
export const moneyPage = () => authed<MoneyPage>('/api/v1/money');
