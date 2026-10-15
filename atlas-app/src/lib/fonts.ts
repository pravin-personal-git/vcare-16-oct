import {
  DM_Sans, DM_Serif_Display, Figtree, Hind, IBM_Plex_Sans, Inter, Lato, Lexend, Lora, Manrope, Merriweather,
  Montserrat, Mukta, Noto_Sans, Nunito, Open_Sans, Outfit, Playfair_Display, Plus_Jakarta_Sans, Poppins,
  Raleway, Roboto, Rubik, Sora, Urbanist, Work_Sans,
} from 'next/font/google';

/**
 * The typefaces a business may choose on Settings › Appearance
 * (UI refresh, 4 Oct 2026; 26 of them since 12 Oct 2026 - body and heading
 * fonts chosen separately, lib/appearance FONTS / HEADING_FONTS).
 *
 * Self-hosted by next/font at build time: no request to Google from a
 * visitor's browser, no layout shift, and an offline Atlas Local install keeps
 * them. All are declared so their CSS variables exist; a browser downloads
 * only the files of the faces actually in use, and only the default is
 * preloaded. Variable faces carry every weight in one file; italic is loaded
 * where the face has one (12 Oct: "the option for bolds or italics").
 */
/*
  The default since 10 Oct 2026 (G-39, "everywhere"): Inter for words - the
  open stand-in for Apple's SF Pro - and IBM Plex Sans for figures, the
  open stand-in for Binance's number face. Every amount on every screen
  reads in one steady, tabular voice.
*/
const inter = Inter({
  subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter', display: 'swap',
});
const plex = IBM_Plex_Sans({
  subsets: ['latin', 'latin-ext'], weight: ['400', '500', '600', '700'], style: ['normal', 'italic'],
  variable: '--font-plex', display: 'swap',
});

// Not preloaded: a browser fetches one only when the business chose it.
// (next/font needs every option written out - no shared object, no spread.)
const jakarta = Plus_Jakarta_Sans({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], style: ['normal', 'italic'], variable: '--font-jakarta' });
const nunito = Nunito({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], style: ['normal', 'italic'], variable: '--font-nunito' });
const manrope = Manrope({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], variable: '--font-manrope' });
const dmSans = DM_Sans({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], style: ['normal', 'italic'], variable: '--font-dmsans' });
const figtree = Figtree({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], style: ['normal', 'italic'], variable: '--font-figtree' });
const poppins = Poppins({ display: 'swap', preload: false, subsets: ['latin', 'devanagari'], weight: ['400', '500', '600', '700', '800'], style: ['normal', 'italic'], variable: '--font-poppins' });
const montserrat = Montserrat({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], style: ['normal', 'italic'], variable: '--font-montserrat' });
const lato = Lato({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], weight: ['400', '700', '900'], style: ['normal', 'italic'], variable: '--font-lato' });
const roboto = Roboto({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], style: ['normal', 'italic'], variable: '--font-roboto' });
const openSans = Open_Sans({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], style: ['normal', 'italic'], variable: '--font-opensans' });
const workSans = Work_Sans({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], style: ['normal', 'italic'], variable: '--font-worksans' });
const outfit = Outfit({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], variable: '--font-outfit' });
const sora = Sora({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], variable: '--font-sora' });
const lexend = Lexend({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], variable: '--font-lexend' });
const urbanist = Urbanist({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], style: ['normal', 'italic'], variable: '--font-urbanist' });
const raleway = Raleway({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], style: ['normal', 'italic'], variable: '--font-raleway' });
const rubik = Rubik({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], style: ['normal', 'italic'], variable: '--font-rubik' });
const notoSans = Noto_Sans({ display: 'swap', preload: false, subsets: ['latin', 'devanagari'], style: ['normal', 'italic'], variable: '--font-notosans' });
const mukta = Mukta({ display: 'swap', preload: false, subsets: ['latin', 'devanagari'], weight: ['400', '500', '600', '700', '800'], variable: '--font-mukta' });
const hind = Hind({ display: 'swap', preload: false, subsets: ['latin', 'devanagari'], weight: ['400', '500', '600', '700'], variable: '--font-hind' });
// Heading-only faces: serifs, too ornate for a table.
const playfair = Playfair_Display({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], style: ['normal', 'italic'], variable: '--font-playfair' });
const lora = Lora({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], style: ['normal', 'italic'], variable: '--font-lora' });
const dmSerif = DM_Serif_Display({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], weight: '400', style: ['normal', 'italic'], variable: '--font-dmserif' });
const merriweather = Merriweather({ display: 'swap', preload: false, subsets: ['latin', 'latin-ext'], style: ['normal', 'italic'], variable: '--font-merriweather' });

/** Every font's CSS variable, for the <html> element. */
export const FONT_VARIABLES = [
  inter, plex, jakarta, nunito, manrope, dmSans, figtree, poppins, montserrat, lato, roboto, openSans, workSans,
  outfit, sora, lexend, urbanist, raleway, rubik, notoSans, mukta, hind, playfair, lora, dmSerif, merriweather,
]
  .map((f) => f.variable)
  .join(' ');
