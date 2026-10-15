import { requireContext } from '@/server/context';
import { handbookFor } from '@/server/handbook';

/**
 * Help & Handbook - "How Atlas works" and the old FAQ page, merged (26 Sep 2026).
 *
 * WHY THIS IS A SCREEN AND NOT A PDF.
 *
 * A PDF handed over at go-live is read once and is wrong within a month. This
 * lives at a URL and ships with the code, updated in the same commit as the
 * behaviour it describes. The same document can be downloaded as one HTML file
 * for someone to keep on their own laptop.
 *
 * WHO SEES WHAT
 *
 * Everyone signed in can open it, but the server builds it for the reader's
 * level (field / office / admin, from their permissions) - chapters above that
 * level are never sent to the browser. It is shown in an iframe so its own
 * light/dark and English/Hindi switches do not touch the rest of the app.
 */
export default async function HandbookPage() {
  const ctx = await requireContext();
  const html = await handbookFor(ctx, 'app', '');

  return (
    <iframe
      title="Atlas Handbook"
      srcDoc={html}
      className="block w-full rounded-lg border border-border bg-background"
      style={{ height: 'calc(100dvh - 7.5rem)' }}
    />
  );
}
