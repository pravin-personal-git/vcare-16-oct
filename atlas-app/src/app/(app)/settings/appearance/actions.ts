'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { AdminError, hexToHslTriple, resetAppearance, setAppearance, setLook, setPageBackground } from '@/server/administration';
import { friendlyError } from '@/lib/friendly-error';

export interface AppearanceState { error?: string; ok?: boolean; message?: string }

async function guard(run: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<string>): Promise<AppearanceState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) {
      return { error: 'You do not have permission to change how Atlas looks for this business.' };
    }
    const message = await run(ctx);
    // The look is injected by every layout, so every screen is revalidated.
    revalidatePath('/', 'layout');
    if (ctx.scope.kind === 'single') {
      await db.activityLog.create({
        data: {
          storeId: ctx.scope.storeId, userId: ctx.user.id, activityType: 'Update',
          entityType: 'Organization', entityId: ctx.organization.id, description: message,
        },
      }).catch((e) => console.error('[appearance] audit write failed (non-fatal)', e));
    }
    return { ok: true, message };
  } catch (err) {
    if (err instanceof AdminError) return { error: err.message };
    console.error('[appearance] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function saveAppearanceAction(input: {
  font: string; sidebar: string; corners: string; density: string; links: string;
  // 12 Oct 2026: headings, numbers, text size, buttons (lib/appearance).
  headingFont: string; headingWeight: string; headingStyle: string; headingBacking: string;
  numberWeight: string; textSize: string; buttonShape: string; quietButtons: string;
  /** Hex from the picker. Empty = keep the product default. */
  primary: string; navy: string;
}): Promise<AppearanceState> {
  return guard(async (ctx) => {
    const palette: Record<string, string> = {};
    for (const [key, hex] of [['--brand-primary', input.primary], ['--brand-navy', input.navy]] as const) {
      if (!hex) continue;
      const triple = hexToHslTriple(hex);
      if (!triple) throw new AdminError(`"${hex}" is not a colour I can read. Use a hex value like #1D4ED8.`);
      palette[key] = triple;
    }
    // Keep a saved accent - this screen does not edit it.
    const accent = (ctx.organization.themeTokens as Record<string, unknown> | null)?.['--brand-accent'];
    if (typeof accent === 'string') palette['--brand-accent'] = accent;
    await setAppearance(ctx.organization.id, input, palette);
    return `Appearance saved: ${input.font}, ${input.sidebar} sidebar, ${input.corners} corners, ${input.density}`;
  });
}

export async function resetAppearanceAction(): Promise<AppearanceState> {
  return guard(async (ctx) => {
    await resetAppearance(ctx.organization.id);
    return 'Appearance reset to the Atlas defaults';
  });
}

/** The page background - default, one colour or a gradient (12 Oct 2026). */
export async function savePageBackgroundAction(input: unknown): Promise<AppearanceState> {
  return guard(async (ctx) => {
    const bg = await setPageBackground(ctx.organization.id, input);
    return bg.kind === 'default' ? 'Page background back to the Atlas grey'
      : bg.kind === 'solid' ? `Page background set to ${bg.color}`
      : `Page background set to a ${bg.type} gradient of ${bg.stops.length} colours`;
  });
}

/** The colours of the top bar, cards, tables, buttons and text (12 Oct 2026, lib/look). */
export async function saveLookAction(input: unknown): Promise<AppearanceState> {
  return guard(async (ctx) => {
    const look = await setLook(ctx.organization.id, input);
    const chosen = Object.values(look.box).filter(Boolean).length + Object.values(look.text).filter(Boolean).length;
    return chosen === 0 && look.cardGlass === 'solid'
      ? 'Colours and text back to the Atlas defaults'
      : `Colours and text saved: ${chosen} colour${chosen === 1 ? '' : 's'} chosen, ${look.cardGlass} cards`;
  });
}
