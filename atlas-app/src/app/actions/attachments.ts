'use server';

import { requireContext } from '@/server/context';
import { canAttach } from '@/lib/attachment-access';
import { friendlyError } from '@/lib/friendly-error';
import { rulesFor, type RequiredRule } from '@/lib/attachment-tags';
import { readKindForTag, describeDocRead } from '@/lib/scan/doc-read';

/**
 * The per-file actions on an attachment (11 Oct 2026, ops-pages demo tab 4):
 * change tag, show to the customer, WhatsApp link, read it, remove with a
 * reason. Each checks the edit right of the document the file hangs off
 * (lib/attachment-access) - the same right the upload needed.
 */

type Res<T = object> = { error?: string } & Partial<T>;

async function fileFor(id: string) {
  const ctx = await requireContext();
  const { findAttachment } = await import('@/server/attachments');
  const file = await findAttachment(ctx.scope, id);
  if (!file) throw new Error('That file is not on this document any more.');
  return { ctx, file, may: canAttach(ctx.permissions, file.docType) };
}

export async function setAttachmentTagAction(id: string, tag: string): Promise<Res> {
  try {
    const { ctx, may } = await fileFor(id);
    if (!may) return { error: 'You do not have permission to change files on this document.' };
    const { updateAttachment } = await import('@/server/attachments');
    await updateAttachment(ctx.scope, id, { tag });
    return {};
  } catch (e) { return { error: friendlyError(e) }; }
}

export async function setAttachmentVisibleAction(id: string, visible: boolean): Promise<Res> {
  try {
    const { ctx, may } = await fileFor(id);
    if (!may) return { error: 'You do not have permission to change files on this document.' };
    const { updateAttachment } = await import('@/server/attachments');
    await updateAttachment(ctx.scope, id, { visibleToCustomer: visible });
    return {};
  } catch (e) { return { error: friendlyError(e) }; }
}

export async function removeAttachmentAction(id: string, reason: string): Promise<Res> {
  try {
    if (!reason.trim()) return { error: 'Say why it is being removed.' };
    const { ctx, may } = await fileFor(id);
    if (!may) return { error: 'You do not have permission to remove files on this document.' };
    const { removeAttachment } = await import('@/server/attachments');
    await removeAttachment(ctx.scope, id, ctx.user.id, reason);
    return {};
  } catch (e) { return { error: friendlyError(e) }; }
}

/** A link the customer can open from WhatsApp, valid for a week. */
export async function shareAttachmentAction(id: string): Promise<Res<{ url: string; days: number }>> {
  try {
    await fileFor(id);
    const { shareToken, SHARE_LINK_DAYS } = await import('@/server/attachment-share');
    const h = await (await import('next/headers')).headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
    const proto = h.get('x-forwarded-proto') ?? 'https';
    return { url: `${proto}://${host}/api/files/${shareToken(id)}`, days: SHARE_LINK_DAYS };
  } catch (e) { return { error: friendlyError(e) }; }
}

/** Read a PO / payment proof with the AI reader and check the amount against the document. */
export async function readAttachmentAction(id: string): Promise<Res<{ summary: string; match: boolean | null }>> {
  try {
    const { ctx, file, may } = await fileFor(id);
    if (!may) return { error: 'You do not have permission to change files on this document.' };
    const kind = readKindForTag(file.tag);
    if (!kind) return { error: 'Only a file tagged Customer PO or Payment proof can be read.' };
    if (file.fileSize > 4 * 1024 * 1024) return { error: 'That file is over 4 MB - too large to read. Attach a smaller photo or PDF.' };
    const { attachmentBytes, documentAmountPaise, saveExtracted } = await import('@/server/attachments');
    const { readDocWithAi, ScanError } = await import('@/server/scan');
    const bytes = await attachmentBytes(file.storagePath);
    if (!bytes) return { error: 'The file could not be fetched from storage.' };
    try {
      const read = await readDocWithAi({ organizationId: ctx.organization.id, userId: ctx.user.id }, { kind, bytes, mediaType: file.mimeType });
      const expected = await documentAmountPaise(file.storeId, file.docType as never, file.docId);
      const out = describeDocRead(kind, read, expected);
      await saveExtracted(ctx.scope, id, { ...out, read, readAt: new Date().toISOString() });
      return out;
    } catch (e) {
      if (e instanceof ScanError) return { error: e.message };
      throw e;
    }
  } catch (e) { return { error: friendlyError(e) }; }
}

/**
 * What the panel needs to draw "This document needs": the rules that apply to
 * this document (amount-aware), and whether reading with AI is switched on.
 */
export async function attachmentNeedsAction(docType: string, docId: string): Promise<{
  rules: RequiredRule[]; aiOn: boolean; canEdit: boolean;
}> {
  const ctx = await requireContext();
  const { requiredRulesFor, documentAmountPaise } = await import('@/server/attachments');
  const { aiScanStatus } = await import('@/server/scan');
  const all = await requiredRulesFor(ctx.scope);
  const amount = ctx.scope.kind === 'single' ? await documentAmountPaise(ctx.scope.storeId, docType as never, docId) : 0;
  const rules = rulesFor(all, docType, amount);
  const ai = await aiScanStatus(ctx.organization.id).catch(() => null);
  return { rules, aiOn: !!ai?.enabled && ai.configured, canEdit: canAttach(ctx.permissions, docType) };
}
