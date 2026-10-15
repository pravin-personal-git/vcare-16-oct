/**
 * Generate every icon, splash and logo image from the client's own artwork.
 *
 *   assets/brand/source/vcare-logo.png   the full logo - shield + wordmark
 *   assets/brand/source/vcare-mark.png   the shield alone, cropped from it
 *
 * Re-run after a logo change:  node scripts/brand-assets.cjs
 * (uses `sharp` from the website's node_modules - no extra install)
 *
 * ---------------------------------------------------------------------------
 * WHY THIS WAS REWRITTEN (13 Oct 2026)
 *
 * It used to take black-on-white line art and DERIVE transparency from
 * darkness - pure black solid, white clear - then paint the result a single
 * colour. That was right for the old MAALIK OS mark, which was one colour by
 * design. The Vcare logo is not: a blue shield with a black tick on a
 * transparent ground, and running it through the old path would have turned
 * the blue half-transparent and left the tick looking solid. So the art is
 * now carried through as it is.
 *
 * THE ONE REAL PROBLEM A COLOUR LOGO CREATES. The splash and the opening
 * animation sit on the dark brand colour (#0B1220). The shield's blue reads
 * perfectly well on that; the BLACK tick and the black "Care" disappear
 * into it completely. So for dark surfaces the near-black ink is turned
 * WHITE and everything else is left alone - the logo keeps its blue and
 * stays legible. That is `forDark` below, and it is the only place the
 * artwork is altered at all.
 *
 * TWO SHAPES, AND THE LAUNCHER NEEDS THE SQUARE ONE. The full logo is nearly
 * two and a half times as wide as it is tall. Squeezed into a launcher icon
 * it would be an unreadable smear, so the icon, the adaptive foreground and
 * the favicon all use the SHIELD; the wordmark is for the places that have
 * room for it - the splash, the opening animation and the app header.
 */
const path = require('path');
const sharp = require(path.resolve(__dirname, '../../atlas-app/node_modules/sharp'));

const root = path.resolve(__dirname, '..');
const src = (f) => path.join(root, 'assets/brand/source', f);
const out = (f) => path.join(root, 'assets', f);

const LOGO = src('vcare-logo.png');
const MARK = src('vcare-mark.png');

const SPLASH_BG = '#0B1220';
const INK = [0x0b, 0x12, 0x20];      // brand hero / ink, matches theme tokens
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
const WHITE_BG = { r: 255, g: 255, b: 255, alpha: 1 };

/**
 * The artwork as drawn, cropped to its own edges.
 *
 * `trim` is given a low threshold because the source has a faint halo around
 * the blue; anything fainter than that is background, not art.
 */
const asIs = (file) => sharp(file).ensureAlpha().trim({ threshold: 10 }).png().toBuffer();

/**
 * The artwork for a DARK surface: near-black ink becomes white, colour is
 * left alone.
 *
 * Judged on how far a pixel is from black rather than on its brightness, so
 * the blue - which is dark-ish but strongly coloured - is never touched.
 * Anti-aliased edges in between get a proportional blend, which is what
 * keeps the tick's curve smooth instead of jagged.
 */
async function forDark(file) {
  const trimmed = await asIs(file);
  const { data, info } = await sharp(trimmed).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const max = Math.max(r, g, b);
    const chroma = max - Math.min(r, g, b);
    // Dark AND colourless: that is the ink. 60 of chroma is generous enough
    // to protect the blue and tight enough to catch grey anti-aliasing.
    if (max < 110 && chroma < 60) {
      const t = 1 - max / 110;           // blacker ink -> whiter result
      data[o] = Math.round(r + (255 - r) * t);
      data[o + 1] = Math.round(g + (255 - g) * t);
      data[o + 2] = Math.round(b + (255 - b) * t);
    }
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

/** A one-colour silhouette, for Android's themed icons. */
async function silhouette(file, rgb) {
  const trimmed = await asIs(file);
  const { data, info } = await sharp(trimmed).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = rgb[0]; rgba[i * 4 + 1] = rgb[1]; rgba[i * 4 + 2] = rgb[2];
    // The shape is wherever the art is opaque; its own colours are dropped.
    rgba[i * 4 + 3] = channels === 4 ? data[i * channels + 3] : 255;
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** Place artwork centred on a square canvas, its longest side `fill` of it. */
async function onCanvas(art, size, fill, background) {
  const meta = await sharp(art).metadata();
  const scale = (size * fill) / Math.max(meta.width, meta.height);
  const w = Math.max(1, Math.round(meta.width * scale));
  const h = Math.max(1, Math.round(meta.height * scale));
  const resized = await sharp(art).resize(w, h).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: resized, left: Math.round((size - w) / 2), top: Math.round((size - h) / 2) }])
    .png();
}

(async () => {
  const markColour = await asIs(MARK);
  const markOnDark = await forDark(MARK);
  const logoColour = await asIs(LOGO);
  const logoOnDark = await forDark(LOGO);

  // Launcher icon - the shield on white. Opaque, because the stores and iOS
  // refuse a transparent one.
  await (await onCanvas(markColour, 1024, 0.78, WHITE_BG)).toFile(out('icon.png'));

  // Android adaptive icon: the system masks the outer third, so the shield
  // sits inside the central safe zone (~60% of the canvas).
  await (await onCanvas(markColour, 1024, 0.60, CLEAR)).toFile(out('android-icon-foreground.png'));
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: WHITE_BG } })
    .png().toFile(out('android-icon-background.png'));
  // Themed icons (Android 13+) recolour this silhouette to the wallpaper, so
  // it has to be a solid shape - a full-colour shield comes out as a blob.
  await (await onCanvas(await silhouette(MARK, INK), 1024, 0.60, CLEAR)).toFile(out('android-icon-monochrome.png'));

  // Launch splash, on the dark brand colour set in app.json.
  await (await onCanvas(markOnDark, 1024, 0.72, CLEAR)).toFile(out('splash-icon.png'));

  await sharp(await (await onCanvas(markColour, 256, 0.86, WHITE_BG)).toBuffer())
    .resize(48, 48).toFile(out('favicon.png'));

  // In-app artwork: the full wordmark for the opening animation, the shield
  // for the header, each in a light and a dark version.
  await sharp(logoOnDark).toFile(out('brand/logo-white.png'));
  await sharp(logoColour).toFile(out('brand/logo-ink.png'));
  await sharp(markOnDark).resize({ height: 256 }).toFile(out('brand/mark-white.png'));
  await sharp(markColour).resize({ height: 256 }).toFile(out('brand/mark-ink.png'));

  /*
    The two ratios the screens hard-code. `BrandMark` and the intro size
    their <Image> by width and derive the height, so a logo of a different
    shape is stretched until these are updated - print them rather than
    leaving somebody to find out by looking at a squashed shield.
  */
  const lm = await sharp(out('brand/logo-ink.png')).metadata();
  const mm = await sharp(out('brand/mark-ink.png')).metadata();
  for (const f of ['icon.png', 'android-icon-foreground.png', 'android-icon-monochrome.png',
    'splash-icon.png', 'favicon.png', 'brand/logo-white.png', 'brand/mark-white.png']) {
    const m = await sharp(out(f)).metadata();
    console.log(`${f.padEnd(34)} ${m.width}x${m.height}`);
  }
  console.log('\nRATIOS THE SCREENS NEED:');
  console.log(`  app/index.tsx      LOGO_RATIO = ${lm.width} / ${lm.height}   (= ${(lm.width / lm.height).toFixed(3)})`);
  console.log(`  BrandMark.tsx      MARK_RATIO = ${mm.width} / ${mm.height}   (= ${(mm.width / mm.height).toFixed(3)})`);
  console.log('Splash background:', SPLASH_BG);
})().catch((e) => { console.error(e); process.exit(1); });
