'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { askAiAction, type AskAiResult } from '@/app/actions/ask-ai';
import { ASK_AI_WORKFLOWS } from '@/lib/ask-ai-workflows';

const TONE_CLASS: Record<string, string> = {
  success: 'text-success', warning: 'text-warning', danger: 'text-danger',
  info: 'text-info', default: 'text-foreground',
};

const CATEGORIES = ['Stock', 'Accounts', 'People'] as const;

/**
 * The reference app puts an "ASK AI" button in the header.
 *
 * We keep the affordance because clients expect it, and drop the mystique.
 * This is a fixed list of questions, each one a real query over this
 * tenant's own data - the same functions the dashboard cards use, not a
 * language model. "The AI said so" is not checkable; every answer here
 * carries a link to the screen that backs it.
 */
export function AskAiButton() {
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState<{ question: string; result: AskAiResult }[]>([]);
  const [pending, startTransition] = useTransition();

  const ask = (id: string, question: string) => {
    startTransition(async () => {
      const result = await askAiAction(id);
      setAsked((a) => [{ question, result }, ...a]);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded bg-navy px-3 text-sm font-medium text-navy-fg shadow-card transition hover:bg-navy-hover"
      >
        <Icon name="sparkles" className="h-4 w-4" />
        <span className="hidden sm:inline">Ask AI</span>
      </button>

      {open && (
        <Modal
          title="Ask AI"
          subtitle="Real answers from your own data - not a language model"
          icon="sparkles"
          tone="navy"
          size="md"
          onClose={() => setOpen(false)}
        >
          <div className="space-y-4">
            {CATEGORIES.map((cat) => (
              <div key={cat}>
                <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">{cat}</p>
                <div className="flex flex-wrap gap-1.5">
                  {ASK_AI_WORKFLOWS.filter((w) => w.category === cat).map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      disabled={pending}
                      onClick={() => ask(w.id, w.question)}
                      className="rounded-full border border-border px-2.5 py-1 text-xs transition hover:bg-muted disabled:opacity-50"
                    >
                      {w.question}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {asked.length > 0 && (
              <div className="space-y-2 border-t border-border pt-3">
                {asked.map((a, i) => (
                  <div key={i} className="rounded-lg border border-border bg-card p-3">
                    <p className="text-xs text-muted-foreground">{a.question}</p>
                    {a.result.ok && a.result.answer ? (
                      <>
                        <p className={`mt-1 text-lg font-semibold ${TONE_CLASS[a.result.answer.tone ?? 'default']}`}>
                          {a.result.answer.value}
                        </p>
                        {a.result.answer.sub && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{a.result.answer.sub}</p>
                        )}
                        <Link
                          href={a.result.answer.route}
                          onClick={() => setOpen(false)}
                          className="mt-1 inline-block text-xs font-medium text-brand hover:underline"
                        >
                          Check it →
                        </Link>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-danger">{a.result.error}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              Every answer above is a rule over your own data - the same numbers the dashboard
              cards use - and every one is reproducible and checkable by hand. Nothing here sends
              your business data to a third party.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
