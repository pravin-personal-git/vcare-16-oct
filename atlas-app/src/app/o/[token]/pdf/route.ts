import { getOrderByToken } from '@/server/customer-links';
import { pdfResponse } from '@/server/pdf-route';

export const dynamic = 'force-dynamic';

/** The sales order as a PDF, for WhatsApp (A3) - items and stage, no prices (W2), like its link. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const o = await getOrderByToken(token);
  return pdfResponse(req, `/o/${token}`, o ? { docNo: o.orderNo } : null);
}
