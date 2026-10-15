'use server';

import { requireContext } from '@/server/context';
import { runAskAiWorkflow, type AskAiAnswer } from '@/server/ask-ai';

export interface AskAiResult {
  ok: boolean;
  error?: string;
  answer?: AskAiAnswer;
}

export async function askAiAction(workflowId: string): Promise<AskAiResult> {
  const ctx = await requireContext();
  try {
    const answer = await runAskAiWorkflow(ctx.scope, workflowId);
    return { ok: true, answer };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not answer that right now.' };
  }
}
