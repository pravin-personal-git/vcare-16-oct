import { NextResponse } from 'next/server';
import { requireApiCaller } from '@/server/auth/api-caller';
import { mobileContext } from '@/server/auth/mobile-context';
import { mobileHomeFor } from '@/lib/mobile-home';
import { accessFor } from '@/server/app-access';
import { brandHexes } from '@/lib/appearance';

/**
 * "Who am I, and what may I do?"
 *
 * For staff this is the whole website context - stores, the active store
 * (from `x-store-id`), roles, permissions, the menu, read-only state - plus
 * `home`, which tells Vcare whether to open the owner view or the
 * employee home. Customers and device tokens get their identity only.
 */
export async function GET(req: Request) {
  const caller = await requireApiCaller(req);
  if (!caller) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (caller.kind !== 'user') return NextResponse.json(caller);

  const ctx = await mobileContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Your account has no store access. Contact your administrator.' }, { status: 403 });
  }
  // What the phone app shows and does - Settings > Roles > Phone app (26 Sep 2026).
  const { values: _values, ...app } = await accessFor(ctx);
  void _values;
  return NextResponse.json({
    kind: 'user',
    user: ctx.user,
    // The business's colours, so Vcare wears them (UI refresh phase 5).
    organization: { id: ctx.organization.id, name: ctx.organization.name, brand: brandHexes(ctx.organization.themeTokens) },
    stores: ctx.stores,
    activeStoreId: ctx.activeStoreId,
    roles: ctx.roleNames,
    permissions: [...ctx.permissions].sort(),
    menu: ctx.menu,
    readOnly: ctx.readOnly,
    // 'owner' opens the full website in the app - the owner, or a role set to Full website.
    // Layout "Full website" (13 Oct 2026) means the same as App home "Full website".
    home: app.home === 'website' || app.layout.preset === 'web' ? 'owner' : mobileHomeFor(ctx.permissions),
    app,
  });
}
