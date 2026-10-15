/**
 * The fixed list of "Ask AI" questions - pure data, no database access, so
 * it can be imported from the client button as well as the server workflow
 * runner in `server/ask-ai.ts`. Keeping it out of that server-only file is
 * what lets the button render the question list without a round trip.
 */
export interface AskAiWorkflow {
  id: string;
  question: string;
  category: 'Stock' | 'Accounts' | 'People';
}

export const ASK_AI_WORKFLOWS: AskAiWorkflow[] = [
  { id: 'out-of-stock', question: 'How many items are out of stock?', category: 'Stock' },
  { id: 'reorder', question: 'Which products need reordering?', category: 'Stock' },
  { id: 'stock-value', question: 'What is my current stock value?', category: 'Stock' },
  { id: 'receivable', question: 'How much do customers owe me?', category: 'Accounts' },
  { id: 'overdue', question: 'How much of that is overdue?', category: 'Accounts' },
  { id: 'payable', question: 'How much do I owe my suppliers?', category: 'Accounts' },
  { id: 'net-position', question: 'What is my net position right now?', category: 'Accounts' },
  { id: 'gross-margin', question: "What's this month's gross margin?", category: 'Accounts' },
  { id: 'on-shift', question: 'Who is on shift right now?', category: 'People' },
  { id: 'not-marked', question: 'Who has not marked attendance today?', category: 'People' },
  { id: 'salary-advances', question: 'Who has outstanding salary advances?', category: 'People' },
  { id: 'payroll', question: "What's this month's payroll look like?", category: 'People' },
];
