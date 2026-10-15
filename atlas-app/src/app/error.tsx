'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-surface p-8">
      <div className="w-full max-w-md rounded border border-border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page could not be loaded. This has been logged.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={reset}
            className="rounded bg-brand px-4 py-2 text-sm font-medium text-brand-fg hover:bg-brand-hover"
          >
            Try again
          </button>
          <a
            href="/login"
            className="rounded border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            Back to sign in
          </a>
        </div>
      </div>
    </div>
  );
}
