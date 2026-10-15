import { customer } from '@/server/auth/v1-customer';
import { jsonBody, V1Error } from '@/server/auth/v1-staff';
import { getMyComplaintDetail } from '@/server/portal';
import { ComplaintError } from '@/server/complaints';
import { customerAct, customerJobView, ownedByParty } from '@/server/job-customer';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return customer(req, async (c) => {
    const complaint = await getMyComplaintDetail(c.partyId, c.storeId, id);
    if (!complaint) throw new V1Error('Complaint not found.', 404);
    // Workflow slice 5: milestones, technician, estimate and what they can do now.
    return { complaint, job: await customerJobView(id) };
  });
}

/** The customer acting on their own job from the app (workflow slice 5). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return customer(req, async (c) => {
    const b = await jsonBody(req);
    try {
      const job = await ownedByParty(c.partyId, c.storeId, id);
      await customerAct(job, String(b.op ?? ''), {
        reason: typeof b.reason === 'string' ? b.reason.slice(0, 1000) : null,
        note: typeof b.note === 'string' ? b.note.slice(0, 1000) : null,
        preferred: typeof b.preferred === 'string' ? b.preferred.slice(0, 300) : null,
        stars: typeof b.stars === 'number' ? b.stars : undefined,
        techStars: typeof b.techStars === 'number' ? b.techStars : null,
        comment: typeof b.comment === 'string' ? b.comment.slice(0, 1000) : null,
      }, 'app');
    } catch (e) {
      if (e instanceof ComplaintError) throw new V1Error(e.message);
      throw e;
    }
    return { ok: true, job: await customerJobView(id) };
  });
}
