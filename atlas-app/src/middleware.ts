import { NextResponse, type NextRequest } from 'next/server';

/**
 * Tells the server which page was asked for, so `requireContext()` can apply
 * the route permission map (lib/route-access) on every page load and every
 * server action - including client-side navigations, which never re-run the
 * app layout. The header is always overwritten here, so a browser cannot
 * send its own value to pass as another page.
 */
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set('x-atlas-path', req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages and server actions only - API routes do their own checks, and
  // static files need none.
  matcher: ['/((?!api/|_next/|favicon|icon|apple-icon|brand/|.*\.(?:png|jpg|jpeg|svg|webp|ico|txt|xml|json|js|css|map)$).*)'],
};
