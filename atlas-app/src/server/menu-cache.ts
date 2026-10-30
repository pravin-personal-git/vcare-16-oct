import 'server-only';
import { revalidateTag } from 'next/cache';

/** The cache tag on the menu settings every page reads (server/context, 31 Oct 2026). */
export const MENU_CONFIG_TAG = 'menu-config';

/** After a menu setting changes, so the next page shows it at once rather than after the 60 s cache. */
export function forgetMenuConfig() {
  // Outside a Next request (scripts) there is no cache to clear; the 60 s expiry covers it.
  try { revalidateTag(MENU_CONFIG_TAG); } catch { /* nothing cached here */ }
}
