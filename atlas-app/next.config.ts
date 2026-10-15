import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import path from 'node:path';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // typedRoutes is off deliberately: the sidebar is built from menu rows in the
  // database, so hrefs are runtime strings and cannot be statically typed.
  // Re-enable in Phase 1 when the route set is fixed and known at build time.
  typedRoutes: false,

  // A stray package-lock.json in the home directory makes Next infer the wrong
  // workspace root. Pin it to this app.
  outputFileTracingRoot: path.join(__dirname),

  poweredByHeader: false,

  // A second dev server on this laptop (another chat) writing into the same
  // .next corrupts both - "__webpack_modules__[moduleId] is not a function".
  // scripts/dev-own.cjs sets ATLAS_DIST_DIR so each has its own folder.
  // Unset everywhere else, so Vercel and `next build` keep .next.
  ...(process.env.ATLAS_DIST_DIR ? { distDir: process.env.ATLAS_DIST_DIR } : {}),

  // Product photos for the shop are uploaded through a server action (3 Oct
  // 2026). The default 1 MB refuses most phone photos even after the browser
  // shrinks them; 4 MB stays under Vercel's 4.5 MB request ceiling, which no
  // setting here can raise.
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },

  // FAQ / Help and the static how-to page were merged into /handbook on
  // 26 Sep 2026. Old bookmarks and links in handed-out guides still land.
  async redirects() {
    return [
      /**
       * Attendance settings moved out of /holiday/ on 1 Oct 2026 (workstream
       * I). Biometric readers filed under "holiday" was the clearest single
       * example of the navigation problem - nobody would ever guess it.
       *
       * Redirects rather than a clean break: people bookmark settings pages,
       * saved views carry their path, and the handbook has been handed to
       * clients on paper.
       */
      { source: '/holiday/config', destination: '/settings/attendance', permanent: true },
      { source: '/holiday/config/:path*', destination: '/settings/attendance/:path*', permanent: true },
      { source: '/faq', destination: '/handbook', permanent: true },
      { source: '/how-to-run-atlas.html', destination: '/handbook', permanent: true },
    ];
  },

  // Browser security headers (health check SEC-3, 25 Sep 2026). Camera and
  // location stay allowed for this site itself - the scanner and web
  // attendance use them - and nothing else may frame the app.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()' },
      ],
    }];
  },
};

export default withNextIntl(nextConfig);
