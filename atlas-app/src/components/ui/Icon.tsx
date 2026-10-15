/**
 * The icon set.
 *
 * Inline SVG rather than an icon package, for three reasons: it adds no
 * dependency to a product that will be handed to clients, it inherits
 * `currentColor` so icons follow the theme tokens automatically, and it ships
 * only the glyphs actually used instead of a thousand.
 *
 * Paths are 24×24, stroke-based, 2px - the same geometry family throughout, so
 * mixing them in one toolbar does not look like a ransom note.
 */

export type IconName = keyof typeof PATHS;

/**
 * Is this string actually an icon?
 *
 * Exists so callers holding a `string` can NARROW instead of casting. `as
 * IconName` is how a name that did not exist reached production and took a page
 * down; this answers the same question truthfully.
 */
export const isIconName = (v: string): v is IconName => v in PATHS;

const PATHS = {
  // navigation & chrome
  search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM21 21l-4.35-4.35',
  menu: 'M3 6h18M3 12h18M3 18h18',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-up': 'm18 15-6-6-6 6',
  'chevron-right': 'm9 18 6-6-6-6',
  'chevron-left': 'm15 18-6-6 6-6',
  'chevrons-left': 'm11 17-5-5 5-5M18 17l-5-5 5-5',
  'chevrons-right': 'm13 17 5-5-5-5M6 17l5-5-5-5',
  'more-vertical': 'M12 5h.01M12 12h.01M12 19h.01',
  x: 'M18 6 6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'm20 6-11 11-5-5',
  'arrow-left': 'M19 12H5M12 19l-7-7 7-7',
  'arrow-up-right': 'M7 17 17 7M7 7h10v10',
  'external-link': 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',

  // actions
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  'eye-off': 'M9.9 4.24A9.1 9.1 0 0 1 12 4c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.7 3.7M6.6 6.6A17.6 17.6 0 0 0 2 11s3.6 7 10 7a9.1 9.1 0 0 0 4.2-1M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2',
  pencil: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
  trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6M10 11v6M14 11v6',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
  filter: 'M22 3H2l8 9.5V19l4 2v-8.5L22 3Z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.4 15H3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.3 8.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V4a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z',
  columns: 'M3 4h18v16H3zM12 4v16',
  printer: 'M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M6 14h12v7H6z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM22 7l-10 6L2 7',
  whatsapp: 'M3 21l1.9-5A9 9 0 1 1 8 19.1L3 21Z M9 10c0 3 2 5 5 5l1.5-1.5-2-1-1 1c-1 0-2-1-2-2l1-1-1-2L9 10Z',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z',
  bag: 'M6 7h12l1 13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1L6 7ZM9 7V6a3 3 0 0 1 6 0v1',
  'shield-check': 'M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10ZM9 12l2 2 4-4',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
  monitor: 'M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM8 20h8M12 16v4',
  palette: 'M12 22a10 10 0 1 1 10-10c0 2.2-1.8 3-3.5 3H16a2 2 0 0 0-1.5 3.3A2.2 2.2 0 0 1 12 22ZM7.5 11.5h.01M10.5 7.5h.01M15.5 7.5h.01',
  lock: 'M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1ZM8 11V7a4 4 0 0 1 8 0v4',
  'log-out': 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',

  // entities
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  'user-plus': 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 8v6M23 11h-6',
  building: 'M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 21V9h2a2 2 0 0 1 2 2v10M2 21h20M8 7h2M8 11h2M8 15h2',
  package: 'M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16ZM3.3 7 12 12l8.7-5M12 22V12',
  box: 'M3 7h18v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7ZM3 7l2-4h14l2 4M12 3v4M9 12h6',
  truck: 'M1 3h13v13H1zM14 8h4l3 3v5h-7V8ZM6.5 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17.5 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  'file-text': 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M9 13h6M9 17h6',
  image: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM21 15l-5-5L5 21',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  receipt: 'M5 2v20l2.5-2 2.5 2 2-2 2 2 2.5-2 2.5 2V2l-2.5 2L14 2l-2 2-2-2-2.5 2L5 2ZM9 9h6M9 13h6',
  'shopping-cart': 'M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM19 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM1 1h4l2.7 12.6a2 2 0 0 0 2 1.4h8.6a2 2 0 0 0 2-1.6L23 6H6',
  tag: 'M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8ZM7.5 7.5h.01',
  'credit-card': 'M2 5h20a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM1 10h22',
  'trending-up': 'm23 6-9.5 9.5-5-5L1 18M17 6h6v6',
  'bar-chart': 'M18 20V10M12 20V4M6 20v-6',
  'pie-chart': 'M21.2 15.9A10 10 0 1 1 8.1 2.8M22 12A10 10 0 0 0 12 2v10Z',
  calendar: 'M5 4h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM16 2v4M8 2v4M4 10h16',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
  'map-pin': 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0ZM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  paperclip: 'M21.4 11.1 12.3 20a5.5 5.5 0 0 1-7.8-7.8l9.2-9.1a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.1a1.8 1.8 0 0 1-2.6-2.6l8.5-8.4',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',

  // status
  'check-circle': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM8 12l3 3 5-6',
  'x-circle': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM15 9l-6 6M9 9l6 6',
  'alert-circle': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 8v5M12 16h.01',
  // The notification bell (14 Oct 2026). The rail used `alert-circle` for
  // notifications, which reads as a warning - Pravin asked for a bell, and a
  // bell is what every other app puts there.
  'bell': 'M10.3 21a1.9 1.9 0 0 0 3.4 0M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9',
  'alert-triangle': 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01',
  ban: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM4.9 4.9l14.2 14.2',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-5M12 8h.01',
  'help-circle': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  'rotate-ccw': 'M1 4v6h6M3.5 15a9 9 0 1 0 2.1-9.4L1 10',
  sparkles: 'm12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z',
  maximize: 'M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3',
  minimize: 'M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M21 16h-3a2 2 0 0 0-2 2v3M8 21v-3a2 2 0 0 0-2-2H3',
  // camera scanner
  camera: 'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  scan: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z',
} as const;

export function Icon({
  name,
  className = 'h-4 w-4',
  strokeWidth = 2,
}: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}) {
  /**
   * Loud in development, silent in production.
   *
   * The page no longer crashes, which means a typo would otherwise be invisible -
   * a blank 16px square is easy to miss. This is the trade: never break the page,
   * always tell the developer.
   */
  if (process.env.NODE_ENV !== 'production' && !PATHS[name]) {
    console.warn(`[Icon] no icon called "${name}". Add it to PATHS in components/ui/Icon.tsx.`);
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/*
        An unknown name renders an empty frame rather than throwing.

        `PATHS[name]` used to be read straight into `.split`, so one icon name
        that did not exist took down the WHOLE PAGE with "Cannot read properties
        of undefined". It happened for real: People & devices used
        `'globe' as IconName` - a cast that defeats the type check - and the page
        died the moment somebody expanded a person who had a browser session. The
        row rendered fine collapsed, so it survived review and reached a client.

        A missing icon should be a missing icon. The empty <svg> keeps the layout
        intact, and the dev warning below says which name to add.
      */}
      {(PATHS[name] ?? '').split(' M').filter(Boolean).map((d, i) => (
        <path key={i} d={i === 0 ? d : `M${d}`} />
      ))}
    </svg>
  );
}
