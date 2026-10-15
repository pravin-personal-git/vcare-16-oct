/**
 * A small fixed set of theme-token names for a tag's colour - never a
 * literal hex value, per this codebase's white-label rule (see
 * `globals.css`'s own note on why every colour must resolve through a
 * token). The UI maps each of these to its Tailwind class.
 */
export const TAG_COLOR_TOKENS = ['brand', 'navy', 'accent', 'success', 'warning', 'danger', 'info'] as const;
export type TagColorToken = (typeof TAG_COLOR_TOKENS)[number];
