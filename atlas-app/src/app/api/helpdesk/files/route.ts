import { NextResponse } from 'next/server';
import { requireContext } from '@/server/context';
import { assertOwnComment, HelpdeskError } from '@/server/helpdesk';
import { putHelpdeskFile } from '@/server/helpdesk-files';
import { StorageNotConfigured } from '@/server/storage';

/**
 * A screenshot or file on your own helpdesk message (30 Oct 2026). A route,
 * not a server action, for the same reason as /api/attachments: a phone
 * screenshot is often over the 1 MB server-action limit.
 */
export async function POST(req: Request) {
  try {
    const ctx = await requireContext();
    const form = await req.formData();
    const ticketId = String(form.get('ticketId') ?? '');
    const commentId = String(form.get('commentId') ?? '');
    const file = form.get('file');
    if (!ticketId || !commentId || !(file instanceof File)) return NextResponse.json({ error: 'No file was sent.' }, { status: 400 });
    const canViewAll = ctx.permissions.has('helpdesk.view') || ctx.permissions.has('helpdesk.edit');
    const storeId = await assertOwnComment(ctx.scope, ticketId, commentId, { userId: ctx.user.id, canViewAll });
    return NextResponse.json(await putHelpdeskFile(storeId, commentId, file, ctx.user.id));
  } catch (err) {
    if (err instanceof StorageNotConfigured) return NextResponse.json({ error: err.message }, { status: 501 });
    const status = err instanceof HelpdeskError ? 403 : 400;
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed.' }, { status });
  }
}
