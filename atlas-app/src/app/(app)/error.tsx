'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * A failure inside a page keeps the sidebar and header (health check UX-4) -
 * the root error screen replaced the whole app and sent people to sign in.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[page error]', error); }, [error]);
  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-card">
      <h1 className="text-lg font-semibold">This page could not be loaded</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Something went wrong while loading it. Try again - if it keeps happening, send the reference below to support.
      </p>
      {error.digest && <p className="mt-3 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
      <div className="mt-6 flex justify-center gap-2">
        <button type="button" onClick={reset} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:opacity-90">
          Try again
        </button>
        <Link href="/dashboard" className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted">Dashboard</Link>
      </div>
    </div>
  );
}
