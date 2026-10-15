/**
 * Avatar colour resolution, shared by every screen that draws a person as an
 * initials badge (Hierarchy's list and tree views today; more screens can
 * import this rather than reinventing the hash).
 *
 * A picked colour is one of the theme's own tokens, not a free hex value -
 * atmytip's picker offers 12 arbitrary swatches, but this app's whole
 * point is that its palette is theme-token-driven for white-labelling, so
 * the picker offers the same named tokens everywhere else in the product
 * already uses, rather than a second, disconnected colour system.
 */

export const AVATAR_COLOR_OPTIONS = [
  { key: 'brand', label: 'Brand', className: 'bg-brand' },
  { key: 'navy', label: 'Navy', className: 'bg-navy' },
  { key: 'accent', label: 'Accent', className: 'bg-accent' },
  { key: 'info', label: 'Info', className: 'bg-info' },
  { key: 'success', label: 'Success', className: 'bg-success' },
  { key: 'warning', label: 'Warning', className: 'bg-warning' },
  { key: 'danger', label: 'Danger', className: 'bg-danger' },
] as const;

const OPTION_CLASS = new Map(AVATAR_COLOR_OPTIONS.map((o) => [o.key, o.className]));

/** Deterministic from the id, so the same person keeps the same colour across a refresh when nobody has picked one. */
const AUTO_TONES = ['bg-brand', 'bg-navy', 'bg-info', 'bg-success', 'bg-warning'];
function autoTone(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i)) % AUTO_TONES.length;
  return AUTO_TONES[hash];
}

/** `override` is the stored `User.avatarColor` (a key from `AVATAR_COLOR_OPTIONS`, or null for automatic). */
export function resolveAvatarClass(id: string, override: string | null): string {
  if (override) {
    const cls = OPTION_CLASS.get(override as (typeof AVATAR_COLOR_OPTIONS)[number]['key']);
    if (cls) return cls;
  }
  return autoTone(id);
}
