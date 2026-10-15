import { NextResponse } from 'next/server';
import { readShareToken } from '@/server/attachment-share';
import { sharedFileUrl } from '@/server/attachments';

/**
 * Opens a file sent on WhatsApp (11 Oct 2026). The token in the link names the
 * file and when it stops working; a fresh ten-minute storage link is minted on
 * every open. No session - the person opening it is usually the customer.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const id = readShareToken(token);
  const url = id ? await sharedFileUrl(id) : null;
  if (!url) {
    return new NextResponse('This link has expired or the file was removed. Ask the business to send it again.', {
      status: 410,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  return NextResponse.redirect(url, 302);
}
