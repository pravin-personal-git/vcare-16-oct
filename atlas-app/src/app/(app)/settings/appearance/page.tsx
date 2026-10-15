import { requireContext } from '@/server/context';
import { hslTripleToHex, THEME_TOKENS } from '@/server/administration';
import { readAppearance } from '@/lib/appearance';
import { readPageBackground } from '@/lib/page-background';
import { readLook } from '@/lib/look';
import { AppearanceClient } from './AppearanceClient';

/** Settings › Your business › Appearance (UI refresh, 4 Oct 2026). */
export default async function AppearancePage() {
  const ctx = await requireContext();
  const tokens = (ctx.organization.themeTokens ?? {}) as Record<string, unknown>;
  const hex = (key: string) => {
    const v = tokens[key];
    return typeof v === 'string' ? hslTripleToHex(v) ?? '' : '';
  };
  const fallback = (key: string) => hslTripleToHex(THEME_TOKENS.find((t) => t.key === key)!.fallback) ?? '';

  return (
    <AppearanceClient
      initial={{
        ...readAppearance(tokens),
        primary: hex('--brand-primary'),
        navy: hex('--brand-navy'),
      }}
      defaults={{ primary: fallback('--brand-primary'), navy: fallback('--brand-navy') }}
      orgName={ctx.organization.name}
      canEdit={ctx.permissions.has('settings.edit')}
      pageBackground={readPageBackground(tokens)}
      look={readLook(tokens)}
    />
  );
}
