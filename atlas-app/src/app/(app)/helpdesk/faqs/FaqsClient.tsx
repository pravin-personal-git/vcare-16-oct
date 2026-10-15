'use client';
import { ListFilter } from '@/components/ui/ListFilter';

import { useState, useTransition } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Field, PageHeader, SectionCard, EmptyState } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import {
  createFaqCategoryAction, removeFaqCategoryAction, saveFaqAction, removeFaqAction,
} from './actions';

interface CategoryVM { id: string; title: string; faqCount: number }
interface FaqVM { id: string; categoryId: string; categoryTitle: string; question: string; answer: string }

interface Props {
  categories: CategoryVM[];
  faqs: FaqVM[];
  canManage: boolean;
}

const input = 'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

export function FaqsClient({ categories, faqs, canManage }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [editingFaq, setEditingFaq] = useState<FaqVM | 'new' | null>(null);
  const [removingFaq, setRemovingFaq] = useState<FaqVM | null>(null);
  const [removingCategory, setRemovingCategory] = useState<CategoryVM | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const report = (res: { error?: string }, okMessage: string) => {
    setError(res.error ?? null);
    setNotice(res.error ? null : okMessage);
  };

  const doRemoveFaq = () => {
    if (!removingFaq) return;
    startTransition(async () => {
      const res = await removeFaqAction(removingFaq.id);
      report(res, 'FAQ removed.');
      if (!res.error) setRemovingFaq(null);
    });
  };

  const doRemoveCategory = () => {
    if (!removingCategory) return;
    startTransition(async () => {
      const res = await removeFaqCategoryAction(removingCategory.id);
      report(res, 'Category removed.');
      if (!res.error) setRemovingCategory(null);
    });
  };

  return (
    <div>
      <PageHeader
        badge="FQ"
        title="FAQs"
        subtitle="Answers to questions employees ask often"
        actions={canManage && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" icon="plus" onClick={() => setAddingCategory(true)}>New category</Button>
            <Button size="sm" variant="primary" icon="plus" disabled={categories.length === 0} onClick={() => setEditingFaq('new')}>New FAQ</Button>
          </div>
        )}
      />

      {error && (
        <div className="mb-3 flex gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-on-tint-danger">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && !error && (
        <div className="mb-3 flex gap-2 rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-on-tint-success">
          <Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* F1b / D17. An FAQ list exists to be searched - somebody has a question
          and wants the answer, not a tour of the categories. Filtering the
          questions and then re-grouping means a search hides the categories
          that have nothing to say, rather than leaving a page of empty
          headings. */}
      {categories.length === 0 ? (
        <SectionCard title="FAQs" icon="info" bodyClassName="p-0">
          <EmptyState icon="info" title="No FAQs yet" hint={canManage ? 'Create a category, then add a few questions to it.' : 'Nothing has been added yet.'} />
        </SectionCard>
      ) : (
        <ListFilter
          rows={faqs}
          noun="questions"
          placeholder="A question, or a word in the answer…"
          searchOn={(f) => [f.question, f.answer]}
        >
          {(foundFaqs, { cleared }) => (
            categories
              .filter((cat) => cleared || foundFaqs.some((f) => f.categoryId === cat.id))
              .map((cat) => {
                const catFaqs = foundFaqs.filter((f) => f.categoryId === cat.id);
                return (
            <SectionCard
              key={cat.id}
              title={`${cat.title} (${catFaqs.length})`}
              icon="info"
              className="mb-4"
              bodyClassName="p-0"
              action={canManage && (
                <button
                  type="button"
                  onClick={() => setRemovingCategory(cat)}
                  className="text-xs font-medium text-danger hover:underline"
                >
                  Remove category
                </button>
              )}
            >
              {catFaqs.length === 0 ? (
                <EmptyState icon="info" title="Nothing in this category yet" />
              ) : (
                <div className="divide-y divide-border">
                  {catFaqs.map((f) => {
                    const isOpen = openId === f.id;
                    return (
                      <div key={f.id}>
                        <div className="flex items-center gap-2 px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setOpenId(isOpen ? null : f.id)}
                            className="flex flex-1 items-center justify-between gap-2 text-start"
                          >
                            <span className="text-sm font-medium">{f.question}</span>
                            <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          </button>
                          {canManage && (
                            <div className="flex shrink-0 gap-2">
                              <button type="button" onClick={() => setEditingFaq(f)} className="text-xs font-medium text-brand hover:underline">Edit</button>
                              <button type="button" onClick={() => setRemovingFaq(f)} className="text-xs font-medium text-danger hover:underline">Remove</button>
                            </div>
                          )}
                        </div>
                        {isOpen && (
                          <p className="px-4 pb-3 text-sm leading-relaxed text-muted-foreground">{f.answer}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
                );
              })
          )}
        </ListFilter>
      )}

      {addingCategory && (
        <AddCategoryModal
          onClose={() => setAddingCategory(false)}
          onSaved={(res) => { report(res, 'Category created.'); if (!res.error) setAddingCategory(false); }}
        />
      )}
      {editingFaq && (
        <FaqModal
          faq={editingFaq === 'new' ? null : editingFaq}
          categories={categories}
          onClose={() => setEditingFaq(null)}
          onSaved={(res) => { report(res, 'FAQ saved.'); if (!res.error) setEditingFaq(null); }}
        />
      )}
      {removingFaq && (
        <ConfirmDialog
          title="Remove this FAQ?"
          message={<>Remove &ldquo;{removingFaq.question}&rdquo;? This cannot be undone.</>}
          tone="danger"
          confirmLabel="Remove"
          busy={pending}
          onConfirm={doRemoveFaq}
          onClose={() => setRemovingFaq(null)}
        />
      )}
      {removingCategory && (
        <ConfirmDialog
          title="Remove this category?"
          message={
            removingCategory.faqCount > 0
              ? <>Move or remove its {removingCategory.faqCount} FAQ{removingCategory.faqCount === 1 ? '' : 's'} first.</>
              : <>Remove &ldquo;{removingCategory.title}&rdquo;?</>
          }
          tone="danger"
          confirmLabel="Remove"
          busy={pending}
          onConfirm={doRemoveCategory}
          onClose={() => setRemovingCategory(null)}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------------------

function AddCategoryModal({ onClose, onSaved }: { onClose: () => void; onSaved: (res: { error?: string }) => void }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!title.trim()) { setError('Category name is required.'); return; }
    setError(null);
    startTransition(async () => {
      const res = await createFaqCategoryAction(title.trim());
      if (res.error) setError(res.error);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title="New FAQ category"
      icon="info"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={save}>Create</Button>
        </div>
      }
    >
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <Field label="Name" htmlFor="fc-title">
        <input id="fc-title" value={title} onChange={(e) => setTitle(e.target.value)} className={input} placeholder="e.g. Leave & Attendance" />
      </Field>
    </Modal>
  );
}

function FaqModal({
  faq, categories, onClose, onSaved,
}: {
  faq: FaqVM | null;
  categories: CategoryVM[];
  onClose: () => void;
  onSaved: (res: { error?: string }) => void;
}) {
  const [categoryId, setCategoryId] = useState(faq?.categoryId ?? categories[0]?.id ?? '');
  const [question, setQuestion] = useState(faq?.question ?? '');
  const [answer, setAnswer] = useState(faq?.answer ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!categoryId || !question.trim() || !answer.trim()) {
      setError('Choose a category and fill in both the question and the answer.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await saveFaqAction(faq?.id ?? null, { categoryId, question: question.trim(), answer: answer.trim() });
      if (res.error) setError(res.error);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title={faq ? 'Edit FAQ' : 'New FAQ'}
      icon="info"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={save}>Save</Button>
        </div>
      }
    >
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <div className="grid gap-3">
        <Field label="Category" htmlFor="fq-cat">
          <select id="fq-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={input}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </Field>
        <Field label="Question" htmlFor="fq-q">
          <input id="fq-q" value={question} onChange={(e) => setQuestion(e.target.value)} className={input} />
        </Field>
        <Field label="Answer" htmlFor="fq-a">
          <textarea id="fq-a" value={answer} onChange={(e) => setAnswer(e.target.value)} rows={4} className={`${input} h-auto py-2`} />
        </Field>
      </div>
    </Modal>
  );
}
