import { NextResponse } from 'next/server';
import { getPlatformContext } from '@/server/platform-context';
import { resolveBestOrgScope } from '@/server/platform-scope';
import { HelpdeskError } from '@/server/helpdesk';
import { putHelpdeskFile } from '@/server/helpdesk-files';
import { supportCommentStore } from '@/server/platform-support';
import { StorageNotConfigured } from '@/server/storage';

/** A screenshot or file on a support team reply (30 Oct 2026) - see /api/helpdesk/files. */
export async function POST(req: Request) {
  try {
    const ctx = await getPlatformContext();
    if (!ctx) return NextResponse.json({ error: 'Sign in to the platform portal.' }, { status: 401 });
    const scope = await resolveBestOrgScope(ctx.memberships);
    if (!scope) return NextResponse.json({ error: 'Your account has no scope over any business.' }, { status: 403 });
    const form = await req.formData();
    const ticketId = String(form.get('ticketId') ?? '');
    const commentId = String(form.get('commentId') ?? '');
    const file = form.get('file');
    if (!ticketId || !commentId || !(file instanceof File)) return NextResponse.json({ error: 'No file was sent.' }, { status: 400 });
    const storeId = await supportCommentStore(scope, ticketId, commentId, ctx.user.id);
    return NextResponse.json(await putHelpdeskFile(storeId, commentId, file, ctx.user.id));
  } catch (err) {
    if (err instanceof StorageNotConfigured) return NextResponse.json({ error: err.message }, { status: 501 });
    const status = err instanceof HelpdeskError ? 403 : 400;
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed.' }, { status });
  }
}
