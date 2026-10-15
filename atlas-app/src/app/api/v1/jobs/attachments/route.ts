import { field, V1Error } from '@/server/auth/v1-staff';
import { db } from '@/server/db';
import { scopeForWrite, scopeWhere } from '@/server/store-scope';
import { addAttachment, bytesMatchType, listAttachments, rejectReason } from '@/server/attachments';
import { putFile, signedUrl, StorageNotConfigured } from '@/server/storage';
import { cleanTag } from '@/lib/attachment-tags';
import { teamIds } from '@/server/team-reach';
import { inScope, type ResolvedAccess } from '@/lib/app-access';
import type { AppContext } from '@/server/context';

/**
 * Photos and voice notes on a job, from the phone (13 Oct 2026, decisions 5
 * and 6). The same files and rules as the website's /api/attachments - the
 * allow-list, the byte check, the private bucket - for a complaint or an
 * installation challan the person may work on:
 *   complaint            - Complaints: edit, and the job is in their reach;
 *   installation_challan - Installations or Orders: edit, and they are on it.
 * GET lists a job's files (signed links, short-lived); POST adds one.
 */
type JobDoc = 'complaint' | 'installation_challan';

async function mayWork(ctx: AppContext, access: ResolvedAccess, docType: JobDoc, docId: string) {
  if (docType === 'complaint') {
    const c = await db.complaint.findFirst({ where: { id: docId, ...scopeWhere(ctx.scope) }, select: { assignedTechnicianId: true } });
    if (!c) return false;
    const team = access.scope.complaints === 'team' ? await teamIds(ctx.scope, ctx.user.id) : undefined;
    if (inScope(access.scope.complaints, [c.assignedTechnicianId], ctx.user.id, team)) return true;
    return (await db.serviceVisit.count({ where: { complaintId: docId, technicianId: ctx.user.id } })) > 0;
  }
  const ch = await db.installationChallan.findFirst({
    where: { id: docId, ...scopeWhere(ctx.scope) },
    select: { assignees: { select: { userId: true } } },
  });
  if (!ch) return false;
  return access.scope.complaints === 'branch' || ch.assignees.some((a) => a.userId === ctx.user.id);
}

const NEED: Record<JobDoc, string[]> = {
  complaint: ['complaints.edit'],
  installation_challan: ['installations.edit', 'orders.edit'],
};

function docOf(v: unknown): JobDoc {
  if (v === 'complaint' || v === 'installation_challan') return v;
  throw new V1Error('Files can be added to a complaint or an installation here.');
}

export async function GET(req: Request) {
  return field(req, ['complaints.view', 'complaints.edit', 'orders.view', 'orders.edit'], null, async (ctx, access) => {
    const u = new URL(req.url);
    const docType = docOf(u.searchParams.get('docType'));
    const docId = u.searchParams.get('docId') ?? '';
    if (!await mayWork(ctx, access, docType, docId)) throw new V1Error('That job is not in your list.', 404);
    const files = await listAttachments(ctx.scope, docType, docId);
    return {
      files: files.map((f) => ({
        id: f.id, fileName: f.fileName, mimeType: f.mimeType, url: f.url, tag: f.tag,
        uploadedAt: f.uploadedAt, uploadedByName: f.uploadedByName,
      })),
    };
  });
}

export async function POST(req: Request) {
  return field(req, ['complaints.edit', 'installations.edit', 'orders.edit'], null, async (ctx, access) => {
    const form = await req.formData().catch(() => null);
    if (!form) throw new V1Error('No file was sent.');
    const docType = docOf(form.get('docType'));
    const docId = String(form.get('docId') ?? '');
    if (!NEED[docType].some((p) => ctx.permissions.has(p))) throw new V1Error('You cannot add files to this job.', 403);
    if (!await mayWork(ctx, access, docType, docId)) throw new V1Error('That job is not in your list.', 404);
    const file = form.get('file');
    if (!(file instanceof File)) throw new V1Error('No file was sent.');

    const reason = rejectReason(file.type, file.size);
    if (reason) throw new V1Error(reason);
    const bytes = await file.arrayBuffer();
    const mismatch = bytesMatchType(file.type, new Uint8Array(bytes.slice(0, 32)));
    if (mismatch) throw new V1Error(mismatch);

    const storeId = scopeForWrite(ctx.scope);
    const tag = cleanTag(form.get('tag')) ?? (file.type.startsWith('audio/') ? 'Voice note' : 'Site photo');
    try {
      const stored = await putFile(storeId, docType, docId, { name: file.name, type: file.type, bytes });
      const row = await addAttachment(ctx.scope, {
        docType, docId, fileName: file.name, fileSize: file.size, mimeType: file.type,
        storagePath: stored.storagePath, label: null, tag, replaces: null,
      }, ctx.user.id);
      return { ok: true, id: row.id, url: await signedUrl(row.storagePath).catch(() => null), tag: row.tag };
    } catch (e) {
      if (e instanceof StorageNotConfigured) throw new V1Error('File storage is not set up for this business yet.');
      throw e;
    }
  });
}
