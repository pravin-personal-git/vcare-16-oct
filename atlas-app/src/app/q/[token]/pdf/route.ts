import { getQuotationByToken } from '@/server/quotations';
import { pdfResponse } from '@/server/pdf-route';

export const dynamic = 'force-dynamic';

/** The quotation as a PDF, for WhatsApp (A3). */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const q = await getQuotationByToken(token);
  return pdfResponse(req, `/q/${token}`, q ? { docNo: q.quotationNo } : null);
}
