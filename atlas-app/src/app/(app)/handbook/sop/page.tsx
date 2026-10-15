import { requireContext } from '@/server/context';
import { sopGuideFor } from '@/server/handbook';

/**
 * SOP guidebook - "ek din ka business" (5 Oct 2026). A demo CCTV business
 * lived through one day: setup, every flow as a diagram, each step with its
 * role, its reason and a link to the live screen. Hinglish with a Hindi
 * switch. Built on the server for the reader's level and shown in an iframe,
 * exactly like the Handbook next to it.
 */
export default async function SopGuidePage() {
  const ctx = await requireContext();
  const html = sopGuideFor(ctx, 'app', '');

  return (
    <iframe
      title="SOP Guidebook"
      srcDoc={html}
      className="block w-full rounded-lg border border-border bg-background"
      style={{ height: 'calc(100dvh - 7.5rem)' }}
    />
  );
}
